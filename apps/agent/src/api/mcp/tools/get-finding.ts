import type { ResourceGraph } from '../../../config/types.js';
import { getFindingByFingerprint, isMuted, type Db } from '../../../memory/index.js';
import { findingToDto, shortFingerprint } from '../../shared/format.js';
import { resolveShortId } from '../../shared/resolve-id.js';
import type { AmbiguousCandidate, FindingDto } from '../../shared/types.js';

export interface ToolDeps {
  db: Db;
  graph: ResourceGraph;
  knownTenants: readonly string[];
}

export interface GetFindingArgs {
  id: string;
}

export type GetFindingOutcome =
  | { kind: 'ok'; dto: FindingDto }
  | { kind: 'invalid_argument'; detail: string }
  | { kind: 'not_found'; id: string }
  | { kind: 'ambiguous'; candidates: AmbiguousCandidate[] };

export function handleGetFinding(deps: ToolDeps, args: GetFindingArgs): GetFindingOutcome {
  const resolved = resolveShortId(deps.db, args.id, { minHex: 6 });
  if (resolved.kind === 'invalid') {
    return { kind: 'invalid_argument', detail: 'id must be 6+ hex chars' };
  }
  if (resolved.kind === 'none') return { kind: 'not_found', id: args.id };
  if (resolved.kind === 'ambiguous') {
    const candidates: AmbiguousCandidate[] = resolved.candidates
      .map((fp) => getFindingByFingerprint(deps.db, fp))
      .filter((f): f is NonNullable<typeof f> => f !== null)
      .map((f) => ({
        short_id: shortFingerprint(f.fingerprint),
        resource_id: f.resource_id,
        issue_class: f.issue_class,
        title: f.title,
        state: f.state,
      }));
    return { kind: 'ambiguous', candidates };
  }
  const f = getFindingByFingerprint(deps.db, resolved.fingerprint);
  if (!f) return { kind: 'not_found', id: args.id };

  const dto = findingToDto(f, {
    isMuted: isMuted(deps.db, f.fingerprint),
    graph: deps.graph,
    knownTenants: deps.knownTenants,
  });
  return { kind: 'ok', dto };
}

/** MCP tool descriptor — registered by src/api/mcp/server.ts. */
export const GET_FINDING_TOOL = {
  name: 'get_finding',
  description:
    'Resolve a finding by short ID (6+ hex chars) or full fingerprint and return its full context (title, evidence, likely_cause, severity, state, first/last seen, run count, affects, muted flag).',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: '6+ hex chars; short_id prefix or full 64-char fingerprint',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },
} as const;
