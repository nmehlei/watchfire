// Compute API DTO fields. Reuses isEscalating from the digest renderer (07)
// and expandAffects from the resource graph (07) — single source of truth.

import type { ResourceGraph } from '../../config/types.js';
import type { Finding } from '../../memory/types.js';
import { expandAffects } from '../../reporting/affects.js';
import { isEscalating } from '../../reporting/renderers/state.js';
import type { FindingDto, FindingSummaryDto } from './types.js';

export function shortFingerprint(fp: string): string {
  return fp.slice(0, 6);
}

const SQLITE_UTC_RE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/;

function parseTimestamp(s: string): number {
  const m = SQLITE_UTC_RE.exec(s);
  if (m) return Date.parse(`${m[1]}T${m[2]}Z`);
  return Date.parse(s);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function ageDays(firstSeenAt: string, now: number = Date.now()): number {
  const then = parseTimestamp(firstSeenAt);
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((now - then) / MS_PER_DAY));
}

export interface FormatContext {
  isMuted: boolean;
  graph: ResourceGraph;
  knownTenants: readonly string[];
  /** Run-context tenant for affects fallback (rarely available outside watch). */
  runContextTenant?: string | undefined;
  /** Now in ms; default Date.now(). */
  now?: number | undefined;
}

export function findingToDto(f: Finding, ctx: FormatContext): FindingDto {
  return {
    short_id: shortFingerprint(f.fingerprint),
    fingerprint: f.fingerprint,
    resource_id: f.resource_id,
    issue_class: f.issue_class,
    state: f.state,
    severity: f.severity,
    prev_severity: f.prev_severity,
    escalating: isEscalating(f),
    muted: ctx.isMuted,
    title: f.title,
    evidence: f.evidence ?? '',
    likely_cause: f.likely_cause,
    affects: expandAffects(f.resource_id, ctx.graph, {
      knownTenants: ctx.knownTenants,
      runContextTenant: ctx.runContextTenant,
    }),
    first_seen_at: f.first_seen_at,
    last_seen_at: f.last_seen_at,
    resolved_at: f.resolved_at,
    age_days: ageDays(f.first_seen_at, ctx.now),
    run_count: f.run_count,
    first_run_id: f.first_run_id,
    last_run_id: f.last_run_id,
  };
}

export function findingToSummaryDto(f: Finding, ctx: FormatContext): FindingSummaryDto {
  return {
    short_id: shortFingerprint(f.fingerprint),
    fingerprint: f.fingerprint,
    resource_id: f.resource_id,
    issue_class: f.issue_class,
    state: f.state,
    severity: f.severity,
    escalating: isEscalating(f),
    muted: ctx.isMuted,
    title: f.title,
    affects: expandAffects(f.resource_id, ctx.graph, {
      knownTenants: ctx.knownTenants,
      runContextTenant: ctx.runContextTenant,
    }),
    last_seen_at: f.last_seen_at,
    run_count: f.run_count,
  };
}
