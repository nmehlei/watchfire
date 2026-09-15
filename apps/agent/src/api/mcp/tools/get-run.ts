import { getRun, type Db } from '../../../memory/index.js';
import type { Run } from '../../../memory/types.js';

export interface GetRunArgs {
  id: number;
}

export type GetRunOutcome =
  | { kind: 'ok'; run: Run }
  | { kind: 'invalid_argument'; detail: string }
  | { kind: 'not_found'; id: string };

export function handleGetRun(deps: { db: Db }, args: GetRunArgs): GetRunOutcome {
  if (!Number.isInteger(args.id) || args.id < 1) {
    return { kind: 'invalid_argument', detail: 'id must be a positive integer' };
  }
  const run = getRun(deps.db, args.id);
  if (!run) return { kind: 'not_found', id: String(args.id) };
  return { kind: 'ok', run };
}

export const GET_RUN_TOOL = {
  name: 'get_run',
  description: 'Get a single run by id.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'integer', minimum: 1 } },
    required: ['id'],
    additionalProperties: false,
  },
} as const;
