// Memory-layer types. Schema reference: specs/06-memory.md.

export type IssueClass =
  | 'disk-pressure'
  | 'cert-expiry'
  | 'error-rate-spike'
  | 'unhealthy-pod'
  | 'http-down'
  | 'latency-regression'
  | 'auth-failure-spike'
  | 'build-red'
  | 'unknown';

export const ISSUE_CLASSES: readonly IssueClass[] = [
  'disk-pressure',
  'cert-expiry',
  'error-rate-spike',
  'unhealthy-pod',
  'http-down',
  'latency-regression',
  'auth-failure-spike',
  'build-red',
  'unknown',
];

export function isIssueClass(s: string): s is IssueClass {
  return (ISSUE_CLASSES as readonly string[]).includes(s);
}

export type Severity = 'info' | 'warn' | 'critical';
export const SEVERITIES: readonly Severity[] = ['info', 'warn', 'critical'];

export function severityRank(s: Severity): number {
  return s === 'info' ? 0 : s === 'warn' ? 1 : 2;
}

export type FindingState = 'new' | 'ongoing' | 'resolved';

export type RunType = 'nightly' | 'watch' | 'manual';
export type RunTrigger = 'cron' | 'catchup' | 'webhook' | 'manual';
export type RunStatus = 'success' | 'truncated' | 'error' | 'crashed';
export type WatchVerdict = 'page' | 'defer' | 'drop';

// Shape the agent emits via emit-finding (specs/04-nightly.md).
export interface AgentFinding {
  resource_id: string;
  issue_class: IssueClass;
  severity: Severity;
  title: string;
  evidence: string;
  likely_cause?: string;
}

// Row shape in the findings table.
export interface Finding {
  id: number;
  fingerprint: string;
  resource_id: string;
  issue_class: IssueClass;
  state: FindingState;
  severity: Severity;
  prev_severity: Severity | null;
  title: string;
  evidence: string | null;
  likely_cause: string | null;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  run_count: number;
  first_run_id: number;
  last_run_id: number;
}

// Row shape in the runs table.
export interface Run {
  id: number;
  type: RunType;
  trigger: RunTrigger;
  started_at: string;
  completed_at: string | null;
  status: RunStatus | null;
  verdict: WatchVerdict | null;
  page_sent: 0 | 1 | null;
  finding_count: number | null;
  turn_count: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_cached: number | null;
  cost_eur: number | null;
  error: string | null;
  transcript_path: string | null;
}

export type MuteSource = 'telegram' | 'manual';

// Row shape in the mutes table.
export interface Mute {
  id: number;
  fingerprint: string;
  reason: string | null;
  created_at: string;
  expires_at: string | null;
  source: MuteSource;
}

// Row shape in the observations table.
export interface Observation {
  id: number;
  tenant: string;
  source: string;
  subject: string;
  metric: string;
  value: number;
  observed_at: string;
  run_id: number;
}
