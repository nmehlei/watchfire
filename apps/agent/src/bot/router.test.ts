import { beforeEach, describe, expect, it } from 'vitest';
import { upsertFinding } from '../memory/findings.js';
import { isMuted, listActiveMutes } from '../memory/mutes.js';
import { insertRun } from '../memory/runs.js';
import { openMemoryDb, type Db } from '../memory/schema.js';
import { dispatch } from './router.js';

function seed(db: Db): { runId: number; fingerprint: string; shortId: string } {
  const runId = insertRun(db, { type: 'nightly', trigger: 'cron' });
  const f = upsertFinding(db, runId, {
    resource_id: 'sql.acme',
    issue_class: 'disk-pressure',
    severity: 'warn',
    title: 'Disk at 94%',
    evidence: 'e',
  });
  return { runId, fingerprint: f.fingerprint, shortId: f.fingerprint.slice(0, 6) };
}

describe('dispatch', () => {
  let db: Db;
  beforeEach(() => {
    db = openMemoryDb();
  });

  it('ignores plain text (not-a-command)', () => {
    expect(dispatch({ db, text: 'hello' })).toEqual({
      reply: '',
      command: 'none',
      outcome: 'ignored',
    });
  });

  it('/help returns the help text', () => {
    const r = dispatch({ db, text: '/help' });
    expect(r.command).toBe('/help');
    expect(r.reply).toContain('Watchfire bot commands');
  });

  it('unknown command returns help with prefix', () => {
    const r = dispatch({ db, text: '/wat' });
    expect(r.outcome).toBe('unknown');
    expect(r.reply).toContain('Unknown command');
    expect(r.reply).toContain('Watchfire bot commands');
  });

  it('/mute round trip', () => {
    const { fingerprint, shortId } = seed(db);
    const muted = dispatch({ db, text: `/mute ${shortId}` });
    expect(muted.outcome).toBe('ok');
    expect(muted.reply).toContain('Muted');
    expect(isMuted(db, fingerprint)).toBe(true);

    const list = dispatch({ db, text: '/mutes' });
    expect(list.reply).toContain(shortId);
    expect(list.reply).toContain('Disk at 94%');

    const unmute = dispatch({ db, text: `/unmute ${shortId}` });
    expect(unmute.reply).toContain('Unmuted');
    expect(isMuted(db, fingerprint)).toBe(false);
    expect(listActiveMutes(db)).toHaveLength(0);
  });

  it('/mute with bad id returns error and writes nothing', () => {
    const r = dispatch({ db, text: '/mute deadbe' });
    expect(r.outcome).toBe('ok'); // command itself dispatched cleanly; reply contains ❌
    expect(r.reply).toContain('No finding matches');
    expect(listActiveMutes(db)).toHaveLength(0);
  });

  it('/mute with bad duration is a usage error', () => {
    const r = dispatch({ db, text: '/mute 9b9896 5d' });
    expect(r.outcome).toBe('usage-error');
    expect(r.reply).toContain('Duration must be');
  });

  it('/mute with reason persists and surfaces in /mutes', () => {
    const { shortId } = seed(db);
    dispatch({ db, text: `/mute ${shortId} forever -- public IP brute force` });
    const list = dispatch({ db, text: '/mutes' });
    expect(list.reply).toContain('public IP brute force');
    expect(list.reply).toContain('indefinite');
  });

  it('/mutes empty', () => {
    expect(dispatch({ db, text: '/mutes' }).reply).toContain('No active mutes');
  });
});
