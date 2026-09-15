import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { appendObservation } from '../../memory/observations.js';
import { insertRun } from '../../memory/runs.js';
import { openMemoryDb, type Db } from '../../memory/schema.js';
import { registerAdaptersRoutes } from './adapters.js';

const KNOWN = ['check-ssl', 'check-http', 'obs-search'] as const;

function buildApp(db: Db): FastifyInstance {
  const app = Fastify({ logger: false });
  registerAdaptersRoutes(app, { db, apiToken: 'tok', knownAdapters: KNOWN, log: () => {} });
  return app;
}

function seed(): Db {
  const db = openMemoryDb();
  const r = insertRun(db, { type: 'nightly', trigger: 'cron' });
  appendObservation(db, {
    tenant: 'acme', source: 'check-ssl', subject: 'sql.acme.internal',
    metric: 'days_until_expiry', value: 30, runId: r,
  });
  return db;
}

describe('GET /api/adapters/health', () => {
  it('returns one row per known adapter', async () => {
    const r = await buildApp(seed()).inject({
      method: 'GET', url: '/api/adapters/health',
      headers: { authorization: 'Bearer tok' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { adapters: Array<{ source: string; last_observed_at: string | null }> };
    expect(body.adapters.length).toBe(3);
    const bySource = Object.fromEntries(body.adapters.map((a) => [a.source, a]));
    expect(bySource['check-ssl']!.last_observed_at).not.toBeNull();
    expect(bySource['obs-search']!.last_observed_at).toBeNull();
  });

  it('401 without bearer', async () => {
    const r = await buildApp(seed()).inject({ method: 'GET', url: '/api/adapters/health' });
    expect(r.statusCode).toBe(401);
  });
});
