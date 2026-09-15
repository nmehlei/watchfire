import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ResourceGraph } from '../../config/types.js';
import { upsertFinding } from '../../memory/findings.js';
import { completeRun, insertRun } from '../../memory/runs.js';
import { openMemoryDb, type Db } from '../../memory/schema.js';
import { registerRunsRoutes } from './runs.js';

const GRAPH: ResourceGraph = {
  resources: [{ id: 'r1', type: 'mssql-server', owner: 'acme', affects: ['acme'] }],
};

function buildApp(db: Db): FastifyInstance {
  const app = Fastify({ logger: false });
  registerRunsRoutes(app, {
    db, apiToken: 'tok', graph: GRAPH, knownTenants: ['acme'], log: () => {},
  });
  return app;
}

function seed(): Db {
  const db = openMemoryDb();
  const r1 = insertRun(db, { type: 'nightly', trigger: 'cron' });
  completeRun(db, r1, {
    status: 'success', findingCount: 1, turnCount: 12,
    tokensIn: 5000, tokensOut: 1000, tokensCached: 0, costEur: 0.10,
  });
  upsertFinding(db, r1, {
    resource_id: 'r1', issue_class: 'disk-pressure', severity: 'warn',
    title: 'Disk', evidence: 'ev',
  });
  insertRun(db, { type: 'watch', trigger: 'webhook' });
  return db;
}

describe('GET /api/runs', () => {
  it('lists recent', async () => {
    const r = await buildApp(seed()).inject({
      method: 'GET', url: '/api/runs?limit=10',
      headers: { authorization: 'Bearer tok' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { runs: Array<{ id: number; type: string }>; limit: number };
    expect(body.runs.length).toBe(2);
    expect(body.limit).toBe(10);
  });

  it('filters by type', async () => {
    const r = await buildApp(seed()).inject({
      method: 'GET', url: '/api/runs?type=nightly',
      headers: { authorization: 'Bearer tok' },
    });
    const body = r.json() as { runs: Array<{ type: string }> };
    expect(body.runs.every((x) => x.type === 'nightly')).toBe(true);
  });

  it('400 on invalid type', async () => {
    const r = await buildApp(seed()).inject({
      method: 'GET', url: '/api/runs?type=bogus',
      headers: { authorization: 'Bearer tok' },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('GET /api/runs/:id', () => {
  it('200 returns full run', async () => {
    const r = await buildApp(seed()).inject({
      method: 'GET', url: '/api/runs/1',
      headers: { authorization: 'Bearer tok' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { id: number; type: string; status: string };
    expect(body.id).toBe(1);
    expect(body.status).toBe('success');
  });

  it('404 unknown', async () => {
    const r = await buildApp(seed()).inject({
      method: 'GET', url: '/api/runs/99',
      headers: { authorization: 'Bearer tok' },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('GET /api/runs/:id/findings', () => {
  it('returns findings touched', async () => {
    const r = await buildApp(seed()).inject({
      method: 'GET', url: '/api/runs/1/findings',
      headers: { authorization: 'Bearer tok' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { findings: Array<{ resource_id: string }>; total: number };
    expect(body.findings.length).toBe(1);
    expect(body.findings[0]!.resource_id).toBe('r1');
  });
});
