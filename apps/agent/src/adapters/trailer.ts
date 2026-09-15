// Adapter side of the `___WATCHFIRE_OBS:` wire format (spec 03 §Observation emission).
//
// Adapters are subprocesses with no DB handle, so they report measurements by
// appending trailer lines to stdout. The runner parses them back out — see
// `src/agent/trailer.ts` for the consuming half.

export const OBS_TRAILER_PREFIX = '___WATCHFIRE_OBS:';

/** One measurement. `tenant` and `source` are shared across a render call. */
export interface Measurement {
  subject: string;
  metric: string;
  value: number;
}

/**
 * Render trailer lines for a batch of measurements from one adapter run.
 *
 * Returns '' for an empty batch so callers can concatenate unconditionally.
 * Non-finite values are dropped: a failed probe has no measurement, and a NaN
 * would poison the baselines these feed.
 */
export function renderObservationTrailers(
  tenant: string,
  source: string,
  measurements: readonly Measurement[],
): string {
  return measurements
    .filter((m) => Number.isFinite(m.value))
    .map(
      (m) =>
        `${OBS_TRAILER_PREFIX} tenant=${tenant} source=${source} ` +
        `subject=${m.subject} metric=${m.metric} value=${m.value}`,
    )
    .join('\n');
}
