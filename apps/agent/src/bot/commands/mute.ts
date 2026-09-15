import type { Db } from '../../memory/index.js';
import { applyMute } from '../../api/shared/mute-actions.js';
import type { Duration } from '../../api/shared/duration.js';
import { getFindingByFingerprint } from '../../memory/index.js';
import { esc, shortId } from '../../reporting/renderers/html.js';

export interface MuteCommandInput {
  db: Db;
  id: string;
  duration: Duration;
  reason: string | null;
  now?: Date;
}

export function handleMute(input: MuteCommandInput): string {
  const out = applyMute(input.db, {
    id: input.id,
    duration: input.duration,
    reason: input.reason,
    source: 'telegram',
    minHex: 4,
  });

  if (out.kind === 'invalid_argument') {
    return `❌ <code>${esc(input.id)}</code> doesn't look like a finding ID. Use the 6-char code shown next to each finding.`;
  }
  if (out.kind === 'not_found') {
    return `❌ No finding matches <code>${esc(input.id)}</code>. It may have been pruned (90-day window) or the ID is mistyped.`;
  }
  if (out.kind === 'ambiguous') {
    const list = out.candidates
      .slice(0, 5)
      .map((c) => `   <code>${c.short_id}</code>`)
      .join('\n');
    return [
      `❌ <code>${esc(input.id)}</code> matches multiple findings. Try a longer prefix:`,
      list,
    ].join('\n');
  }

  const finding = getFindingByFingerprint(input.db, out.fingerprint);
  const titleSuffix = finding ? ` (<i>${esc(finding.title)}</i>)` : '';
  const untilPart = out.expires_at
    ? `until <code>${out.expires_at.slice(0, 10)}</code>`
    : '<b>indefinitely</b>';
  return `🤫 Muted <code>${shortId(out.fingerprint)}</code> ${untilPart}${titleSuffix}.`;
}
