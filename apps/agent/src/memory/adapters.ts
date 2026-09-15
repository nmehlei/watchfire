// Per-adapter health (last_observed_at + 24h count). Spec 11 §adapter_health.

import { emitsObservations } from '../adapters/registry.js';
import type { Db } from './schema.js';

export interface AdapterHealthRow {
  source: string;
  /**
   * Whether this adapter is expected to report observations at all. Lets
   * consumers tell "should be reporting, has gone quiet" (a real problem) from
   * "never reports, by design" — a bare null `last_observed_at` conflates them.
   */
  emits_observations: boolean;
  last_observed_at: string | null;
  observation_count_24h: number;
}

/**
 * For each known adapter source, return the most recent observation timestamp
 * and the observation count over the trailing 24h, alongside whether the
 * adapter emits observations at all (from the registry, not the data — so a
 * newly-added emitting adapter reads as silent rather than as healthy).
 */
export function getAdapterHealth(db: Db, known: readonly string[]): AdapterHealthRow[] {
  const lastSeen = db.prepare(
    `SELECT MAX(observed_at) AS last_at FROM observations WHERE source = ?`,
  );
  const count24h = db.prepare(
    `SELECT COUNT(*) AS c FROM observations
      WHERE source = ? AND observed_at > datetime('now', '-1 day')`,
  );

  return known.map((source) => {
    const last = lastSeen.get(source) as { last_at: string | null };
    const cnt = count24h.get(source) as { c: number };
    return {
      source,
      emits_observations: emitsObservations(source),
      last_observed_at: last.last_at,
      observation_count_24h: cnt.c,
    };
  });
}
