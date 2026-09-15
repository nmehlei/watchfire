// Unit tests for runAgent() terminal-status classification.
//
// The SDK is mocked so we can drive exact `result` message shapes; the
// integration counterpart (runner.integration.test.ts) covers real wiring.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

// Messages the mocked query() will yield; set per test.
let scriptedMessages: SDKMessage[] = [];

vi.mock(import('@anthropic-ai/claude-agent-sdk'), async (importOriginal) => ({
  ...(await importOriginal()),
  query: () =>
    (async function* () {
      for (const msg of scriptedMessages) yield msg;
    })(),
}));

const { insertRun, openMemoryDb } = await import('../memory/index.js');
const { runAgent } = await import('./runner.js');

/** A `result` message with the fields runAgent reads. Cast: partial SDK shape. */
function resultMessage(over: Record<string, unknown>): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: 'done',
    stop_reason: 'end_turn',
    total_cost_usd: 0.01,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    uuid: '00000000-0000-0000-0000-000000000000',
    session_id: 'test',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture only needs the fields runAgent reads
  } as any;
}

function run(maxTurns: number) {
  const db = openMemoryDb();
  const runId = insertRun(db, { type: 'nightly', trigger: 'manual' });
  return runAgent({
    db,
    runId,
    mode: 'nightly',
    systemPrompt: 'test',
    userPrompt: 'test',
    maxTurns,
  });
}

/** A tool-result message as the SDK delivers adapter stdout back to the agent. */
function toolResultMessage(text: string): SDKMessage {
  return {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text }] }],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture only needs the fields runAgent reads
  } as any;
}

describe('runAgent — terminal status', () => {
  beforeEach(() => {
    scriptedMessages = [];
  });

  it("reports 'success' when the SDK succeeds having used every available turn", async () => {
    // Regression: a completed sweep that happens to consume all its turns is
    // still a success — the SDK signals a real cap hit via error_max_turns.
    scriptedMessages = [resultMessage({ subtype: 'success', num_turns: 20 })];

    const result = await run(20);

    expect(result.status).toBe('success');
    expect(result.turnCount).toBe(20);
  });

  it("reports 'truncated' when the SDK stops at the turn cap", async () => {
    scriptedMessages = [resultMessage({ subtype: 'error_max_turns', is_error: true, num_turns: 20 })];

    const result = await run(20);

    expect(result.status).toBe('truncated');
  });

  it("reports 'truncated' when the SDK stops at the budget cap", async () => {
    scriptedMessages = [
      resultMessage({ subtype: 'error_max_budget_usd', is_error: true, num_turns: 7 }),
    ];

    const result = await run(20);

    expect(result.status).toBe('truncated');
  });

  it("reports 'success' for a normal short run", async () => {
    scriptedMessages = [resultMessage({ subtype: 'success', num_turns: 3 })];

    const result = await run(20);

    expect(result.status).toBe('success');
  });

  it("reports 'error' when execution fails", async () => {
    scriptedMessages = [
      resultMessage({ subtype: 'error_during_execution', is_error: true, num_turns: 2 }),
    ];

    const result = await run(20);

    expect(result.status).toBe('error');
  });
});

describe('runAgent — observation trailers', () => {
  beforeEach(() => {
    scriptedMessages = [];
  });

  /** Runs the agent over `messages` and returns the observations persisted. */
  async function runAndReadObservations(...texts: string[]) {
    const db = openMemoryDb();
    const runId = insertRun(db, { type: 'nightly', trigger: 'manual' });
    scriptedMessages = [...texts.map(toolResultMessage), resultMessage({})];

    await runAgent({
      db,
      runId,
      mode: 'nightly',
      systemPrompt: 'test',
      userPrompt: 'test',
      maxTurns: 20,
    });

    return db
      .prepare('SELECT tenant, source, subject, metric, value, run_id FROM observations')
      .all() as Array<Record<string, unknown>>;
  }

  it('persists a trailer emitted in adapter output', async () => {
    const rows = await runAndReadObservations(
      [
        'api.acme.de',
        '  Valid: 2026-05-01 → 2026-08-30 (42 days remaining)',
        '___WATCHFIRE_OBS: tenant=acme source=check-ssl subject=api.acme.de metric=days_until_expiry value=42',
      ].join('\n'),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant: 'acme',
      source: 'check-ssl',
      subject: 'api.acme.de',
      metric: 'days_until_expiry',
      value: 42,
    });
  });

  it('tags observations with the current run id', async () => {
    const rows = await runAndReadObservations(
      '___WATCHFIRE_OBS: tenant=acme source=check-ssl subject=a metric=m value=1',
    );

    // The adapter never knows the run_id — the runner supplies it.
    expect(rows[0]!['run_id']).toBe(1);
  });

  it('persists trailers from several tool results across the run', async () => {
    const rows = await runAndReadObservations(
      '___WATCHFIRE_OBS: tenant=acme source=check-http subject=a metric=response_ms value=120',
      '___WATCHFIRE_OBS: tenant=globex source=check-http subject=b metric=response_ms value=2100',
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r['tenant'])).toEqual(['acme', 'globex']);
  });

  it('records nothing for adapter output without trailers', async () => {
    expect(await runAndReadObservations('all endpoints ok')).toEqual([]);
  });

  it('does not fail the run when a trailer is malformed', async () => {
    const db = openMemoryDb();
    const runId = insertRun(db, { type: 'nightly', trigger: 'manual' });
    scriptedMessages = [
      toolResultMessage('___WATCHFIRE_OBS: tenant=acme source=check-ssl subject=a metric=m value=NOPE'),
      resultMessage({}),
    ];

    const result = await runAgent({
      db,
      runId,
      mode: 'nightly',
      systemPrompt: 'test',
      userPrompt: 'test',
      maxTurns: 20,
    });

    // Telemetry is best-effort; a bad trailer must never degrade the run.
    expect(result.status).toBe('success');
    expect(db.prepare('SELECT * FROM observations').all()).toEqual([]);
  });
});
