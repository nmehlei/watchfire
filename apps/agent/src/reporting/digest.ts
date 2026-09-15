import type { ResourceGraph } from '../config/types.js';
import type { SuppressedPagesWindow } from '../memory/runs.js';
import type { Finding, Run } from '../memory/types.js';
import { severityRank } from '../memory/types.js';
import { renderFinding } from './renderers/finding.js';
import { parseSqliteUtc } from './renderers/age.js';
import { esc } from './renderers/html.js';
import {
  renderErrorHeader,
  renderSuppressedHeader,
  renderTruncatedHeader,
} from './renderers/header.js';
import { displayState, isEscalating } from './renderers/state.js';

function isSafetyViolation(run: Run): boolean {
  return run.status === 'error' && (run.error ?? '').startsWith('safety:');
}

/**
 * Hard errors (e.g. API credit exhaustion) that terminate before any
 * analysis happened produce zero new observations — the findings list is
 * byte-identical to the previous digest. Repeating it nightly buries the
 * one thing that actually changed (the failure) in noise the operator has
 * already seen. Send a short, loud alert instead of the full digest.
 */
function composeHardErrorDigest(
  run: Run,
  counts: { new: number; escalating: number; ongoing: number; resolved: number },
): string {
  const openCount = counts.new + counts.escalating + counts.ongoing;
  const reason = run.error ?? 'unknown';
  const lines = [
    `🔴 <b>NIGHTLY FAILED</b> — no new/updated findings could be discovered.`,
    `Reason: <code>${esc(reason)}</code>`,
  ];
  lines.push(
    openCount > 0
      ? `${openCount} finding${openCount === 1 ? ' was' : 's were'} still open as of the last successful check — unchanged, not re-verified. Digest suppressed to avoid repeating stale data; check /findings for the current list.`
      : 'No findings were open as of the last successful check.',
  );
  return lines.join('\n\n');
}

export interface DigestInput {
  run: Run;
  findings: readonly Finding[];
  suppressedPages: SuppressedPagesWindow;
  graph: ResourceGraph;
  knownTenants?: readonly string[];
  /**
   * Set of fingerprints actively muted. Filtered out of all sections; the
   * count is surfaced in the Run footer. Pass an empty Set when no mutes apply.
   */
  mutedFingerprints?: ReadonlySet<string>;
  /** Current time for age computation; default Date.now(). */
  now?: string | number;
}

const COMPLETED_AT_FALLBACK = 'unknown';

function formatCompletedAt(run: Run): string {
  // Berlin-time is handled at the source (cron is in Berlin). SQLite values
  // are UTC; the cron happens at 02:30 Berlin which is 00:30 UTC in winter
  // or 23:30 UTC in summer. For v1 we render the raw UTC value — operator
  // knows the cron window. Proper tz rendering is an Open Question in 07.
  return run.completed_at ?? run.started_at ?? COMPLETED_AT_FALLBACK;
}

function sortForSection(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const sev = severityRank(b.severity) - severityRank(a.severity);
    if (sev !== 0) return sev;
    return parseSqliteUtc(b.last_seen_at) - parseSqliteUtc(a.last_seen_at);
  });
}

function sortResolved(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const at = parseSqliteUtc(a.resolved_at ?? a.last_seen_at);
    const bt = parseSqliteUtc(b.resolved_at ?? b.last_seen_at);
    return bt - at;
  });
}

function bucketize(findings: readonly Finding[]): {
  fresh: Finding[];
  escalating: Finding[];
  ongoing: Finding[];
  resolved: Finding[];
} {
  const fresh: Finding[] = [];
  const escalating: Finding[] = [];
  const ongoing: Finding[] = [];
  const resolved: Finding[] = [];
  for (const f of findings) {
    const ds = displayState(f);
    if (ds === 'resolved') resolved.push(f);
    else if (ds === 'escalating') escalating.push(f);
    else if (ds === 'new') fresh.push(f);
    else if (f.state === 'ongoing' && !isEscalating(f)) ongoing.push(f);
  }
  return {
    fresh: sortForSection(fresh),
    escalating: sortForSection(escalating),
    ongoing: sortForSection(ongoing),
    resolved: sortResolved(resolved),
  };
}

function renderSection(
  title: string,
  mode: 'full' | 'condensed' | 'resolved-oneliner',
  findings: readonly Finding[],
  graph: ResourceGraph,
  knownTenants?: readonly string[],
  now?: string | number,
): string | null {
  if (findings.length === 0) return null;
  const parts: string[] = [`━ ${title} ━ (${findings.length})`];
  const knownTenantsReadonly = knownTenants ? Array.from(knownTenants) : undefined;
  for (const f of findings) {
    parts.push(renderFinding(f, mode, { graph, now, knownTenants: knownTenantsReadonly }));
  }
  return parts.join('\n\n');
}

function renderRunFooter(
  run: Run,
  counts: { new: number; escalating: number; ongoing: number; resolved: number },
  mutedCount: number,
): string {
  const total = counts.new + counts.escalating + counts.ongoing + counts.resolved;
  // Cache hit rate = cache_read / total_input_tokens. Anthropic's `tokens_in`
  // counts only uncached input; `tokens_cached` counts cache reads. Total
  // input is the sum.
  const totalInput = (run.tokens_in ?? 0) + (run.tokens_cached ?? 0);
  const cachePct =
    totalInput > 0 && run.tokens_cached != null
      ? `${Math.round((run.tokens_cached / totalInput) * 100)}%`
      : '—';
  const cost = run.cost_eur != null ? `€${run.cost_eur.toFixed(2)}` : '€—';
  const turns = run.turn_count != null ? `${run.turn_count} turns` : '—';
  const lines = [
    '━ Run ━',
    `${total} findings (${counts.new} new, ${counts.escalating} escalating, ${counts.ongoing} ongoing, ${counts.resolved} cleared) · ${turns} · ${cost} · cache ${cachePct}`,
  ];
  if (mutedCount > 0) {
    const noun = mutedCount === 1 ? 'finding' : 'findings';
    lines.push(`🤫 ${mutedCount} muted ${noun} hidden · reply <code>/mute &lt;id&gt;</code> to suppress more`);
  }
  return lines.join('\n');
}

/**
 * Compose the nightly 🌙 digest as plain text. Length-splitting is a separate
 * concern (see src/reporting/length.ts); this function returns the full digest
 * as one string.
 */
export function composeDigest(input: DigestInput): string {
  const { run, findings, suppressedPages, graph, knownTenants, now } = input;
  const muted = input.mutedFingerprints ?? new Set<string>();

  const visible: Finding[] = [];
  let mutedCount = 0;
  for (const f of findings) {
    if (muted.has(f.fingerprint)) {
      mutedCount += 1;
    } else {
      visible.push(f);
    }
  }

  const buckets = bucketize(visible);
  const counts = {
    new: buckets.fresh.length,
    escalating: buckets.escalating.length,
    ongoing: buckets.ongoing.length,
    resolved: buckets.resolved.length,
  };

  // Safety-violation and truncated runs still did partial analysis, so the
  // (partial) findings body is real signal and rendered as usual below.
  // A plain hard error did none — skip straight to the compact alert.
  if (run.status === 'error' && !isSafetyViolation(run)) {
    return composeHardErrorDigest(run, counts);
  }

  const headerLines: string[] = [`🌙 <b>Nightly digest</b> — ${formatCompletedAt(run)}`];
  if (run.status === 'error') headerLines.push(renderErrorHeader(run));
  if (run.status === 'truncated') headerLines.push(renderTruncatedHeader());
  const suppressed = renderSuppressedHeader(suppressedPages);
  if (suppressed) headerLines.push(suppressed);

  const sections: (string | null)[] = [
    renderSection('New', 'full', buckets.fresh, graph, knownTenants, now),
    renderSection('Escalating', 'full', buckets.escalating, graph, knownTenants, now),
    renderSection('Ongoing', 'condensed', buckets.ongoing, graph, knownTenants, now),
    renderSection('Cleared (last 7 days)', 'resolved-oneliner', buckets.resolved, graph, knownTenants, now),
  ];

  const body = sections.filter((s): s is string => s !== null).join('\n\n');

  const parts: string[] = [];
  parts.push(headerLines.join('\n'));

  if (counts.new + counts.escalating + counts.ongoing + counts.resolved === 0) {
    parts.push('All quiet — nothing to report.');
  } else {
    parts.push(body);
  }

  parts.push(renderRunFooter(run, counts, mutedCount));

  return parts.join('\n\n');
}
