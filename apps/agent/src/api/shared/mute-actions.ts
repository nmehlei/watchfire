import {
  deleteMutesByFingerprint,
  getFindingByFingerprint,
  insertMute,
  type Db,
} from '../../memory/index.js';
import { ALLOWED_DURATIONS, expiryForDuration, isDuration } from './duration.js';
import { resolveShortId } from './resolve-id.js';
import { shortFingerprint } from './format.js';
import type { AmbiguousCandidate } from './types.js';

export interface ApplyMuteInput {
  id: string;
  /** One of ALLOWED_DURATIONS (1d / 7d / 30d / forever). Absent → indefinite. */
  duration?: string | undefined;
  reason?: string | null | undefined;
  source?: 'telegram' | 'manual';
  /** Min hex length for id validation. Default 6 (API). Bot uses 4. */
  minHex?: number;
}

export type ApplyMuteOutcome =
  | { kind: 'ok'; fingerprint: string; expires_at: string | null }
  | { kind: 'invalid_argument'; detail: string }
  | { kind: 'not_found'; id: string }
  | { kind: 'ambiguous'; candidates: AmbiguousCandidate[] };

function buildAmbiguousCandidates(db: Db, fingerprints: readonly string[]): AmbiguousCandidate[] {
  return fingerprints
    .map((fp) => getFindingByFingerprint(db, fp))
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .map((f) => ({
      short_id: shortFingerprint(f.fingerprint),
      resource_id: f.resource_id,
      issue_class: f.issue_class,
      title: f.title,
      state: f.state,
    }));
}

export function applyMute(db: Db, input: ApplyMuteInput): ApplyMuteOutcome {
  const resolved = resolveShortId(db, input.id, { minHex: input.minHex ?? 6 });
  if (resolved.kind === 'invalid') {
    return {
      kind: 'invalid_argument',
      detail: `id must be ${input.minHex ?? 6}+ hex chars`,
    };
  }
  if (resolved.kind === 'none') return { kind: 'not_found', id: input.id };
  if (resolved.kind === 'ambiguous') {
    return { kind: 'ambiguous', candidates: buildAmbiguousCandidates(db, resolved.candidates) };
  }

  let expiresAt: string | null = null;
  if (input.duration !== undefined) {
    if (!isDuration(input.duration)) {
      return {
        kind: 'invalid_argument',
        detail: `duration must be one of: ${ALLOWED_DURATIONS.join(', ')}`,
      };
    }
    expiresAt = expiryForDuration(input.duration);
  }

  insertMute(db, {
    fingerprint: resolved.fingerprint,
    reason: input.reason ?? null,
    expiresAt,
    source: input.source ?? 'manual',
  });

  return { kind: 'ok', fingerprint: resolved.fingerprint, expires_at: expiresAt };
}

export type RemoveMuteOutcome =
  | { kind: 'ok'; fingerprint: string; deleted_count: number }
  | { kind: 'invalid_argument'; detail: string }
  | { kind: 'not_found'; id: string }
  | { kind: 'ambiguous'; candidates: AmbiguousCandidate[] };

export function removeMute(
  db: Db,
  input: { id: string; minHex?: number },
): RemoveMuteOutcome {
  const resolved = resolveShortId(db, input.id, { minHex: input.minHex ?? 6 });
  if (resolved.kind === 'invalid') {
    return {
      kind: 'invalid_argument',
      detail: `id must be ${input.minHex ?? 6}+ hex chars`,
    };
  }
  if (resolved.kind === 'none') return { kind: 'not_found', id: input.id };
  if (resolved.kind === 'ambiguous') {
    return { kind: 'ambiguous', candidates: buildAmbiguousCandidates(db, resolved.candidates) };
  }

  const count = deleteMutesByFingerprint(db, resolved.fingerprint);
  return { kind: 'ok', fingerprint: resolved.fingerprint, deleted_count: count };
}
