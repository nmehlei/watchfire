import { describe, expect, it } from 'vitest';
import {
  sendTelegramMessage,
  sendTelegramMessageParts,
  TelegramSendError,
  type TelegramFetch,
  type TelegramResponseLike,
} from './telegram.js';

function makeResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): TelegramResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string): string | null {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    text: () => Promise.resolve(body),
  };
}

describe('sendTelegramMessage', () => {
  it('sends a POST with the right shape and resolves on 200', async () => {
    const calls: Array<{ url: string; init: unknown }> = [];
    const fetchMock: TelegramFetch = async (url, init) => {
      calls.push({ url, init });
      return makeResponse(200, '{"ok":true,"result":{}}');
    };
    await sendTelegramMessage(
      { botToken: 'T', chatId: '-100', fetch: fetchMock, sleep: async () => {} },
      'hello',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.telegram.org/botT/sendMessage');
    const init = calls[0]!.init as { method: string; body: string; headers: Record<string, string> };
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    const parsed = JSON.parse(init.body) as {
      chat_id: string;
      text: string;
      parse_mode: string;
      disable_web_page_preview: boolean;
    };
    expect(parsed).toEqual({
      chat_id: '-100',
      text: 'hello',
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  });

  it('retries once on 429 honoring Retry-After', async () => {
    const sleeps: number[] = [];
    let call = 0;
    const fetchMock: TelegramFetch = async () => {
      call++;
      if (call === 1) return makeResponse(429, 'too many', { 'retry-after': '3' });
      return makeResponse(200, 'ok');
    };
    await sendTelegramMessage(
      {
        botToken: 'T',
        chatId: '-100',
        fetch: fetchMock,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
      'hello',
    );
    expect(call).toBe(2);
    expect(sleeps).toEqual([3000]);
  });

  it('defaults Retry-After to 5s when header absent', async () => {
    const sleeps: number[] = [];
    let call = 0;
    const fetchMock: TelegramFetch = async () => {
      call++;
      if (call === 1) return makeResponse(429, 'too many');
      return makeResponse(200, 'ok');
    };
    await sendTelegramMessage(
      {
        botToken: 'T',
        chatId: '-100',
        fetch: fetchMock,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
      'hello',
    );
    expect(sleeps).toEqual([5000]);
  });

  it('retries once on 500 with 2s backoff', async () => {
    const sleeps: number[] = [];
    let call = 0;
    const fetchMock: TelegramFetch = async () => {
      call++;
      if (call === 1) return makeResponse(503, 'nope');
      return makeResponse(200, 'ok');
    };
    await sendTelegramMessage(
      {
        botToken: 'T',
        chatId: '-100',
        fetch: fetchMock,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
      'hello',
    );
    expect(sleeps).toEqual([2000]);
  });

  it('gives up after one retry on persistent 429', async () => {
    const fetchMock: TelegramFetch = async () => makeResponse(429, 'still too many', { 'retry-after': '1' });
    await expect(
      sendTelegramMessage(
        { botToken: 'T', chatId: '-100', fetch: fetchMock, sleep: async () => {} },
        'x',
      ),
    ).rejects.toBeInstanceOf(TelegramSendError);
  });

  it('does not retry on 4xx other than 429', async () => {
    let call = 0;
    const fetchMock: TelegramFetch = async () => {
      call++;
      return makeResponse(400, 'bad request');
    };
    await expect(
      sendTelegramMessage(
        { botToken: 'T', chatId: '-100', fetch: fetchMock, sleep: async () => {} },
        'x',
      ),
    ).rejects.toBeInstanceOf(TelegramSendError);
    expect(call).toBe(1);
  });

  it('surfaces the status + body on error', async () => {
    const fetchMock: TelegramFetch = async () => makeResponse(400, 'chat not found');
    await expect(
      sendTelegramMessage(
        { botToken: 'T', chatId: '-100', fetch: fetchMock, sleep: async () => {} },
        'x',
      ),
    ).rejects.toThrow(/400.*chat not found/);
  });
});

describe('sendTelegramMessageParts', () => {
  it('sends each part in order', async () => {
    const sent: string[] = [];
    const fetchMock: TelegramFetch = async (_url, init) => {
      sent.push(JSON.parse(init.body).text as string);
      return makeResponse(200, 'ok');
    };
    await sendTelegramMessageParts(
      { botToken: 'T', chatId: '-100', fetch: fetchMock, sleep: async () => {} },
      ['part 1', 'part 2', 'part 3'],
    );
    expect(sent).toEqual(['part 1', 'part 2', 'part 3']);
  });

  it('stops at the first failure', async () => {
    const sent: string[] = [];
    const fetchMock: TelegramFetch = async (_url, init) => {
      const text = JSON.parse(init.body).text as string;
      sent.push(text);
      if (text === 'part 2') return makeResponse(400, 'no');
      return makeResponse(200, 'ok');
    };
    await expect(
      sendTelegramMessageParts(
        { botToken: 'T', chatId: '-100', fetch: fetchMock, sleep: async () => {} },
        ['part 1', 'part 2', 'part 3'],
      ),
    ).rejects.toBeInstanceOf(TelegramSendError);
    expect(sent).toEqual(['part 1', 'part 2']);
  });
});
