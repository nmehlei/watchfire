import type { ResourceGraph } from '../../config/types.js';
import type { Finding, Severity } from '../../memory/types.js';
import { expandAffects, type AffectsOptions } from '../affects.js';
import { formatAge, parseSqliteUtc } from './age.js';
import { esc, shortId } from './html.js';
import { severityEmoji } from './severity.js';
import { displayState, stateEmoji, type DisplayState } from './state.js';

export type RenderMode = 'full' | 'condensed' | 'resolved-oneliner';

export interface RenderOptions extends AffectsOptions {
  graph: ResourceGraph;
  /** Current time for age computation. SQLite format 'YYYY-MM-DD HH:MM:SS' UTC, or ms. */
  now?: string | number | undefined;
}

function tenantPrefix(f: Finding, opts: RenderOptions): string {
  const tenants = expandAffects(f.resource_id, opts.graph, {
    knownTenants: opts.knownTenants,
    runContextTenant: opts.runContextTenant,
  });
  return `[${tenants.join(', ')}]`;
}

function nowValue(opts: RenderOptions): string | number {
  return opts.now ?? Date.now();
}

function renderResolvedOneliner(f: Finding, opts: RenderOptions): string {
  const cleared = f.resolved_at ? f.resolved_at.slice(0, 10) : 'unknown';
  return `${stateEmoji('resolved')} ${tenantPrefix(f, opts)} <b>${esc(f.title)}</b> — cleared ${cleared}`;
}

function headerLine(f: Finding, ds: DisplayState, opts: RenderOptions): string {
  return `${stateEmoji(ds)} ${severityEmoji(f.severity)} ${tenantPrefix(f, opts)} <b>${esc(f.title)}</b>`;
}

function resourceLine(f: Finding, suffix: string): string {
  return `<code>${shortId(f.fingerprint)}</code> · <code>${esc(f.resource_id)}</code>${suffix}`;
}

function evidenceBlock(evidence: string): string {
  return `<blockquote>${esc(evidence)}</blockquote>`;
}

function renderFull(f: Finding, ds: DisplayState, opts: RenderOptions): string {
  let suffix = '';
  if (ds === 'escalating' && f.prev_severity) {
    const age = formatAge(f.first_seen_at, nowValue(opts));
    const prev = f.prev_severity as Severity;
    suffix =
      ` · severity ${severityEmoji(prev)} ${prev} → ${severityEmoji(f.severity)} ${f.severity}` +
      ` · age <code>${esc(age)}</code>`;
  }

  const lines: string[] = [headerLine(f, ds, opts), resourceLine(f, suffix)];
  if (f.evidence) lines.push(evidenceBlock(f.evidence));
  if (f.likely_cause) lines.push(`<i>${esc(f.likely_cause)}</i>`);
  return lines.join('\n');
}

function renderCondensed(f: Finding, ds: DisplayState, opts: RenderOptions): string {
  const age = formatAge(f.first_seen_at, nowValue(opts));
  const noun = f.run_count === 1 ? 'night' : 'nights';
  const suffix = ` · <code>${f.run_count}</code> ${noun} in a row · age <code>${esc(age)}</code>`;
  const lines: string[] = [headerLine(f, ds, opts), resourceLine(f, suffix)];
  if (f.evidence) {
    const oneLine = f.evidence.replace(/\s+/g, ' ').trim();
    if (oneLine) lines.push(evidenceBlock(oneLine));
  }
  return lines.join('\n');
}

/**
 * Render a single finding as Telegram HTML. Mode selects layout:
 *  - 'full': title + short id + resource + evidence blockquote + likely_cause + escalation footer.
 *  - 'condensed': used for Ongoing findings in digests (one-line evidence, no likely_cause).
 *  - 'resolved-oneliner': used for Cleared section.
 */
export function renderFinding(f: Finding, mode: RenderMode, opts: RenderOptions): string {
  const ds = displayState(f);

  if (mode === 'resolved-oneliner' || ds === 'resolved') {
    return renderResolvedOneliner(f, opts);
  }
  if (mode === 'condensed') return renderCondensed(f, ds, opts);
  return renderFull(f, ds, opts);
}

export { parseSqliteUtc };
