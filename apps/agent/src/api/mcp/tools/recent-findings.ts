import type { ResourceGraph } from '../../../config/types.js';
import { getRecentFindings, isMuted, type Db } from '../../../memory/index.js';
import { findingToSummaryDto } from '../../shared/format.js';
import type { RecentFindingsResponse } from '../../shared/types.js';

export interface ToolDeps {
  db: Db;
  graph: ResourceGraph;
  knownTenants: readonly string[];
}

export interface RecentFindingsArgs {
  limit?: number;
  include_resolved?: boolean;
  include_muted?: boolean;
}

export type RecentFindingsOutcome =
  | { kind: 'ok'; body: RecentFindingsResponse }
  | { kind: 'invalid_argument'; detail: string };

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

export function handleRecentFindings(
  deps: ToolDeps,
  args: RecentFindingsArgs,
): RecentFindingsOutcome {
  const limit = args.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return {
      kind: 'invalid_argument',
      detail: `limit must be an integer in [1, ${MAX_LIMIT}]`,
    };
  }
  const includeResolved = args.include_resolved ?? false;
  const includeMuted = args.include_muted ?? false;

  const result = getRecentFindings(deps.db, { limit, includeResolved, includeMuted });

  const findings = result.findings.map((f) =>
    findingToSummaryDto(f, {
      isMuted: includeMuted ? isMuted(deps.db, f.fingerprint) : false,
      graph: deps.graph,
      knownTenants: deps.knownTenants,
    }),
  );

  return { kind: 'ok', body: { findings, total: result.total, limit } };
}

export const RECENT_FINDINGS_TOOL = {
  name: 'recent_findings',
  description:
    'List currently-relevant findings (active by default; recently-resolved on request). Excludes muted by default; ordered by last_seen_at DESC then severity rank DESC.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 50, description: 'default 20' },
      include_resolved: { type: 'boolean', description: 'default false' },
      include_muted: { type: 'boolean', description: 'default false' },
    },
    additionalProperties: false,
  },
} as const;
