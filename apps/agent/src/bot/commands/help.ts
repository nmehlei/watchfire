// Static help text for /help and /start. HTML format per spec 07.

export function helpText(): string {
  return [
    '🤖 <b>Watchfire bot commands</b>',
    '',
    '<code>/mute &lt;id&gt; [1d|7d|30d|forever] [-- reason]</code>',
    '   Suppress a finding from digests + pages. Default duration 7d.',
    '',
    '<code>/unmute &lt;id&gt;</code>',
    '   Re-enable a previously muted finding.',
    '',
    '<code>/mutes</code>',
    '   List active mutes.',
    '',
    '<code>/help</code>',
    '   Show this message.',
    '',
    'IDs are the 6-char codes shown next to each finding in digests and pages.',
  ].join('\n');
}
