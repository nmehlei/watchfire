import { describe, expect, it } from 'vitest';
import { fingerprint } from '../../../memory/fingerprint.js';
import { isMuted } from '../../../memory/mutes.js';
import { openMemoryDb } from '../../../memory/schema.js';
import { EventBus, _setEventBusForTests } from '../../events/bus.js';
import { handleMuteFinding } from './mute-finding.js';

function seed() {
  const db = openMemoryDb();
  const fp = fingerprint('r1', 'disk-pressure');
  db.prepare(
    `INSERT INTO findings
       (fingerprint, resource_id, issue_class, state, severity, title, evidence, likely_cause,
        first_seen_at, last_seen_at, run_count, first_run_id, last_run_id)
     VALUES (?, 'r1', 'disk-pressure', 'new', 'warn', 't', 'e', NULL,
             datetime('now'), datetime('now'), 1, 0, 0)`,
  ).run(fp);
  return { db, fp };
}

describe('handleMuteFinding', () => {
  it('inserts mute and emits mute.created', () => {
    const { db, fp } = seed();
    const bus = new EventBus();
    _setEventBusForTests(bus);
    const events: Array<{ fingerprint: string }> = [];
    bus.on('mute.created', (p) => events.push(p));

    const out = handleMuteFinding({ db }, { id: fp.slice(0, 6) });
    expect(out.kind).toBe('ok');
    expect(isMuted(db, fp)).toBe(true);
    expect(events).toEqual([{ fingerprint: fp }]);
    _setEventBusForTests(null);
  });

  it('does not emit on invalid_argument', () => {
    const { db } = seed();
    const bus = new EventBus();
    _setEventBusForTests(bus);
    const events: unknown[] = [];
    bus.on('mute.created', (p) => events.push(p));

    const out = handleMuteFinding({ db }, { id: 'abc' });
    expect(out.kind).toBe('invalid_argument');
    expect(events).toHaveLength(0);
    _setEventBusForTests(null);
  });
});
