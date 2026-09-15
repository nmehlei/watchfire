import { getAdapterHealth, type AdapterHealthRow, type Db } from '../../../memory/index.js';

export type AdapterHealthOutcome = {
  kind: 'ok';
  adapters: AdapterHealthRow[];
  total: number;
};

export function handleAdapterHealth(
  deps: { db: Db; knownAdapters: readonly string[] },
): AdapterHealthOutcome {
  const adapters = getAdapterHealth(deps.db, deps.knownAdapters);
  return { kind: 'ok', adapters, total: adapters.length };
}

export const ADAPTER_HEALTH_TOOL = {
  name: 'adapter_health',
  description: 'Per-adapter last_observed_at + 24h observation count.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
} as const;
