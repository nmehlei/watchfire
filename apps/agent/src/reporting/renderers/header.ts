import type { SuppressedPagesWindow } from '../../memory/runs.js';
import type { Run } from '../../memory/types.js';
import { esc } from './html.js';

const SAFETY_REASON_TRUNCATE = 200;

/**
 * Nightly terminated with status='error'. Safety hard-blocks (error starts with
 * 'safety:') get the louder 🚨 treatment per specs/07-reporting.md.
 */
export function renderErrorHeader(run: Run): string {
  const reason = run.error ?? 'unknown';
  if (reason.startsWith('safety:')) {
    const truncated =
      reason.length > SAFETY_REASON_TRUNCATE
        ? reason.slice(0, SAFETY_REASON_TRUNCATE - 3) + '...'
        : reason;
    return [
      '🚨 <b>SAFETY VIOLATION</b>: Last nightly was terminated.',
      `Reason: <code>${esc(truncated)}</code>`,
      'Digest below reflects only findings emitted before termination.',
      'Resolution sweep <b>SKIPPED</b>.',
    ].join('\n');
  }
  return [
    `⚠️ <b>Last nightly terminated on error</b>: ${esc(reason)}`,
    'Digest below reflects findings emitted before termination. Resolution sweep was <b>SKIPPED</b>.',
  ].join('\n');
}

export function renderTruncatedHeader(): string {
  return [
    '⚠️ <b>Nightly hit its 20-turn budget</b> before the agent concluded.',
    'Findings emitted are final; agent may not have visited every tenant. Resolution sweep ran.',
  ].join('\n');
}

export function renderSuppressedHeader(w: SuppressedPagesWindow): string {
  if (w.count === 0) return '';
  const start = w.windowStart ? w.windowStart.slice(11, 16) : '?';
  const end = w.windowEnd ? w.windowEnd.slice(11, 16) : '?';
  const pageWord = w.count === 1 ? 'page was' : 'pages were';
  return `⚠️ <b>${w.count} ${pageWord} suppressed</b> between ${start} and ${end} (rate limit: 6/h). Their findings are included in the Ongoing/New sections below.`;
}
