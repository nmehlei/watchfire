import type { Finding } from '../../memory/types.js';
import { severityRank } from '../../memory/types.js';

/** Display state at render time. Distinct from persisted state in findings.state. */
export type DisplayState = 'new' | 'escalating' | 'ongoing' | 'resolved';

export function stateEmoji(s: DisplayState): string {
  switch (s) {
    case 'new':
      return '🆕';
    case 'escalating':
      return '⚠️';
    case 'ongoing':
      return '🔁';
    case 'resolved':
      return '✅';
  }
}

/** An ongoing finding whose severity increased since last sighting. */
export function isEscalating(f: Finding): boolean {
  return (
    f.state === 'ongoing' &&
    f.prev_severity !== null &&
    severityRank(f.severity) > severityRank(f.prev_severity)
  );
}

export function displayState(f: Finding): DisplayState {
  if (f.state === 'resolved') return 'resolved';
  if (f.state === 'new') return 'new';
  return isEscalating(f) ? 'escalating' : 'ongoing';
}
