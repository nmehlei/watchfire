import { listActiveMutes, type ActiveMute, type Db } from '../../../memory/index.js';

export type ListMutesOutcome = { kind: 'ok'; mutes: ActiveMute[]; total: number };

export function handleListMutes(deps: { db: Db }): ListMutesOutcome {
  const mutes = listActiveMutes(deps.db);
  return { kind: 'ok', mutes, total: mutes.length };
}

export const LIST_MUTES_TOOL = {
  name: 'list_mutes',
  description: 'List currently active mutes.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
} as const;
