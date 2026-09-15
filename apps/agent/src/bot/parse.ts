// Parse a Telegram message text into a command + args. Spec 10 §Command surface.

import { isDuration, type Duration } from '../api/shared/duration.js';

export type ParsedCommand =
  | { kind: 'mute'; id: string; duration: Duration; reason: string | null }
  | { kind: 'unmute'; id: string }
  | { kind: 'mutes' }
  | { kind: 'help' }
  | { kind: 'usage-error'; command: string; message: string }
  | { kind: 'unknown'; raw: string }
  | { kind: 'not-a-command' };

const DEFAULT_MUTE_DURATION: Duration = '7d';

export function parseCommand(text: string): ParsedCommand {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return { kind: 'not-a-command' };

  // Split off any "@bot_name" suffix on the command word.
  const [head, ...rest] = trimmed.split(/\s+/);
  if (!head) return { kind: 'unknown', raw: trimmed };
  const command = head.split('@')[0]!.toLowerCase();

  switch (command) {
    case '/mute':
      return parseMute(rest);
    case '/unmute':
      return parseUnmute(rest);
    case '/mutes':
      return { kind: 'mutes' };
    case '/help':
    case '/start':
      return { kind: 'help' };
    default:
      return { kind: 'unknown', raw: trimmed };
  }
}

function parseMute(args: readonly string[]): ParsedCommand {
  if (args.length === 0) {
    return {
      kind: 'usage-error',
      command: '/mute',
      message: 'Usage: /mute <id> [1d|7d|30d|forever] [-- reason]',
    };
  }

  const dashDashIdx = args.indexOf('--');
  const headArgs = dashDashIdx === -1 ? args : args.slice(0, dashDashIdx);
  const reason =
    dashDashIdx === -1 ? null : args.slice(dashDashIdx + 1).join(' ').trim() || null;

  const id = headArgs[0];
  if (!id) {
    return {
      kind: 'usage-error',
      command: '/mute',
      message: 'Usage: /mute <id> [1d|7d|30d|forever] [-- reason]',
    };
  }

  let duration: Duration = DEFAULT_MUTE_DURATION;
  if (headArgs.length >= 2) {
    const candidate = headArgs[1]!;
    if (!isDuration(candidate)) {
      return {
        kind: 'usage-error',
        command: '/mute',
        message: `Duration must be 1d, 7d, 30d, or forever (got <code>${escapeForReply(candidate)}</code>).`,
      };
    }
    duration = candidate;
  }
  if (headArgs.length > 2) {
    return {
      kind: 'usage-error',
      command: '/mute',
      message: 'Too many arguments. Usage: /mute <id> [1d|7d|30d|forever] [-- reason]',
    };
  }

  return { kind: 'mute', id, duration, reason };
}

function parseUnmute(args: readonly string[]): ParsedCommand {
  const id = args[0];
  if (!id || args.length > 1) {
    return {
      kind: 'usage-error',
      command: '/unmute',
      message: 'Usage: /unmute <id>',
    };
  }
  return { kind: 'unmute', id };
}

function escapeForReply(s: string): string {
  return s.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'));
}
