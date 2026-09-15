import type { Db } from '../../../memory/index.js';
import { getEventBus } from '../../events/bus.js';
import { removeMute, type RemoveMuteOutcome } from '../../shared/mute-actions.js';

export interface UnmuteFindingArgs {
  id: string;
}

export type UnmuteFindingOutcome = RemoveMuteOutcome;

export function handleUnmuteFinding(
  deps: { db: Db },
  args: UnmuteFindingArgs,
): UnmuteFindingOutcome {
  const out = removeMute(deps.db, args);
  if (out.kind === 'ok' && out.deleted_count > 0) {
    getEventBus().emit('mute.deleted', { fingerprint: out.fingerprint });
  }
  return out;
}

export const UNMUTE_FINDING_TOOL = {
  name: 'unmute_finding',
  description: 'Remove all mute entries for a finding by short id or fingerprint.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string', minLength: 6 } },
    required: ['id'],
    additionalProperties: false,
  },
} as const;
