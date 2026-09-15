// Parsing for the `___WATCHFIRE_OBS:` stdout trailer (spec 03 §Observation emission).
//
// Adapters are Bash-invoked subprocesses with no DB handle and no run_id, so
// they report measurements by appending trailer lines to stdout. The runner
// parses them and persists with the run_id it already holds.

/** One parsed measurement. `run_id` is supplied by the runner, not the adapter. */
export interface ObservationTrailer {
  tenant: string;
  /** Emitting adapter. Self-declared: tool results don't carry their command. */
  source: string;
  subject: string;
  metric: string;
  value: number;
}

// The prefix is defined adapter-side; the runner consumes what adapters emit.
export { OBS_TRAILER_PREFIX } from '../adapters/trailer.js';
import { OBS_TRAILER_PREFIX } from '../adapters/trailer.js';

const FIELD_RE = /(\w+)=(\S+)/g;

/**
 * Extract observation trailers from adapter stdout.
 *
 * Best-effort by design: a malformed line is skipped, never thrown. Telemetry
 * must not be able to fail a run, and one bad line must not discard its valid
 * siblings.
 */
export function parseObservationTrailers(stdout: string): ObservationTrailer[] {
  const out: ObservationTrailer[] = [];

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith(OBS_TRAILER_PREFIX)) continue;

    const fields = new Map<string, string>();
    for (const [, key, value] of line.slice(OBS_TRAILER_PREFIX.length).matchAll(FIELD_RE)) {
      fields.set(key!, value!);
    }

    const tenant = fields.get('tenant');
    const source = fields.get('source');
    const subject = fields.get('subject');
    const metric = fields.get('metric');
    const value = Number(fields.get('value'));

    // All five fields are required; a partial trailer would persist a
    // half-populated row that no query could interpret.
    if (!tenant || !source || !subject || !metric) continue;
    if (!Number.isFinite(value)) continue;

    out.push({ tenant, source, subject, metric, value });
  }

  return out;
}
