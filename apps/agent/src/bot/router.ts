import type { Db } from '../memory/index.js';
import { esc } from '../reporting/renderers/html.js';
import { handleMute } from './commands/mute.js';
import { handleMutes } from './commands/mutes.js';
import { handleUnmute } from './commands/unmute.js';
import { helpText } from './commands/help.js';
import { parseCommand } from './parse.js';

export interface DispatchInput {
  db: Db;
  text: string;
}

export interface DispatchResult {
  reply: string;
  command: string;
  outcome: 'ok' | 'usage-error' | 'unknown' | 'ignored' | 'error';
}

/**
 * Parse a Telegram message text and produce a reply. Pure function aside from
 * the DB writes the underlying command handlers do — exposing reply text lets
 * the webhook send it via the existing telegram client.
 */
export function dispatch(input: DispatchInput): DispatchResult {
  const parsed = parseCommand(input.text);

  switch (parsed.kind) {
    case 'not-a-command':
      return { reply: '', command: 'none', outcome: 'ignored' };
    case 'help':
      return { reply: helpText(), command: '/help', outcome: 'ok' };
    case 'mutes':
      return { reply: handleMutes(input.db), command: '/mutes', outcome: 'ok' };
    case 'mute':
      return {
        reply: handleMute({
          db: input.db,
          id: parsed.id,
          duration: parsed.duration,
          reason: parsed.reason,
        }),
        command: '/mute',
        outcome: 'ok',
      };
    case 'unmute':
      return { reply: handleUnmute(input.db, parsed.id), command: '/unmute', outcome: 'ok' };
    case 'usage-error':
      return {
        reply: `❌ ${parsed.message}`,
        command: parsed.command,
        outcome: 'usage-error',
      };
    case 'unknown':
      return {
        reply: [`❓ Unknown command: <code>${esc(parsed.raw)}</code>`, '', helpText()].join('\n'),
        command: 'unknown',
        outcome: 'unknown',
      };
  }
}
