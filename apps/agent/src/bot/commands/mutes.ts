import { listActiveMutes, type Db } from '../../memory/index.js';
import { esc } from '../../reporting/renderers/html.js';

const MAX_LISTED = 50;

export function handleMutes(db: Db): string {
  const rows = listActiveMutes(db, MAX_LISTED);
  if (rows.length === 0) return '🔔 No active mutes.';

  const lines: string[] = [`🤫 <b>Active mutes</b> (${rows.length})`, ''];
  for (const m of rows) {
    const id = m.fingerprint.slice(0, 6);
    const titlePart = m.finding_title
      ? ` · ${esc(m.finding_title)}`
      : ' · <i>finding pruned</i>';
    lines.push(`<code>${id}</code>${titlePart}`);
    const until = m.expires_at
      ? `until <code>${m.expires_at.slice(0, 10)}</code>`
      : '<b>indefinite</b>';
    const reasonPart = m.reason ? ` · ${esc(m.reason)}` : '';
    lines.push(`   ${until}${reasonPart}`);
    lines.push('');
  }
  // Trim trailing blank.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}
