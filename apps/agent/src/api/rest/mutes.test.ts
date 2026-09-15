import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ResourceGraph } from '../../config/types.js';
import { fingerprint } from '../../memory/fingerprint.js';
import { isMuted } from '../../memory/mutes.js';
import { openMemoryDb, type Db } from '../../memory/schema.js';
import { EventBus, _setEventBusForTests } from '../events/bus.js';
import { registerMutesRoutes } from './mutes.js';

const GRAPH: ResourceGraph = {
  resources: [{ id: 'r1', type: 'mssql-server', owner: 'acme', affects: ['acme'] }],
};

function buildApp(db: Db): FastifyInstance {
  const app = Fastify({ logger: false });
  registerMutesRoutes(app, {
    db, apiToken: 'tok', graph: GRAPH, knownTenants: ['acme'], log: () => {},
  });
  return app;
}

function seed(): Db {
  const db = openMemoryDb();
  db.prepare(
    `INSERT INTO findings
       (fingerprint, resource_id, issue_class, state, severity, title, evidence, likely_cause,
        first_seen_at, last_seen_at, run_count, first_run_id, last_run_id)
     VALUES (?, 'r1', 'disk-pressure', 'new', 'warn', 'Disk', 'ev', NULL,
             datetime('now'), datetime('now'), 1, 0, 0)`,
  ).run(fingerprint('r1', 'disk-pressure'));
  return db;
}

describe('POST /api/mutes', () => {
  it('201 inserts mute and emits mute.created', async () => {
    const fp = fingerprint('r1', 'disk-pressure');
    const db = seed();
    const bus = new EventBus();
    _setEventBusForTests(bus);
    const events: Array<{ fingerprint: string }> = [];
    bus.on('mute.created', (p) => events.push(p));

    const r = await buildApp(db).inject({
      method: 'POST', url: '/api/mutes',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      payload: { id: fp.slice(0, 6), duration: '7d', reason: 'flapping' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { fingerprint: string; expires_at: string | null };
    expect(body.fingerprint).toBe(fp);
    expect(body.expires_at).not.toBeNull();
    expect(isMuted(db, fp)).toBe(true);
    expect(events).toEqual([{ fingerprint: fp }]);
    _setEventBusForTests(null);
  });

  it('400 missing id', async () => {
    const r = await buildApp(seed()).inject({
      method: 'POST', url: '/api/mutes',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      payload: {},
    });
    expect(r.statusCode).toBe(400);
  });

  it('400 unknown duration', async () => {
    const fp = fingerprint('r1', 'disk-pressure');
    const r = await buildApp(seed()).inject({
      method: 'POST', url: '/api/mutes',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      payload: { id: fp.slice(0, 6), duration: '2h' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('404 unknown id', async () => {
    const r = await buildApp(seed()).inject({
      method: 'POST', url: '/api/mutes',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      payload: { id: 'cafefe' },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('DELETE /api/mutes/:id', () => {
  it('200 deletes and emits mute.deleted', async () => {
    const fp = fingerprint('r1', 'disk-pressure');
    const db = seed();
    db.prepare(
      `INSERT INTO mutes (fingerprint, reason, created_at, expires_at, source)
       VALUES (?, NULL, datetime('now'), NULL, 'manual')`,
    ).run(fp);
    const bus = new EventBus();
    _setEventBusForTests(bus);
    const events: Array<{ fingerprint: string }> = [];
    bus.on('mute.deleted', (p) => events.push(p));

    const r = await buildApp(db).inject({
      method: 'DELETE', url: `/api/mutes/${fp.slice(0, 6)}`,
      headers: { authorization: 'Bearer tok' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { fingerprint: string; deleted_count: number };
    expect(body.deleted_count).toBe(1);
    expect(isMuted(db, fp)).toBe(false);
    expect(events).toEqual([{ fingerprint: fp }]);
    _setEventBusForTests(null);
  });
});

describe('GET /api/mutes', () => {
  it('lists active mutes', async () => {
    const db = seed();
    const fp = fingerprint('r1', 'disk-pressure');
    db.prepare(
      `INSERT INTO mutes (fingerprint, reason, created_at, expires_at, source)
       VALUES (?, 'because', datetime('now'), NULL, 'manual')`,
    ).run(fp);
    const r = await buildApp(db).inject({
      method: 'GET', url: '/api/mutes',
      headers: { authorization: 'Bearer tok' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { mutes: Array<{ fingerprint: string }> };
    expect(body.mutes.length).toBe(1);
    expect(body.mutes[0]!.fingerprint).toBe(fp);
  });

  it('401 without bearer', async () => {
    const r = await buildApp(seed()).inject({ method: 'GET', url: '/api/mutes' });
    expect(r.statusCode).toBe(401);
  });
});
