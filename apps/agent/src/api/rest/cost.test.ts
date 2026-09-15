import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { completeRun, insertRun } from '../../memory/runs.js';
import { openMemoryDb, type Db } from '../../memory/schema.js';
import { registerCostRoutes } from './cost.js';

function buildApp(db: Db): FastifyInstance {
  const app = Fastify({ logger: false });
  registerCostRoutes(app, { db, apiToken: 'tok', log: () => {} });
  return app;
}

function seed(): Db {
  const db = openMemoryDb();
  const r = insertRun(db, { type: 'nightly', trigger: 'cron' });
  completeRun(db, r, {
    status: 'success', findingCount: 0, turnCount: 10,
    tokensIn: 1000, tokensOut: 500, tokensCached: 0, costEur: 0.1,
  });
  return db;
}

describe('GET /api/cost-window', () => {
  it('returns total + by_type + daily_buckets', async () => {
    const r = await buildApp(seed()).inject({
      method: 'GET', url: '/api/cost-window?days=30',
      headers: { authorization: 'Bearer tok' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { total_eur: number; by_type: { nightly: number } };
    expect(body.total_eur).toBeCloseTo(0.1, 6);
    expect(body.by_type.nightly).toBeCloseTo(0.1, 6);
  });

  it('400 days out of range', async () => {
    const r = await buildApp(seed()).inject({
      method: 'GET', url: '/api/cost-window?days=999',
      headers: { authorization: 'Bearer tok' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('401 no bearer', async () => {
    const r = await buildApp(seed()).inject({ method: 'GET', url: '/api/cost-window' });
    expect(r.statusCode).toBe(401);
  });
});
