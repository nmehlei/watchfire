import { describe, expect, it } from 'vitest';
import { fingerprint } from '../../../memory/fingerprint.js';
import { isMuted } from '../../../memory/mutes.js';
import { openMemoryDb } from '../../../memory/schema.js';
import { EventBus, _setEventBusForTests } from '../../events/bus.js';
import { handleUnmuteFinding } from './unmute-finding.js';

function seedWithMute() {
  const db = openMemoryDb();
  const fp = fingerprint('r1', 'disk-pressure');
  db.prepare(
    `INSERT INTO findings
       (fingerprint, resource_id, issue_class, state, severity, title, evidence, likely_cause,
        first_seen_at, last_seen_at, run_count, first_run_id, last_run_id)
     VALUES (?, 'r1', 'disk-pressure', 'new', 'warn', 't', 'e', NULL,
             datetime('now'), datetime('now'), 1, 0, 0)`,
  ).run(fp);
  db.prepare(
    `INSERT INTO mutes (fingerprint, reason, created_at, expires_at, source)
     VALUES (?, NULL, datetime('now'), NULL, 'manual')`,
  ).run(fp);
  return { db, fp };
}

describe('handleUnmuteFinding', () => {
  it('deletes mute and emits mute.deleted', () => {
    const { db, fp } = seedWithMute();
    const bus = new EventBus();
    _setEventBusForTests(bus);
    const events: Array<{ fingerprint: string }> = [];
    bus.on('mute.deleted', (p) => events.push(p));

    const out = handleUnmuteFinding({ db }, { id: fp.slice(0, 6) });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.deleted_count).toBe(1);
    expect(isMuted(db, fp)).toBe(false);
    expect(events).toEqual([{ fingerprint: fp }]);
    _setEventBusForTests(null);
  });

  it('no emit when zero deleted', () => {
    const { db, fp } = seedWithMute();
    db.prepare('DELETE FROM mutes WHERE fingerprint = ?').run(fp);
    const bus = new EventBus();
    _setEventBusForTests(bus);
    const events: unknown[] = [];
    bus.on('mute.deleted', (p) => events.push(p));

    const out = handleUnmuteFinding({ db }, { id: fp.slice(0, 6) });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.deleted_count).toBe(0);
    expect(events).toHaveLength(0);
    _setEventBusForTests(null);
  });
});
