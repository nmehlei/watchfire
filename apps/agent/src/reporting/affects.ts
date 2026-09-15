import type { ResourceGraph } from '../config/types.js';
import { canonicalizeResourceId } from '../memory/fingerprint.js';

export interface AffectsOptions {
  /** Known tenants for owner derivation from naming conventions. */
  knownTenants?: readonly string[] | undefined;
  /** Run-context tenant (watch's originating tenant, or nightly's single tenant). */
  runContextTenant?: string | undefined;
}

/**
 * Resolve the `[<tenants>]` prefix for a finding at render time.
 * Rules per specs/07-reporting.md.
 *
 * 1. Look up resource_id in the graph; if present, use its `affects`.
 * 2. Reserved prefixes: `global` → all known tenants; `tenant:<id>` → [<id>].
 * 3. Heuristic owner derivation: find a known-tenant slug as a domain label
 *    in the resource id (e.g. `sql.acme.internal` → acme).
 * 4. Fallback to run-context tenant.
 * 5. `[?]` when nothing derives — a visible signal the resource graph is
 *    incomplete.
 */
export function expandAffects(
  resourceId: string,
  graph: ResourceGraph,
  options: AffectsOptions = {},
): string[] {
  const canonical = canonicalizeResourceId(resourceId);

  const resource = graph.resources.find((r) => canonicalizeResourceId(r.id) === canonical);
  if (resource) return [...resource.affects].sort();

  if (canonical === 'global') {
    return options.knownTenants ? [...options.knownTenants].sort() : ['?'];
  }
  if (canonical.startsWith('tenant:')) {
    return [canonical.slice('tenant:'.length)];
  }

  if (options.knownTenants) {
    for (const tenant of options.knownTenants) {
      // Match tenant slug as a full domain label (bounded by `.`, `-`, or edges).
      const escaped = tenant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|[.\\-])${escaped}([.\\-]|$)`, 'i');
      if (re.test(canonical)) return [tenant];
    }
  }

  if (options.runContextTenant) return [options.runContextTenant];

  return ['?'];
}
