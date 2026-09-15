import type { Severity } from '../../memory/types.js';

export function severityEmoji(s: Severity): string {
  switch (s) {
    case 'critical':
      return '🔴';
    case 'warn':
      return '🟡';
    case 'info':
      return '🟢';
  }
}
