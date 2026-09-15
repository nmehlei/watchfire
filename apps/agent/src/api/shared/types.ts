// DTOs returned by the spec 11 surfaces. See specs/11-mcp.md §Tools and §REST endpoints.

import type { FindingState, IssueClass, Severity } from '../../memory/types.js';

export interface FindingDto {
  short_id: string;
  fingerprint: string;
  resource_id: string;
  issue_class: IssueClass;
  state: FindingState;
  severity: Severity;
  prev_severity: Severity | null;
  escalating: boolean;
  muted: boolean;
  title: string;
  evidence: string;
  likely_cause: string | null;
  affects: string[];
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  age_days: number;
  run_count: number;
  first_run_id: number;
  last_run_id: number;
}

export interface FindingSummaryDto {
  short_id: string;
  fingerprint: string;
  resource_id: string;
  issue_class: IssueClass;
  state: FindingState;
  severity: Severity;
  escalating: boolean;
  muted: boolean;
  title: string;
  affects: string[];
  last_seen_at: string;
  run_count: number;
}

export interface RecentFindingsResponse {
  findings: FindingSummaryDto[];
  total: number;
  limit: number;
}

export interface AmbiguousCandidate {
  short_id: string;
  resource_id: string;
  issue_class: IssueClass;
  title: string;
  state: FindingState;
}

export type ApiErrorCode =
  | 'unauthorized'
  | 'not_found'
  | 'ambiguous'
  | 'invalid_argument'
  | 'internal';

export type ApiErrorBody =
  | { error: 'unauthorized' }
  | { error: 'not_found'; id: string }
  | { error: 'ambiguous'; candidates: AmbiguousCandidate[] }
  | { error: 'invalid_argument'; detail: string }
  | { error: 'internal' };
