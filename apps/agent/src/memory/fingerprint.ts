import { createHash } from 'node:crypto';

/**
 * Canonicalize a resource_id before fingerprinting. See specs/06-memory.md.
 *
 * Rules:
 *  - Lowercased, whitespace trimmed.
 *  - Reserved prefixes (`tenant:<id>`, `global`) pass through.
 *  - Inline port numbers (`:1433`, `:443`) are elided from hostnames.
 *  - Idempotent: canonicalize(canonicalize(x)) === canonicalize(x).
 */
export function canonicalizeResourceId(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'global' || trimmed.startsWith('tenant:')) {
    return trimmed;
  }
  // Strip `:<digits>` when followed by end-of-string, `/`, or `?`.
  return trimmed.replace(/:(\d+)(?=$|[/?])/g, '');
}

/**
 * sha256 hex of `canonicalize(resource_id) + "\0" + issue_class`.
 * Full 64-char hex; no truncation.
 */
export function fingerprint(resourceId: string, issueClass: string): string {
  const canonical = canonicalizeResourceId(resourceId);
  return createHash('sha256')
    .update(canonical + '\u0000' + issueClass)
    .digest('hex');
}
