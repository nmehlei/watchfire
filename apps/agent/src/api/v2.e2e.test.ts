// Spec 11 v2 e2e — REST + MCP parity for list_runs, plus mute write flow.

import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { ResourceGraph } from '../config/types.js';
import { fingerprint } from '../memory/fingerprint.js';
import { upsertFinding } from '../memory/findings.js';
import { completeRun, insertRun } from '../memory/runs.js';
import { openMemoryDb, type Db } from '../memory/schema.js';
import { EventBus, _setEventBusForTests } from './events/bus.js';
import { registerEventsRoute } from './events/server.js';
import { registerMcpRoute } from './mcp/server.js';
import { registerAdaptersRoutes } from './rest/adapters.js';
import { registerCostRoutes } from './rest/cost.js';
import { registerFindingsRoutes } from './rest/findings.js';
import { registerMutesRoutes } from './rest/mutes.js';
import { registerRunsRoutes } from './rest/runs.js';

const GRAPH: ResourceGraph = {
  resources: [{ id: 'r1', type: 'mssql-server', owner: 'acme', affects: ['acme'] }],
};

function buildApp(db: Db) {
  const app = Fastify({ logger: false });
  const cfg = {
    db, apiToken: 'tok', graph: GRAPH,
    knownTenants: ['acme'],
    knownAdapters: ['check-ssl'],
    log: () => {},
  };
  registerFindingsRoutes(app, cfg);
  registerRunsRoutes(app, cfg);
  registerMutesRoutes(app, cfg);
  registerCostRoutes(app, { db, apiToken: 'tok', log: () => {} });
  registerAdaptersRoutes(app, {
    db, apiToken: 'tok', knownAdapters: ['check-ssl'], log: () => {},
  });
  registerEventsRoute(app, { apiToken: 'tok', log: () => {} });
  registerMcpRoute(app, cfg);
  return app;
}

function seed(): Db {
  const db = openMemoryDb();
  const r = insertRun(db, { type: 'nightly', trigger: 'cron' });
  completeRun(db, r, {
    status: 'success', findingCount: 1, turnCount: 10,
    tokensIn: 1000, tokensOut: 500, tokensCached: 0, costEur: 0.1,
  });
  upsertFinding(db, r, {
    resource_id: 'r1', issue_class: 'disk-pressure', severity: 'warn',
    title: 'Disk', evidence: 'ev',
  });
  return db;
}

function decodeMcpBody(raw: string): { content: Array<{ text: string }>; isError?: boolean } {
  const jsonText = raw.startsWith('event:')
    ? raw.split('\n').find((l) => l.startsWith('data:'))!.slice('data:'.length).trim()
    : raw;
  const env = JSON.parse(jsonText) as { result: { content: Array<{ text: string }>; isError?: boolean } };
  return env.result;
}

describe('v2 e2e', () => {
  it('REST + MCP both list runs', async () => {
    const db = seed();
    const app = buildApp(db);
    const restRes = await app.inject({
      method: 'GET', url: '/api/runs?limit=10',
      headers: { authorization: 'Bearer tok' },
    });
    expect(restRes.statusCode).toBe(200);
    const restBody = restRes.json() as { runs: Array<{ id: number }> };

    const mcpRes = await app.inject({
      method: 'POST', url: '/mcp',
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'list_runs', arguments: { limit: 10 } } },
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer tok',
      },
    });
    expect(mcpRes.statusCode).toBe(200);
    const result = decodeMcpBody(mcpRes.body);
    expect(result.isError).toBeFalsy();
    const mcpBody = JSON.parse(result.content[0]!.text) as { runs: Array<{ id: number }> };
    expect(mcpBody.runs.map((r) => r.id)).toEqual(restBody.runs.map((r) => r.id));
  });

  it('mute via REST emits mute.created event consumable by SSE listener', async () => {
    const fp = fingerprint('r1', 'disk-pressure');
    const db = seed();
    const bus = new EventBus();
    _setEventBusForTests(bus);

    const events: Array<{ fingerprint: string }> = [];
    bus.on('mute.created', (p) => events.push(p));

    const app = buildApp(db);
    const r = await app.inject({
      method: 'POST', url: '/api/mutes',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      payload: { id: fp.slice(0, 6), duration: '1d' },
    });
    expect(r.statusCode).toBe(201);
    expect(events).toEqual([{ fingerprint: fp }]);
    _setEventBusForTests(null);
  });

  it('cost-window via MCP returns same shape as REST', async () => {
    const db = seed();
    const app = buildApp(db);
    const restRes = await app.inject({
      method: 'GET', url: '/api/cost-window?days=30',
      headers: { authorization: 'Bearer tok' },
    });
    const restBody = restRes.json() as { total_eur: number };

    const mcpRes = await app.inject({
      method: 'POST', url: '/mcp',
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'cost_window', arguments: { days: 30 } } },
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer tok',
      },
    });
    const result = decodeMcpBody(mcpRes.body);
    const mcpBody = JSON.parse(result.content[0]!.text) as { total_eur: number };
    expect(mcpBody.total_eur).toBeCloseTo(restBody.total_eur, 6);
  });
});
