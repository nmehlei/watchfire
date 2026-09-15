// Static facts about each adapter, independent of what any run happened to do.
//
// `emitsObservations` is the authority behind adapter_health's flag of the same
// name (spec 11). It is deliberately declared here rather than inferred from
// the observations table: an adapter that *should* emit but has gone quiet must
// read as stale from its very first run, not as "never emitted, working fine".

import type { AdapterName } from '../nightly/prompt.js';

export interface AdapterDescriptor {
  name: AdapterName;
  /** Whether this adapter reports `___IRIS_OBS:` trailers (spec 03). */
  emitsObservations: boolean;
}

export const ADAPTER_REGISTRY: readonly AdapterDescriptor[] = [
  // Query a telemetry system that already retains its own history.
  { name: 'obs-search', emitsObservations: false },
  { name: 'obs-metrics', emitsObservations: false },
  { name: 'obs-streams', emitsObservations: false },
  { name: 'obs-alerts', emitsObservations: false },
  // Credentialed shells over vendor CLIs; output is structural, not numeric.
  { name: 'az-as', emitsObservations: false },
  { name: 'hcloud-as', emitsObservations: false },
  { name: 'kubectl-as', emitsObservations: false },
  { name: 'ssh-as', emitsObservations: false },
  // Direct probes — the numeric time-series adapters.
  { name: 'check-ssl', emitsObservations: true },
  { name: 'check-http', emitsObservations: true },
  // Reports red pipelines as findings; the "red for N days" signal is the
  // finding's age, not a time series — so no observations.
  { name: 'check-ado', emitsObservations: false },
];

const BY_NAME = new Map(ADAPTER_REGISTRY.map((a) => [a.name as string, a]));

/** False for unknown adapters, so they never render as stale telemetry. */
export function emitsObservations(source: string): boolean {
  return BY_NAME.get(source)?.emitsObservations ?? false;
}
