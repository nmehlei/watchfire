import type { Db } from '../../../memory/index.js';
import { getEventBus } from '../../events/bus.js';
import { applyMute, type ApplyMuteOutcome } from '../../shared/mute-actions.js';

export interface MuteFindingArgs {
  id: string;
  duration?: string;
  reason?: string;
}

export type MuteFindingOutcome = ApplyMuteOutcome;

export function handleMuteFinding(deps: { db: Db }, args: MuteFindingArgs): MuteFindingOutcome {
  const out = applyMute(deps.db, {
    id: args.id,
    ...(args.duration ? { duration: args.duration } : {}),
    ...(args.reason !== undefined ? { reason: args.reason } : {}),
    source: 'manual',
  });
  if (out.kind === 'ok') {
    getEventBus().emit('mute.created', { fingerprint: out.fingerprint });
  }
  return out;
}

export const MUTE_FINDING_TOOL = {
  name: 'mute_finding',
  description:
    'Mute a finding by short id or fingerprint. Optional duration ("1d", "7d", "30d", "forever") and reason. Absent duration → indefinite.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 6 },
      duration: { type: 'string', enum: ['1d', '7d', '30d', 'forever'] },
      reason: { type: 'string' },
    },
    required: ['id'],
    additionalProperties: false,
  },
} as const;
