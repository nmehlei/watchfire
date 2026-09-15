import { beforeEach, describe, expect, it } from 'vitest';
import type { ResourceGraph, Tenant } from '../config/types.js';
import type { RunAgentInput, RunAgentResult } from '../agent/runner.js';
import {
  getFindingByFingerprint,
  getRun,
  insertRun,
  openMemoryDb,
  upsertFinding,
  type Db,
} from '../memory/index.js';
import type { TelegramFetch } from '../reporting/telegram.js';
import { runNightly } from './index.js';

const TENANTS: Tenant[] = [
  {
    id: 'acme',
    display_name: 'ACME',
    systems: [
      { type: 'observability', stream: 'acme', token_env: 'X' },
      { type: 'ssl', hosts: ['acme.example'] },
    ],
  },
];
const GRAPH: ResourceGraph = {
  resources: [
    { id: 'sql.acme.internal', type: 'mssql-server', owner: 'acme', affects: ['acme'] },
  ],
};

function makeAgentStub(result: Partial<RunAgentResult> & {
  emitFindings?: Array<{ resource_id: string; title: string }>;
}): (input: RunAgentInput) => Promise<RunAgentResult> {
  return async (input) => {
    for (const f of result.emitFindings ?? []) {
      upsertFinding(input.db, input.runId, {
        resource_id: f.resource_id,
        issue_class: 'disk-pressure',
        severity: 'warn',
        title: f.title,
        evidence: 'e',
      });
    }
    return {
      status: result.status ?? 'success',
      turnCount: result.turnCount ?? 10,
      tokensIn: result.tokensIn ?? 100,
      tokensOut: result.tokensOut ?? 50,
      tokensCached: result.tokensCached ?? 80,
      costUsd: result.costUsd ?? 0.05,
      ...(result.error ? { error: result.error } : {}),
    };
  };
}

describe('runNightly', () => {
  let db: Db;
  beforeEach(() => {
    db = openMemoryDb();
  });

  it('success path: agent emits, sweep runs, digest composed, completeRun called', async () => {
    const result = await runNightly({
      db,
      tenants: TENANTS,
      resourceGraph: GRAPH,
      trigger: 'cron',
      agentRun: makeAgentStub({
        emitFindings: [
          { resource_id: 'sql.acme.internal', title: 'disk at 85%' },
          { resource_id: 'acme.example', title: 'SSL expires soon' },
        ],
      }),
    });

    expect(result.status).toBe('success');
    expect(result.digestText).toContain('🌙 <b>Nightly digest</b>');
    expect(result.digestText).toContain('disk at 85%');

    const run = getRun(db, result.runId)!;
    expect(run.status).toBe('success');
    expect(run.finding_count).toBe(2);
    expect(run.turn_count).toBe(10);
  });

  it('resolves findings not seen this run', async () => {
    // Pre-seed an old finding from a prior nightly.
    const oldRunId = insertRun(db, { type: 'nightly', trigger: 'cron' });
    const old = upsertFinding(db, oldRunId, {
      resource_id: 'old.resource',
      issue_class: 'disk-pressure',
      severity: 'warn',
      title: 'stale',
      evidence: 'e',
    });
    // Backdate its last_seen so the new nightly's started_at > it.
    db.prepare(`UPDATE findings SET last_seen_at = datetime('now', '-1 day') WHERE fingerprint = ?`).run(
      old.fingerprint,
    );

    const result = await runNightly({
      db,
      tenants: TENANTS,
      resourceGraph: GRAPH,
      trigger: 'cron',
      agentRun: makeAgentStub({
        emitFindings: [{ resource_id: 'sql.acme.internal', title: 'disk at 85%' }],
      }),
    });

    expect(result.resolved).toBe(1);
    const now = getFindingByFingerprint(db, old.fingerprint)!;
    expect(now.state).toBe('resolved');
  });

  it('error status: skips sweep and sends a compact hard-error alert instead of a full digest', async () => {
    const oldRunId = insertRun(db, { type: 'nightly', trigger: 'cron' });
    const old = upsertFinding(db, oldRunId, {
      resource_id: 'old.resource',
      issue_class: 'disk-pressure',
      severity: 'warn',
      title: 'stale',
      evidence: 'e',
    });
    db.prepare(`UPDATE findings SET last_seen_at = datetime('now', '-1 day') WHERE fingerprint = ?`).run(
      old.fingerprint,
    );

    const result = await runNightly({
      db,
      tenants: TENANTS,
      resourceGraph: GRAPH,
      trigger: 'cron',
      agentRun: makeAgentStub({ status: 'error', error: 'model timeout' }),
    });

    expect(result.status).toBe('error');
    expect(result.resolved).toBe(0);
    expect(result.digestText).toContain('🔴 <b>NIGHTLY FAILED</b>');
    expect(result.digestText).toContain('<code>model timeout</code>');
    // Old finding's title is not repeated, just counted.
    expect(result.digestText).not.toContain('old.resource');
    expect(result.digestText).toContain('1 finding was still open');
    // Old finding not resolved.
    expect(getFindingByFingerprint(db, old.fingerprint)!.state).not.toBe('resolved');
  });

  it('truncated status: sweep still runs', async () => {
    const oldRunId = insertRun(db, { type: 'nightly', trigger: 'cron' });
    const old = upsertFinding(db, oldRunId, {
      resource_id: 'old.resource',
      issue_class: 'disk-pressure',
      severity: 'warn',
      title: 'stale',
      evidence: 'e',
    });
    db.prepare(`UPDATE findings SET last_seen_at = datetime('now', '-1 day') WHERE fingerprint = ?`).run(
      old.fingerprint,
    );

    const result = await runNightly({
      db,
      tenants: TENANTS,
      resourceGraph: GRAPH,
      trigger: 'cron',
      agentRun: makeAgentStub({ status: 'truncated' }),
    });

    expect(result.status).toBe('truncated');
    expect(result.resolved).toBe(1);
    expect(result.digestText).toContain('20-turn budget');
  });

  it('safety hard-block surfaces as 🚨 SAFETY VIOLATION header', async () => {
    const result = await runNightly({
      db,
      tenants: TENANTS,
      resourceGraph: GRAPH,
      trigger: 'cron',
      agentRun: makeAgentStub({
        status: 'error',
        error: 'safety: rm-recursive-or-force — rm -rf /tmp/bad',
      }),
    });
    expect(result.digestText).toContain('🚨 <b>SAFETY VIOLATION</b>');
  });

  it('empty nightly emits heartbeat digest ("All quiet")', async () => {
    const result = await runNightly({
      db,
      tenants: TENANTS,
      resourceGraph: GRAPH,
      trigger: 'cron',
      agentRun: makeAgentStub({ emitFindings: [] }),
    });
    expect(result.digestText).toContain('All quiet');
    expect(result.digestText).toContain('━ Run ━');
  });

  it('sends digest to Telegram when configured', async () => {
    const calls: string[] = [];
    const fetchMock: TelegramFetch = async (_url, init) => {
      calls.push(init.body);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve('ok'),
      };
    };

    const result = await runNightly({
      db,
      tenants: TENANTS,
      resourceGraph: GRAPH,
      trigger: 'cron',
      telegram: { botToken: 'T', chatId: '-100', fetch: fetchMock, sleep: async () => {} },
      agentRun: makeAgentStub({
        emitFindings: [{ resource_id: 'sql.acme.internal', title: 'disk at 85%' }],
      }),
    });

    expect(result.digestSent).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('Telegram failure → sendError + runs.error', async () => {
    const fetchMock: TelegramFetch = async () => ({
      ok: false,
      status: 500,
      headers: { get: () => null },
      text: () => Promise.resolve('server down'),
    });

    const result = await runNightly({
      db,
      tenants: TENANTS,
      resourceGraph: GRAPH,
      trigger: 'cron',
      telegram: { botToken: 'T', chatId: '-100', fetch: fetchMock, sleep: async () => {} },
      agentRun: makeAgentStub({
        emitFindings: [{ resource_id: 'sql.acme.internal', title: 'x' }],
      }),
    });

    expect(result.digestSent).toBe(false);
    expect(result.sendError).toBeTruthy();
    const run = getRun(db, result.runId)!;
    expect(run.error).toMatch(/^telegram:/);
    // Agent status still success — delivery failure doesn't flip run state.
    expect(run.status).toBe('success');
  });

  it('retention sweep runs by default and can be skipped', async () => {
    // Insert a super-old run that should be pruned.
    const oldRun = insertRun(db, { type: 'nightly', trigger: 'cron' });
    db.prepare(`UPDATE runs SET started_at = datetime('now', '-400 days') WHERE id = ?`).run(oldRun);

    await runNightly({
      db,
      tenants: TENANTS,
      resourceGraph: GRAPH,
      trigger: 'cron',
      agentRun: makeAgentStub({ emitFindings: [] }),
    });

    // Old run should be gone.
    expect(getRun(db, oldRun)).toBeNull();

    // Test skipRetention: another old run, but skipRetention=true.
    const oldRun2 = insertRun(db, { type: 'nightly', trigger: 'cron' });
    db.prepare(`UPDATE runs SET started_at = datetime('now', '-400 days') WHERE id = ?`).run(oldRun2);

    await runNightly({
      db,
      tenants: TENANTS,
      resourceGraph: GRAPH,
      trigger: 'cron',
      skipRetention: true,
      agentRun: makeAgentStub({ emitFindings: [] }),
    });
    expect(getRun(db, oldRun2)).not.toBeNull();
  });
});
