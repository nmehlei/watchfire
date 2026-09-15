import { getRunsRecent, type Db } from '../../../memory/index.js';
import type { Run } from '../../../memory/types.js';

export interface ListRunsArgs {
  type?: 'nightly' | 'watch' | 'manual';
  limit?: number;
}

export type ListRunsOutcome =
  | { kind: 'ok'; runs: Run[]; total: number; limit: number }
  | { kind: 'invalid_argument'; detail: string };

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export function handleListRuns(deps: { db: Db }, args: ListRunsArgs): ListRunsOutcome {
  const limit = args.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return { kind: 'invalid_argument', detail: `limit must be integer in [1, ${MAX_LIMIT}]` };
  }
  if (args.type && !['nightly', 'watch', 'manual'].includes(args.type)) {
    return { kind: 'invalid_argument', detail: 'type must be nightly|watch|manual' };
  }
  const runs = getRunsRecent(deps.db, {
    ...(args.type ? { type: args.type } : {}),
    limit,
  });
  return { kind: 'ok', runs, total: runs.length, limit };
}

export const LIST_RUNS_TOOL = {
  name: 'list_runs',
  description: 'List recent runs (nightly, watch, manual). Filter by type.',
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['nightly', 'watch', 'manual'] },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
    additionalProperties: false,
  },
} as const;
