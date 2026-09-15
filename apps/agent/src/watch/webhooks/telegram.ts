// Telegram webhook intake. Spec 10 §Authorization + spec 05 §Telegram webhook.

import { timingSafeEqual } from 'node:crypto';
import type { Db } from '../../memory/index.js';
import { dispatch } from '../../bot/router.js';

export interface TelegramAuthConfig {
  /** Required: matches X-Telegram-Bot-Api-Secret-Token header. */
  secretToken: string;
  /** Allowlist of chat ids permitted to issue commands. */
  allowedChatIds: ReadonlySet<number>;
}

export interface TelegramHandlerInput {
  db: Db;
  auth: TelegramAuthConfig;
  /** Bound function that sends a reply back via the Telegram Bot API. */
  sendReply: (text: string) => Promise<void>;
  /** Optional logger; default no-op. */
  log?: (msg: string, fields: Record<string, unknown>) => void;
}

export interface IncomingUpdate {
  body: unknown;
  /** Value of X-Telegram-Bot-Api-Secret-Token header. */
  secretHeader: string | undefined;
}

export type AuthFailure =
  | { kind: 'bad-secret' }
  | { kind: 'unauthorized-chat'; chatId: number | null };

export type HandleOutcome =
  | { kind: 'unauthenticated' } // → 401
  | { kind: 'silent-ignore' } // → 200, no reply, no DB writes
  | { kind: 'duplicate' } // → 200, dedup
  | { kind: 'dispatched'; command: string; outcome: string }; // → 200, reply queued

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  from?: { id: number };
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

const RECENT_UPDATES_LIMIT = 256;

/**
 * Build an intake handler with process-local dedup state. Each call to the
 * returned function consumes one update.
 */
export function createTelegramHandler(input: TelegramHandlerInput) {
  const seenUpdateIds = new Set<number>();
  const seenOrder: number[] = [];

  return async function handle(update: IncomingUpdate): Promise<HandleOutcome> {
    if (!verifySecret(input.auth.secretToken, update.secretHeader)) {
      input.log?.('telegram: secret-token mismatch', {});
      return { kind: 'unauthenticated' };
    }

    const parsed = parseUpdate(update.body);
    if (!parsed) {
      input.log?.('telegram: silent-ignore', { reason: 'unparseable-body' });
      return { kind: 'silent-ignore' };
    }

    const message = parsed.message ?? parsed.edited_message;
    const chatId = message?.chat.id ?? parsed.message?.from?.id ?? null;
    if (chatId === null || !input.auth.allowedChatIds.has(chatId)) {
      input.log?.('telegram: unauthorized chat', { chatId, updateId: parsed.update_id });
      return { kind: 'silent-ignore' };
    }

    if (seenUpdateIds.has(parsed.update_id)) {
      input.log?.('telegram: duplicate update', { updateId: parsed.update_id });
      return { kind: 'duplicate' };
    }
    seenUpdateIds.add(parsed.update_id);
    seenOrder.push(parsed.update_id);
    while (seenOrder.length > RECENT_UPDATES_LIMIT) {
      const evicted = seenOrder.shift();
      if (evicted !== undefined) seenUpdateIds.delete(evicted);
    }

    if (!message?.text) {
      input.log?.('telegram: silent-ignore', {
        reason: 'no-text',
        updateId: parsed.update_id,
        chatId,
      });
      return { kind: 'silent-ignore' };
    }

    const result = dispatch({ db: input.db, text: message.text });
    if (result.outcome === 'ignored') {
      return { kind: 'dispatched', command: result.command, outcome: result.outcome };
    }
    if (result.reply) {
      try {
        await input.sendReply(result.reply);
      } catch (err) {
        input.log?.('telegram: reply send failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    input.log?.('bot.command_dispatched', {
      command: result.command,
      outcome: result.outcome,
      chatId,
    });
    return { kind: 'dispatched', command: result.command, outcome: result.outcome };
  };
}

function verifySecret(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseUpdate(body: unknown): TelegramUpdate | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  if (typeof obj['update_id'] !== 'number') return null;
  return obj as unknown as TelegramUpdate;
}

export const _internal = { verifySecret, parseUpdate };
