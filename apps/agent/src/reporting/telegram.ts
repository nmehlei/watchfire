// Minimal Telegram Bot API send client. parse_mode=HTML per specs/07.
// See specs/07-reporting.md §Send path.

export interface TelegramResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface TelegramFetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
}

export type TelegramFetch = (url: string, init: TelegramFetchInit) => Promise<TelegramResponseLike>;

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  /** Injection point for testing; default uses globalThis.fetch. */
  fetch?: TelegramFetch;
  /** Injection point for testing; default uses setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

export class TelegramSendError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Telegram send failed: ${status} — ${body.slice(0, 200)}`);
    this.name = 'TelegramSendError';
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultFetch(): TelegramFetch {
  // Node 22 exposes fetch globally.
  return globalThis.fetch as unknown as TelegramFetch;
}

/**
 * Send one plain-text message to the configured Telegram chat.
 * Retries once on 429 (honoring Retry-After) or 5xx (2s backoff).
 * Otherwise raises TelegramSendError.
 */
export async function sendTelegramMessage(config: TelegramConfig, text: string): Promise<void> {
  const fetchImpl = config.fetch ?? defaultFetch();
  const sleep = config.sleep ?? defaultSleep;
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const body = JSON.stringify({
    chat_id: config.chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

  for (let attempt = 1; attempt <= 2; attempt++) {
    const resp = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (resp.ok) return;

    const respBody = await resp.text();

    // Retry 429 and 5xx exactly once.
    if (attempt === 1 && (resp.status === 429 || resp.status >= 500)) {
      if (resp.status === 429) {
        const hdr = resp.headers.get('retry-after');
        const secs = hdr ? parseInt(hdr, 10) : 5;
        const safeSecs = Number.isFinite(secs) && secs > 0 ? secs : 5;
        await sleep(safeSecs * 1000);
      } else {
        await sleep(2000);
      }
      continue;
    }

    throw new TelegramSendError(resp.status, respBody);
  }
}

/** Convenience: send a sequence of parts (e.g. from splitForTelegram) in order. */
export async function sendTelegramMessageParts(
  config: TelegramConfig,
  parts: readonly string[],
): Promise<void> {
  for (const p of parts) {
    await sendTelegramMessage(config, p);
  }
}
