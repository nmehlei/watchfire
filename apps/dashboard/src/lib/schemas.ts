import { z } from "zod";

/**
 * DTO mirrors of Watchfire responses (spec 11). Treated as the *minimum*
 * shape — extra fields the server sends are dropped on parse rather
 * than rejected, so a forward-compatible Watchfire deployment never breaks
 * the dashboard.
 */

export const Severity = z.enum(["info", "warn", "critical"]);
export type Severity = z.infer<typeof Severity>;

export const FindingState = z.enum(["new", "ongoing", "escalating", "resolved"]);
export type FindingState = z.infer<typeof FindingState>;

export const RunType = z.enum(["nightly", "watch", "manual"]);
export type RunType = z.infer<typeof RunType>;

export const RunStatus = z.enum(["success", "truncated", "error"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const FindingListItem = z.object({
  short_id: z.string(),
  fingerprint: z.string(),
  resource_id: z.string(),
  issue_class: z.string(),
  state: FindingState,
  severity: Severity,
  escalating: z.boolean(),
  muted: z.boolean(),
  title: z.string(),
  affects: z.array(z.string()),
  last_seen_at: z.string(),
  run_count: z.number().int(),
});
export type FindingListItem = z.infer<typeof FindingListItem>;

export const FindingsList = z.object({
  findings: z.array(FindingListItem),
  total: z.number().int(),
  limit: z.number().int(),
});
export type FindingsList = z.infer<typeof FindingsList>;

export const Run = z.object({
  id: z.number().int(),
  type: RunType,
  trigger: z.string(),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  status: RunStatus.nullable(),
  verdict: z.string().nullable(),
  page_sent: z.boolean().nullable(),
  finding_count: z.number().int(),
  turn_count: z.number().int(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  tokens_cached: z.number().int(),
  cost_eur: z.number().nullable(),
  error: z.string().nullable(),
  transcript_path: z.string().nullable(),
});
export type Run = z.infer<typeof Run>;

export const RunsList = z.object({
  runs: z.array(Run),
  total: z.number().int(),
  limit: z.number().int(),
});
export type RunsList = z.infer<typeof RunsList>;

export const CostWindow = z.object({
  total_eur: z.number(),
  by_type: z.object({
    nightly: z.number(),
    watch: z.number(),
    manual: z.number(),
  }),
  daily_buckets: z.array(
    z.object({
      date: z.string(),
      eur: z.number(),
    }),
  ),
});
export type CostWindow = z.infer<typeof CostWindow>;

export const AdapterHealthRow = z.object({
  source: z.string(),
  last_observed_at: z.string().nullable(),
  observation_count_24h: z.number().int(),
});
export type AdapterHealthRow = z.infer<typeof AdapterHealthRow>;

export const AdapterHealth = z.object({
  adapters: z.array(AdapterHealthRow),
  total: z.number().int(),
});
export type AdapterHealth = z.infer<typeof AdapterHealth>;

export const FindingDetail = z.object({
  short_id: z.string(),
  fingerprint: z.string(),
  resource_id: z.string(),
  issue_class: z.string(),
  state: FindingState,
  severity: Severity,
  prev_severity: Severity.nullable(),
  escalating: z.boolean(),
  muted: z.boolean(),
  title: z.string(),
  evidence: z.string(),
  likely_cause: z.string().nullable(),
  affects: z.array(z.string()),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  resolved_at: z.string().nullable(),
  age_days: z.number(),
  run_count: z.number().int(),
  first_run_id: z.number().int(),
  last_run_id: z.number().int(),
});
export type FindingDetail = z.infer<typeof FindingDetail>;

export const MuteDuration = z.enum(["1d", "7d", "30d", "forever"]);
export type MuteDuration = z.infer<typeof MuteDuration>;

export const ActiveMute = z.object({
  id: z.number().int(),
  fingerprint: z.string(),
  reason: z.string().nullable(),
  created_at: z.string(),
  expires_at: z.string().nullable(),
  source: z.string(),
  finding_title: z.string().nullable(),
  finding_resource_id: z.string().nullable(),
});
export type ActiveMute = z.infer<typeof ActiveMute>;

export const MutesList = z.object({
  mutes: z.array(ActiveMute),
  total: z.number().int(),
});
export type MutesList = z.infer<typeof MutesList>;
