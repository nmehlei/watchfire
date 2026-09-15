import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ResourceGraph } from '../../config/types.js';
import { fingerprint } from '../../memory/fingerprint.js';
import { openMemoryDb, type Db } from '../../memory/schema.js';
import { registerMcpRoute } from './server.js';

const GRAPH: ResourceGraph = {
  resources: [{ id: 'r1', type: 'mssql-server', owner: 'acme', affects: ['acme'] }],
};

function buildApp(db: Db, token = 'tok'): FastifyInstance {
  const app = Fastify({ logger: false });
  registerMcpRoute(app, {
    db,
    apiToken: token,
    graph: GRAPH,
    knownTenants: ['acme'],
    knownAdapters: ['check-ssl', 'check-http'],
    log: () => {},
  });
  return app;
}

function seed(): Db {
  const db = openMemoryDb();
  db.prepare(
    `INSERT INTO findings
       (fingerprint, resource_id, issue_class, state, severity, title, evidence, likely_cause,
        first_seen_at, last_seen_at, run_count, first_run_id, last_run_id)
     VALUES (?, 'r1', 'disk-pressure', 'new', 'warn', 'Disk warn', 'ev', NULL,
             datetime('now'), datetime('now'), 1, 0, 0)`,
  ).run(fingerprint('r1', 'disk-pressure'));
  return db;
}

function initPayload(id: number) {
  return {
    jsonrpc: '2.0' as const,
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '0.0.0' },
    },
  };
}

describe('POST /mcp', () => {
  it('401 without bearer', async () => {
    const r = await buildApp(seed()).inject({
      method: 'POST',
      url: '/mcp',
      payload: initPayload(0),
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('responds to initialize when authenticated', async () => {
    const r = await buildApp(seed()).inject({
      method: 'POST',
      url: '/mcp',
      payload: initPayload(1),
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer tok',
      },
    });
    expect(r.statusCode).toBe(200);
    // Response can be JSON or SSE; the SDK's stateless mode tends to respond JSON.
    // Either way, the body should parse and contain a result with serverInfo.
    const body = r.body;
    expect(body).toContain('"serverInfo"');
    expect(body).toContain('watchfire');
  });

  it('lists both tools via tools/list', async () => {
    const r = await buildApp(seed()).inject({
      method: 'POST',
      url: '/mcp',
      payload: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer tok',
      },
    });
    expect(r.statusCode).toBe(200);
    for (const name of [
      'get_finding',
      'recent_findings',
      'list_runs',
      'get_run',
      'get_run_findings',
      'search_findings',
      'list_mutes',
      'mute_finding',
      'unmute_finding',
      'cost_window',
      'adapter_health',
    ]) {
      expect(r.body).toContain(name);
    }
  });
});
