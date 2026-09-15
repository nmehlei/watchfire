import { beforeEach, describe, expect, it } from 'vitest';
import { upsertFinding } from '../../memory/findings.js';
import { isMuted } from '../../memory/mutes.js';
import { insertRun } from '../../memory/runs.js';
import { openMemoryDb, type Db } from '../../memory/schema.js';
import { createTelegramHandler } from './telegram.js';

const ALLOWED_CHAT = 12345;

interface Setup {
  db: Db;
  fingerprint: string;
  shortId: string;
  sent: string[];
  handle: ReturnType<typeof createTelegramHandler>;
}

function setup(overrides: { secret?: string; allowed?: number[] } = {}): Setup {
  const db = openMemoryDb();
  const runId = insertRun(db, { type: 'nightly', trigger: 'cron' });
  const f = upsertFinding(db, runId, {
    resource_id: 'sql.acme',
    issue_class: 'disk-pressure',
    severity: 'warn',
    title: 'Disk at 94%',
    evidence: 'e',
  });
  const sent: string[] = [];
  const handle = createTelegramHandler({
    db,
    auth: {
      secretToken: overrides.secret ?? 'sekret',
      allowedChatIds: new Set(overrides.allowed ?? [ALLOWED_CHAT]),
    },
    sendReply: async (text) => {
      sent.push(text);
    },
  });
  return { db, fingerprint: f.fingerprint, shortId: f.fingerprint.slice(0, 6), sent, handle };
}

function makeUpdate(text: string, opts: { updateId?: number; chatId?: number } = {}): unknown {
  return {
    update_id: opts.updateId ?? 1,
    message: {
      message_id: 100,
      chat: { id: opts.chatId ?? ALLOWED_CHAT },
      from: { id: opts.chatId ?? ALLOWED_CHAT },
      text,
    },
  };
}

describe('telegram handler', () => {
  let s: Setup;
  beforeEach(() => {
    s = setup();
  });

  it('unauthenticated when secret missing', async () => {
    const r = await s.handle({ body: makeUpdate('/help'), secretHeader: undefined });
    expect(r).toEqual({ kind: 'unauthenticated' });
    expect(s.sent).toEqual([]);
  });

  it('unauthenticated when secret mismatches', async () => {
    const r = await s.handle({ body: makeUpdate('/help'), secretHeader: 'wrong' });
    expect(r).toEqual({ kind: 'unauthenticated' });
  });

  it('silent-ignore when chat not in allowlist', async () => {
    const r = await s.handle({
      body: makeUpdate('/help', { chatId: 99 }),
      secretHeader: 'sekret',
    });
    expect(r).toEqual({ kind: 'silent-ignore' });
    expect(s.sent).toEqual([]);
  });

  it('dispatches /help and sends reply', async () => {
    const r = await s.handle({ body: makeUpdate('/help'), secretHeader: 'sekret' });
    expect(r.kind).toBe('dispatched');
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toContain('Watchfire bot commands');
  });

  it('writes mute on /mute and confirms', async () => {
    const r = await s.handle({
      body: makeUpdate(`/mute ${s.shortId}`),
      secretHeader: 'sekret',
    });
    expect(r.kind).toBe('dispatched');
    expect(isMuted(s.db, s.fingerprint)).toBe(true);
    expect(s.sent[0]).toContain('Muted');
  });

  it('deduplicates by update_id', async () => {
    await s.handle({
      body: makeUpdate(`/mute ${s.shortId}`, { updateId: 42 }),
      secretHeader: 'sekret',
    });
    const r2 = await s.handle({
      body: makeUpdate(`/mute ${s.shortId}`, { updateId: 42 }),
      secretHeader: 'sekret',
    });
    expect(r2).toEqual({ kind: 'duplicate' });
    // No second send.
    expect(s.sent).toHaveLength(1);
  });

  it('silent-ignore for non-text updates', async () => {
    const r = await s.handle({
      body: { update_id: 1, message: { message_id: 1, chat: { id: ALLOWED_CHAT } } },
      secretHeader: 'sekret',
    });
    expect(r).toEqual({ kind: 'silent-ignore' });
  });

  it('silent-ignore for non-command text (still dispatched-ignored kind)', async () => {
    const r = await s.handle({ body: makeUpdate('hi there'), secretHeader: 'sekret' });
    if (r.kind === 'dispatched') expect(r.outcome).toBe('ignored');
    expect(s.sent).toEqual([]);
  });

  it('silent-ignore for malformed body', async () => {
    expect(
      await s.handle({ body: { not_a_telegram_update: true }, secretHeader: 'sekret' }),
    ).toEqual({ kind: 'silent-ignore' });
  });
});
