import type { ResourceGraph } from '../config/types.js';
import type { Finding, Run } from '../memory/types.js';
import { severityRank } from '../memory/types.js';
import { expandAffects } from './affects.js';
import { esc, shortId } from './renderers/html.js';
import { severityEmoji } from './renderers/severity.js';

export interface PageInput {
  run: Run;
  findings: readonly Finding[];
  /** Free-text summary of the triggering upstream alert. */
  alertSummary: string;
  /** Optional alert source label (e.g. 'OpenObserve "disk-high"'). */
  alertSource?: string;
  graph: ResourceGraph;
  knownTenants?: readonly string[];
  runContextTenant?: string;
  /** HH:MM of the next scheduled nightly in Europe/Berlin. */
  nextNightlyHHMM: string;
  /** The watch verdict's reason field. */
  verdictReason?: string;
}

function pickPrimary(findings: readonly Finding[]): Finding | null {
  if (findings.length === 0) return null;
  const sorted = [...findings].sort((a, b) => {
    const sev = severityRank(b.severity) - severityRank(a.severity);
    if (sev !== 0) return sev;
    return a.id - b.id;
  });
  return sorted[0] ?? null;
}

function tenantPrefix(
  f: Finding,
  opts: { graph: ResourceGraph; knownTenants?: readonly string[]; runContextTenant?: string },
): string {
  const tenants = expandAffects(f.resource_id, opts.graph, {
    knownTenants: opts.knownTenants,
    runContextTenant: opts.runContextTenant,
  });
  return `[${tenants.join(', ')}]`;
}

/**
 * Compose a 🚨 watch page as Telegram HTML. Returns null if there are no
 * findings to page on (the caller should not send an empty page).
 */
export function composePage(input: PageInput): string | null {
  const primary = pickPrimary(input.findings);
  if (!primary) return null;

  const lines: string[] = [];
  lines.push(`🚨 ${tenantPrefix(primary, input)} <b>${esc(primary.title)}</b>`);
  lines.push(`<code>${shortId(primary.fingerprint)}</code> · <code>${esc(primary.resource_id)}</code>`);
  lines.push(`Severity: ${severityEmoji(primary.severity)} <b>${primary.severity}</b>`);
  const sourcePart = input.alertSource ? `<i>${esc(input.alertSource)}</i> — ` : '';
  lines.push(`Triggered by: ${sourcePart}${esc(input.alertSummary)}`);
  if (primary.evidence) lines.push(`<blockquote>${esc(primary.evidence)}</blockquote>`);
  if (primary.likely_cause) lines.push(`<i>${esc(primary.likely_cause)}</i>`);
  if (input.verdictReason) lines.push(`Reason: ${esc(input.verdictReason)}`);
  lines.push(`→ Next nightly: <code>${esc(input.nextNightlyHHMM)}</code>`);

  const extras = input.findings.filter((f) => f !== primary);
  if (extras.length > 0) {
    lines.push('');
    lines.push('Also seen:');
    for (const f of extras) {
      lines.push(
        `${severityEmoji(f.severity)} ${tenantPrefix(f, input)} <b>${esc(f.title)}</b> — ` +
          `<code>${shortId(f.fingerprint)}</code> · <code>${esc(f.resource_id)}</code>`,
      );
    }
  }

  return lines.join('\n');
}
