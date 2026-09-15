import type { ResourceGraph } from '../../../config/types.js';
import { getRunFindings, isMuted, type Db } from '../../../memory/index.js';
import { findingToSummaryDto } from '../../shared/format.js';
import type { FindingSummaryDto } from '../../shared/types.js';

export interface GetRunFindingsArgs {
  id: number;
}

export type GetRunFindingsOutcome =
  | { kind: 'ok'; findings: FindingSummaryDto[]; total: number }
  | { kind: 'invalid_argument'; detail: string };

export function handleGetRunFindings(
  deps: { db: Db; graph: ResourceGraph; knownTenants: readonly string[] },
  args: GetRunFindingsArgs,
): GetRunFindingsOutcome {
  if (!Number.isInteger(args.id) || args.id < 1) {
    return { kind: 'invalid_argument', detail: 'id must be a positive integer' };
  }
  const rows = getRunFindings(deps.db, args.id);
  const findings = rows.map((f) =>
    findingToSummaryDto(f, {
      isMuted: isMuted(deps.db, f.fingerprint),
      graph: deps.graph,
      knownTenants: deps.knownTenants,
    }),
  );
  return { kind: 'ok', findings, total: findings.length };
}

export const GET_RUN_FINDINGS_TOOL = {
  name: 'get_run_findings',
  description: 'List findings created or refreshed by a specific run.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'integer', minimum: 1 } },
    required: ['id'],
    additionalProperties: false,
  },
} as const;
