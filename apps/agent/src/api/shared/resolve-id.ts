// Short-ID resolution shared between /mute (spec 10) and the API surfaces (spec 11).

import type { Db } from '../../memory/index.js';
import { resolveFingerprintByPrefix } from '../../memory/index.js';

export type ShortIdResolution =
  | { kind: 'invalid'; input: string }
  | { kind: 'none'; input: string }
  | { kind: 'unique'; fingerprint: string }
  | { kind: 'ambiguous'; input: string; candidates: readonly string[] };

export interface ResolveOptions {
  /** Minimum hex length accepted. Bot uses 4 (default), API uses 6. */
  minHex?: number;
  /** Maximum candidates returned in the ambiguous case. Default 5. */
  candidateLimit?: number;
}

/**
 * Normalize a user-typed ID:
 *  - lowercase
 *  - strip whitespace
 *  - strip any leading <code> / trailing </code> if accidentally pasted
 */
export function normalizeShortId(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^<code>/, '').replace(/<\/code>$/, '');
  return s.trim();
}

export function resolveShortId(
  db: Db,
  raw: string,
  options: ResolveOptions = {},
): ShortIdResolution {
  const min = options.minHex ?? 4;
  const limit = options.candidateLimit ?? 5;
  const re = new RegExp(`^[0-9a-f]{${min},64}$`);
  const normalized = normalizeShortId(raw);
  if (!re.test(normalized)) return { kind: 'invalid', input: raw };

  const matches = resolveFingerprintByPrefix(db, normalized, limit);
  if (matches.length === 0) return { kind: 'none', input: raw };
  if (matches.length === 1) return { kind: 'unique', fingerprint: matches[0]! };
  return { kind: 'ambiguous', input: raw, candidates: matches };
}
