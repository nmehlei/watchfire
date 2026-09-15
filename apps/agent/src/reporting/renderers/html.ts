/**
 * Telegram HTML escape. Spec 07 §Formatting conventions: only `<`, `>`, `&`
 * need escaping for parse_mode=HTML.
 */
export function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'));
}

/** First 6 hex chars of a fingerprint — operator-friendly mute target. */
export function shortId(fingerprint: string): string {
  return fingerprint.slice(0, 6);
}
