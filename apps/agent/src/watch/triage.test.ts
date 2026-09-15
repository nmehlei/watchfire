import { beforeEach, describe, expect, it } from 'vitest';
import type { ResourceGraph, Tenant } from '../config/types.js';
import {
  getRun,
  openMemoryDb,
  upsertFinding,
  type Db,
  type WatchVerdict,
} from '../memory/index.js';
import type { RunAgentInput, RunAgentResult } from '../agent/runner.js';
import type { TelegramFetch } from '../reporting/telegram.js';
import { runWatch } from './triage.js';
import type { ParsedAlert } from './webhooks/openobserve.js';

const TENANTS: Tenant[] = [
  {
    id: 'acme',
    display_name: 'ACME',
    systems: [{ type: 'observability', stream: 'acme', token_env: 'X' }],
  },
];
const GRAPH: ResourceGraph = {
  resources: [
    { id: 'sql.acme.internal', type: 'mssql-server', owner: 'acme', affects: ['acme'] },
  ],
};

function alert(): ParsedAlert {
  return {
    alert: {
      alert_name: 'disk-high',
      stream: 'acme',
      severity: 'critical',
      fired_at: '2026-04-22T02:14:07Z',
      description: '/data at 98%',
      labels: { service: 'sql' },
      evaluation: { value: 98, threshold: 90 },
    },
    rawBody: '{}',
  };
}

function makeAgentStub(result: Partial<RunAgentResult> & {
  emitFindings?: Array<{ resource_id: string; title: string }>;
}): (input: RunAgentInput) => Promise<RunAgentResult> {
  return async (input) => {
    for (const f of result.emitFindings ?? []) {
      upsertFinding(input.db, input.runId, {
        resource_id: f.resource_id,
        issue_class: 'disk-pressure',
        severity: 'critical',
        title: f.title,
        evidence: 'e',
      });
    }
    return {
      status: result.status ?? 'success',
      turnCount: result.turnCount ?? 3,
      tokensIn: result.tokensIn ?? 100,
      tokensOut: result.tokensOut ?? 50,
      tokensCached: result.tokensCached ?? 80,
      costUsd: result.costUsd ?? 0.01,
      ...(result.verdict ? { verdict: result.verdict as WatchVerdict } : {}),
      ...(result.verdictReason ? { verdictReason: result.verdictReason } : {}),
      ...(result.error ? { error: result.error } : {}),
    };
  };
}

describe('runWatch', () => {
  let db: Db;
  beforeEach(() => {
    db = openMemoryDb();
  });

  it('records verdict=page and sends Telegram when under rate limit', async () => {
    const fetchCalls: Array<{ url: string; body: string }> = [];
    const fetchMock: TelegramFetch = async (url, init) => {
      fetchCalls.push({ url, body: init.body });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve('ok'),
      };
    };

    const result = await runWatch({
      db,
      alert: alert(),
      tenant: TENANTS[0]!,
      knownTenants: TENANTS,
      resourceGraph: GRAPH,
      telegram: { botToken: 'T', chatId: '-100', fetch: fetchMock, sleep: async () => {} },
      agentRun: makeAgentStub({
        verdict: 'page',
        verdictReason: 'critical threshold crossed',
        emitFindings: [{ resource_id: 'sql.acme.internal', title: 'Disk at 98%' }],
      }),
    });

    expect(result.verdict).toBe('page');
    expect(result.pageSent).toBe(true);
    expect(fetchCalls).toHaveLength(1);
    const run = getRun(db, result.runId)!;
    expect(run.verdict).toBe('page');
    expect(run.page_sent).toBe(1);
    expect(run.finding_count).toBe(1);
    expect(run.error).toBeNull();
  });

  it('suppresses page and records error when rate limit hit', async () => {
    // Pre-populate 6 pages in the last hour.
    for (let i = 0; i < 6; i++) {
      const id = db
        .prepare(`INSERT INTO runs (type, trigger, started_at, status, verdict, page_sent) VALUES ('watch', 'webhook', datetime('now'), 'success', 'page', 1)`)
        .run().lastInsertRowid as number;
      expect(id).toBeGreaterThan(0);
    }

    const fetchMock: TelegramFetch = async () => {
      throw new Error('should not be called');
    };

    const result = await runWatch({
      db,
      alert: alert(),
      tenant: TENANTS[0]!,
      knownTenants: TENANTS,
      resourceGraph: GRAPH,
      telegram: { botToken: 'T', chatId: '-100', fetch: fetchMock, sleep: async () => {} },
      agentRun: makeAgentStub({
        verdict: 'page',
        verdictReason: 'critical',
        emitFindings: [{ resource_id: 'sql.acme.internal', title: 'Disk at 98%' }],
      }),
    });

    expect(result.verdict).toBe('page');
    expect(result.pageSent).toBe(false);
    expect(result.suppressedReason).toMatch(/rate-limited/);
    const run = getRun(db, result.runId)!;
    expect(run.page_sent).toBe(0);
    expect(run.error).toMatch(/rate-limited/);
  });

  it('records verdict=defer and does not send Telegram', async () => {
    const fetchCalls: Array<unknown> = [];
    const fetchMock: TelegramFetch = async () => {
      fetchCalls.push(1);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve('ok'),
      };
    };

    const result = await runWatch({
      db,
      alert: alert(),
      tenant: TENANTS[0]!,
      knownTenants: TENANTS,
      resourceGraph: GRAPH,
      telegram: { botToken: 'T', chatId: '-100', fetch: fetchMock, sleep: async () => {} },
      agentRun: makeAgentStub({
        verdict: 'defer',
        verdictReason: 'already known, nightly will catch',
        emitFindings: [{ resource_id: 'sql.acme.internal', title: 'Disk at 98%' }],
      }),
    });

    expect(result.verdict).toBe('defer');
    expect(result.pageSent).toBe(false);
    expect(fetchCalls).toEqual([]);
  });

  it('truncated without verdict → default defer', async () => {
    const result = await runWatch({
      db,
      alert: alert(),
      tenant: TENANTS[0]!,
      knownTenants: TENANTS,
      resourceGraph: GRAPH,
      agentRun: makeAgentStub({ status: 'truncated' }),
    });

    expect(result.verdict).toBe('defer');
    expect(result.verdictReason).toMatch(/default/);
    const run = getRun(db, result.runId)!;
    expect(run.status).toBe('truncated');
    expect(run.verdict).toBe('defer');
  });

  it('Telegram failure records error but does not flip status', async () => {
    const fetchMock: TelegramFetch = async () => ({
      ok: false,
      status: 500,
      headers: { get: () => null },
      text: () => Promise.resolve('server down'),
    });

    const result = await runWatch({
      db,
      alert: alert(),
      tenant: TENANTS[0]!,
      knownTenants: TENANTS,
      resourceGraph: GRAPH,
      telegram: { botToken: 'T', chatId: '-100', fetch: fetchMock, sleep: async () => {} },
      agentRun: makeAgentStub({
        verdict: 'page',
        verdictReason: 'critical',
        emitFindings: [{ resource_id: 'sql.acme.internal', title: 'Disk at 98%' }],
      }),
    });

    expect(result.status).toBe('success'); // agent's status stands
    expect(result.pageSent).toBe(false);
    expect(result.sendError).toContain('Telegram send failed');
    const run = getRun(db, result.runId)!;
    expect(run.error).toMatch(/^telegram:/);
  });
});
