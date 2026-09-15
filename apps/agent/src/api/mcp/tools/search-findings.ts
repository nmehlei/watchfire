import type { ResourceGraph } from '../../../config/types.js';
import { isMuted, searchFindings, type Db } from '../../../memory/index.js';
import { findingToSummaryDto } from '../../shared/format.js';
import type { FindingSummaryDto } from '../../shared/types.js';

export interface SearchFindingsArgs {
  q: string;
  limit?: number;
}

export type SearchFindingsOutcome =
  | { kind: 'ok'; findings: FindingSummaryDto[]; total: number; limit: number }
  | { kind: 'invalid_argument'; detail: string };

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export function handleSearchFindings(
  deps: { db: Db; graph: ResourceGraph; knownTenants: readonly string[] },
  args: SearchFindingsArgs,
): SearchFindingsOutcome {
  const q = (args.q ?? '').trim();
  if (q.length === 0) return { kind: 'invalid_argument', detail: 'q is required' };
  const limit = args.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return { kind: 'invalid_argument', detail: `limit must be integer in [1, ${MAX_LIMIT}]` };
  }
  const rows = searchFindings(deps.db, { q, limit });
  const findings = rows.map((f) =>
    findingToSummaryDto(f, {
      isMuted: isMuted(deps.db, f.fingerprint),
      graph: deps.graph,
      knownTenants: deps.knownTenants,
    }),
  );
  return { kind: 'ok', findings, total: findings.length, limit };
}

export const SEARCH_FINDINGS_TOOL = {
  name: 'search_findings',
  description: 'Search findings by title or resource_id substring (case-insensitive).',
  inputSchema: {
    type: 'object',
    properties: {
      q: { type: 'string', minLength: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
    required: ['q'],
    additionalProperties: false,
  },
} as const;
