// Integration smoke test: hits the real Anthropic API.
//
// OFF by default (no API key in CI). Runs when:
//   ANTHROPIC_API_KEY is set (loaded from .env or the environment) AND
//   IRIS_RUN_AGENT_INTEGRATION=1
//
// Cost budget: maxBudgetUsd=0.05 (~5 cents). maxTurns=3.
//
// What it proves: runAgent() wires query() + MCP tools + canUseTool correctly
// enough for the model to call emit_finding and for the result to persist.

import { describe, expect, it } from 'vitest';
import { insertRun, openMemoryDb } from '../memory/index.js';
import { runAgent } from './runner.js';

// Try to load .env for local dev; silent if absent.
try {
  // Node 22+. loadEnvFile throws if file missing — wrap in try/catch.
  process.loadEnvFile?.();
} catch {
  // absent .env, fine
}

const shouldRun =
  !!process.env['ANTHROPIC_API_KEY'] && process.env['IRIS_RUN_AGENT_INTEGRATION'] === '1';

describe.skipIf(!shouldRun)('runAgent — integration', () => {
  it(
    'calls emit_finding and persists a finding to memory',
    async () => {
      const db = openMemoryDb();
      const runId = insertRun(db, { type: 'nightly', trigger: 'manual' });

      const systemPrompt = [
        'You are Watchfire, a read-only SRE agent.',
        '',
        'In this smoke-test prompt, you should:',
        '1. Call the emit_finding tool exactly once with a plausible disk-pressure',
        '   finding for resource_id=sql.acme.internal, severity=warn, title=',
        '   "Smoke test — disk pressure detected", evidence="Test evidence" .',
        '2. Then end your turn. Do not run any other tool. Do not call Bash.',
      ].join('\n');

      const userPrompt =
        'Please follow the smoke-test instructions in your system prompt. Emit the finding, then stop.';

      const result = await runAgent({
        db,
        runId,
        mode: 'nightly',
        systemPrompt,
        userPrompt,
        maxTurns: 3,
        maxBudgetUsd: 0.05,
      });

      console.log('runAgent smoke result:', {
        status: result.status,
        turns: result.turnCount,
        cost: result.costUsd,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        tokensCached: result.tokensCached,
        error: result.error,
      });

      expect(['success', 'truncated']).toContain(result.status);
      expect(result.turnCount).toBeGreaterThan(0);

      const rows = db
        .prepare('SELECT fingerprint, state, title FROM findings')
        .all() as Array<{ fingerprint: string; state: string; title: string }>;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]!.state).toBe('new');
    },
    120_000,
  );
});
