import { getCostWindow, type CostWindowResult, type Db } from '../../../memory/index.js';

export interface CostWindowArgs {
  days?: number;
}

export type CostWindowOutcome =
  | { kind: 'ok'; body: CostWindowResult }
  | { kind: 'invalid_argument'; detail: string };

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;

export function handleCostWindow(deps: { db: Db }, args: CostWindowArgs): CostWindowOutcome {
  const days = args.days ?? DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return { kind: 'invalid_argument', detail: `days must be integer in [1, ${MAX_DAYS}]` };
  }
  return { kind: 'ok', body: getCostWindow(deps.db, { days }) };
}

export const COST_WINDOW_TOOL = {
  name: 'cost_window',
  description: 'Token cost aggregated over the trailing N days (default 30, max 90).',
  inputSchema: {
    type: 'object',
    properties: { days: { type: 'integer', minimum: 1, maximum: 90 } },
    additionalProperties: false,
  },
} as const;
