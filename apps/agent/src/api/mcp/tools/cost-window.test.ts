import { describe, expect, it } from 'vitest';
import { completeRun, insertRun } from '../../../memory/runs.js';
import { openMemoryDb } from '../../../memory/schema.js';
import { handleCostWindow } from './cost-window.js';

describe('handleCostWindow', () => {
  it('aggregates total + by_type', () => {
    const db = openMemoryDb();
    const r = insertRun(db, { type: 'nightly', trigger: 'cron' });
    completeRun(db, r, {
      status: 'success', findingCount: 0, turnCount: 1,
      tokensIn: 1, tokensOut: 1, tokensCached: 0, costEur: 0.05,
    });
    const out = handleCostWindow({ db }, {});
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.body.total_eur).toBeCloseTo(0.05);
  });

  it('rejects bad days', () => {
    const out = handleCostWindow({ db: openMemoryDb() }, { days: 999 });
    expect(out.kind).toBe('invalid_argument');
  });
});
