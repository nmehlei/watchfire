// Public API of the memory layer. External callers should import from here.

export { openDb, openMemoryDb, type Db, type OpenOptions } from './schema.js';

export {
  canonicalizeResourceId,
  fingerprint,
} from './fingerprint.js';

export {
  insertRun,
  completeRun,
  getRun,
  getRunsRecent,
  getRunFindings,
  getCostWindow,
  markCrashedOnStartup,
  getLastSweptNightlyAt,
  countRecentPages,
  countSuppressedPages,
  pruneOldRuns,
  type InsertRunInput,
  type CompleteRunInput,
  type CostWindowQuery,
  type CostWindowResult,
  type RunsRecentQuery,
  type SuppressedPagesWindow,
} from './runs.js';

export {
  upsertFinding,
  resolveUnseenFindings,
  getFindingByFingerprint,
  getFindingsForResource,
  getAgentContextFindings,
  getDigestFindings,
  getRecentFindings,
  pruneOldResolvedFindings,
  searchFindings,
  type RecentFindingsQuery,
  type RecentFindingsResult,
  type SearchFindingsQuery,
  type UpsertResult,
} from './findings.js';

export {
  appendObservation,
  getBaselineWindow,
  getObservations,
  pruneOldObservations,
  type AppendObservationInput,
  type BaselineWindowQuery,
} from './observations.js';

export {
  getAdapterHealth,
  type AdapterHealthRow,
} from './adapters.js';

export {
  pruneOldData,
  type RetentionConfig,
  type RetentionResult,
} from './retention.js';

export {
  isMuted,
  getActiveMutedFingerprints,
  resolveFingerprintByPrefix,
  listActiveMutes,
  insertMute,
  deleteMutesByFingerprint,
  pruneExpiredMutes,
  type ActiveMute,
  type InsertMuteInput,
} from './mutes.js';

export type {
  AgentFinding,
  Finding,
  FindingState,
  IssueClass,
  Mute,
  MuteSource,
  Observation,
  Run,
  RunStatus,
  RunTrigger,
  RunType,
  Severity,
  WatchVerdict,
} from './types.js';

export { ISSUE_CLASSES, SEVERITIES, isIssueClass, severityRank } from './types.js';
