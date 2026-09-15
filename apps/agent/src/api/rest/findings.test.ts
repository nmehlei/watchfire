import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ResourceGraph } from '../../config/types.js';
import { fingerprint } from '../../memory/fingerprint.js';
import { openMemoryDb, type Db } from '../../memory/schema.js';
import { registerFindingsRoutes } from './findings.js';

const GRAPH: ResourceGraph = {
  resources: [{ id: 'r1', type: 'mssql-server', owner: 'acme', affects: ['acme'] }],
};

function buildApp(db: Db, token = 'tok'): FastifyInstance {
  const app = Fastify({ logger: false });
  registerFindingsRoutes(app, {
    db,
    apiToken: token,
    graph: GRAPH,
    knownTenants: ['acme'],
    log: () => {},
  });
  return app;
}

function seed(): Db {
  const db = openMemoryDb();
  const fp = fingerprint('r1', 'disk-pressure');
  db.prepare(
    `INSERT INTO findings
       (fingerprint, resource_id, issue_class, state, severity, title, evidence, likely_cause,
        first_seen_at, last_seen_at, run_count, first_run_id, last_run_id)
     VALUES (?, 'r1', 'disk-pressure', 'new', 'critical', 'Disk at 95%', 'ev', NULL,
             '2026-05-01 09:00:00', '2026-05-04 09:00:00', 3, 1, 5)`,
  ).run(fp);
  return db;
}

describe('GET /api/findings/:id', () => {
  it('401 on missing bearer', async () => {
    const r = await buildApp(seed()).inject({ method: 'GET', url: '/api/findings/aaaaaa' });
    expect(r.statusCode).toBe(401);
  });

  it('400 on too-short id', async () => {
    const r = await buildApp(seed()).inject({
      method: 'GET',
      url: '/api/findings/abcd',
      headers: { authorization: 'Bearer tok' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ error: 'invalid_argument' });
  });

  it('404 on no match', async () => {
    const r = await buildApp(seed()).inject({
      method: 'GET',
      url: '/api/findings/cafefe',
      headers: { authorization: 'Bearer tok' },
    });
    expect(r.statusCode).toBe(404);
  });

  it('200 on unique match with full DTO', async () => {
    const fp = fingerprint('r1', 'disk-pressure');
    const r = await buildApp(seed()).inject({
      method: 'GET',
      url: `/api/findings/${fp.slice(0, 6)}`,
      headers: { authorization: 'Bearer tok' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    expect(body['short_id']).toBe(fp.slice(0, 6));
    expect(body['title']).toBe('Disk at 95%');
    expect(body['affects']).toEqual(['acme']);
  });
});

describe('GET /api/findings', () => {
  it('200 with active rows', async () => {
    const r = await buildApp(seed()).inject({
      method: 'GET',
      url: '/api/findings?limit=10',
      headers: { authorization: 'Bearer tok' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    expect(body['total']).toBe(1);
    expect(body['limit']).toBe(10);
  });

  it('400 on out-of-range limit', async () => {
    const r = await buildApp(seed()).inject({
      method: 'GET',
      url: '/api/findings?limit=200',
      headers: { authorization: 'Bearer tok' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('uses default limit 20 when not specified', async () => {
    const r = await buildApp(seed()).inject({
      method: 'GET',
      url: '/api/findings',
      headers: { authorization: 'Bearer tok' },
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as Record<string, unknown>)['limit']).toBe(20);
  });
});

describe('GET /api/findings/search', () => {
  it('400 missing q', async () => {
    const r = await buildApp(seed()).inject({
      method: 'GET',
      url: '/api/findings/search',
      headers: { authorization: 'Bearer tok' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('200 returns matches', async () => {
    const r = await buildApp(seed()).inject({
      method: 'GET',
      url: '/api/findings/search?q=disk&limit=10',
      headers: { authorization: 'Bearer tok' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { findings: Array<{ short_id: string }>; total: number; limit: number };
    expect(body.findings.length).toBe(1);
    expect(body.limit).toBe(10);
    expect(body.total).toBe(1);
  });

  it('401 without bearer', async () => {
    const r = await buildApp(seed()).inject({ method: 'GET', url: '/api/findings/search?q=x' });
    expect(r.statusCode).toBe(401);
  });
});
