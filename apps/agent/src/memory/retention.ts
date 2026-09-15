import { pruneOldResolvedFindings } from './findings.js';
import { pruneExpiredMutes } from './mutes.js';
import { pruneOldObservations } from './observations.js';
import { pruneOldRuns } from './runs.js';
import type { Db } from './schema.js';

export interface RetentionResult {
  findingsDeleted: number;
  mutesDeleted: number;
  observationsDeleted: number;
  runsDeleted: number;
}

export interface RetentionConfig {
  findingsDays?: number;
  observationsDays?: number;
  runsDays?: number;
}

/**
 * Run all retention sweeps in a single transaction. Called at the tail of a
 * successful nightly (specs/06-memory.md §Retention + specs/04-nightly.md
 * §Post-run pipeline).
 */
export function pruneOldData(db: Db, config: RetentionConfig = {}): RetentionResult {
  const findingsDays = config.findingsDays ?? 90;
  const observationsDays = config.observationsDays ?? 30;
  const runsDays = config.runsDays ?? 365;

  const tx = db.transaction((): RetentionResult => {
    return {
      findingsDeleted: pruneOldResolvedFindings(db, findingsDays),
      mutesDeleted: pruneExpiredMutes(db),
      observationsDeleted: pruneOldObservations(db, observationsDays),
      runsDeleted: pruneOldRuns(db, runsDays),
    };
  });

  return tx.immediate();
}
