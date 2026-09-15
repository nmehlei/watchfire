import { describe, expect, it } from 'vitest';
import { appendObservation } from '../../../memory/observations.js';
import { insertRun } from '../../../memory/runs.js';
import { openMemoryDb } from '../../../memory/schema.js';
import { handleAdapterHealth } from './adapter-health.js';

describe('handleAdapterHealth', () => {
  it('returns one row per known adapter', () => {
    const db = openMemoryDb();
    const r = insertRun(db, { type: 'nightly', trigger: 'cron' });
    appendObservation(db, {
      tenant: 'acme', source: 'check-ssl', subject: 'sql.acme.internal',
      metric: 'days_until_expiry', value: 30, runId: r,
    });
    const out = handleAdapterHealth({ db, knownAdapters: ['check-ssl', 'obs-search'] });
    expect(out.kind).toBe('ok');
    expect(out.adapters.length).toBe(2);
  });
});
