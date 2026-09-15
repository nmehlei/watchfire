import type { Db } from '../../memory/index.js';
import { getFindingByFingerprint } from '../../memory/index.js';
import { removeMute } from '../../api/shared/mute-actions.js';
import { esc, shortId } from '../../reporting/renderers/html.js';

export function handleUnmute(db: Db, rawId: string): string {
  const out = removeMute(db, { id: rawId, minHex: 4 });

  if (out.kind === 'invalid_argument') {
    return `❌ <code>${esc(rawId)}</code> doesn't look like a finding ID. Use the 6-char code shown next to each finding.`;
  }
  if (out.kind === 'not_found') {
    return `❌ No finding matches <code>${esc(rawId)}</code>. It may have been pruned (90-day window) or the ID is mistyped.`;
  }
  if (out.kind === 'ambiguous') {
    const list = out.candidates
      .slice(0, 5)
      .map((c) => `   <code>${c.short_id}</code>`)
      .join('\n');
    return [
      `❌ <code>${esc(rawId)}</code> matches multiple findings. Try a longer prefix:`,
      list,
    ].join('\n');
  }

  const finding = getFindingByFingerprint(db, out.fingerprint);
  const titlePart = finding ? ` (<i>${esc(finding.title)}</i>)` : '';

  if (out.deleted_count === 0) {
    return `<code>${shortId(out.fingerprint)}</code>${titlePart} wasn't muted. Nothing to do.`;
  }
  return `🔔 Unmuted <code>${shortId(out.fingerprint)}</code>${titlePart}. Will reappear in tonight's digest.`;
}
