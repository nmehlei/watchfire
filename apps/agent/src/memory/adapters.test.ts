import { describe, expect, it } from 'vitest';
import { appendObservation } from './observations.js';
import { insertRun } from './runs.js';
import { openMemoryDb } from './schema.js';
import { getAdapterHealth } from './adapters.js';

describe('getAdapterHealth', () => {
  it('returns last_observed_at + 24h count per known source', () => {
    const db = openMemoryDb();
    const runId = insertRun(db, { type: 'nightly', trigger: 'cron' });

    appendObservation(db, {
      tenant: 'acme', source: 'check-ssl', subject: 'sql.acme.internal',
      metric: 'days_until_expiry', value: 30, runId,
    });
    appendObservation(db, {
      tenant: 'acme', source: 'check-http', subject: 'watchfire.example.com',
      metric: 'response_ms', value: 80, runId,
    });
    appendObservation(db, {
      tenant: 'acme', source: 'check-http', subject: 'watchfire.example.com',
      metric: 'status_code', value: 200, runId,
    });

    const out = getAdapterHealth(db, ['check-ssl', 'check-http', 'obs-search']);
    const bySource = Object.fromEntries(out.map((r) => [r.source, r]));

    expect(bySource['check-ssl']!.last_observed_at).not.toBeNull();
    expect(bySource['check-ssl']!.observation_count_24h).toBe(1);
    expect(bySource['check-http']!.observation_count_24h).toBe(2);
    expect(bySource['obs-search']!.last_observed_at).toBeNull();
    expect(bySource['obs-search']!.observation_count_24h).toBe(0);
  });

  it('returns rows in the order of `known`', () => {
    const db = openMemoryDb();
    const out = getAdapterHealth(db, ['c', 'a', 'b']);
    expect(out.map((r) => r.source)).toEqual(['c', 'a', 'b']);
  });

  it('flags which adapters are expected to emit observations', () => {
    const db = openMemoryDb();
    const out = getAdapterHealth(db, ['check-ssl', 'obs-search']);
    const bySource = Object.fromEntries(out.map((r) => [r.source, r]));

    expect(bySource['check-ssl']!.emits_observations).toBe(true);
    expect(bySource['obs-search']!.emits_observations).toBe(false);
  });

  it('reports an emitting adapter that has never observed as expected-but-silent', () => {
    const db = openMemoryDb();
    const [row] = getAdapterHealth(db, ['check-ssl']);

    // This is the alarming combination the dashboard must distinguish from a
    // non-emitting adapter: it should be reporting, and it is not.
    expect(row!.emits_observations).toBe(true);
    expect(row!.last_observed_at).toBeNull();
  });
});
