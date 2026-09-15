// End-to-end: REST and MCP serve the same finding from the same process.

import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { ResourceGraph } from '../config/types.js';
import { fingerprint } from '../memory/fingerprint.js';
import { openMemoryDb, type Db } from '../memory/schema.js';
import { registerMcpRoute } from './mcp/server.js';
import { registerFindingsRoutes } from './rest/findings.js';

const GRAPH: ResourceGraph = {
  resources: [{ id: 'r1', type: 'mssql-server', owner: 'acme', affects: ['acme'] }],
};

function seed(): Db {
  const db = openMemoryDb();
  db.prepare(
    `INSERT INTO findings
       (fingerprint, resource_id, issue_class, state, severity, title, evidence, likely_cause,
        first_seen_at, last_seen_at, run_count, first_run_id, last_run_id)
     VALUES (?, 'r1', 'disk-pressure', 'new', 'warn', 'Disk warning', 'ev', NULL,
             datetime('now'), datetime('now'), 1, 0, 0)`,
  ).run(fingerprint('r1', 'disk-pressure'));
  return db;
}

describe('e2e: REST + MCP serve the same finding', () => {
  it('REST get + MCP get_finding return matching short_id and title', async () => {
    const db = seed();
    const app = Fastify({ logger: false });
    const cfg = { db, apiToken: 'tok', graph: GRAPH, knownTenants: ['acme'], log: () => {} };
    registerFindingsRoutes(app, cfg);
    registerMcpRoute(app, cfg);

    const fp = fingerprint('r1', 'disk-pressure');

    const restRes = await app.inject({
      method: 'GET',
      url: `/api/findings/${fp.slice(0, 6)}`,
      headers: { authorization: 'Bearer tok' },
    });
    expect(restRes.statusCode).toBe(200);
    const restBody = restRes.json() as { short_id: string; title: string };

    const mcpRes = await app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_finding', arguments: { id: fp.slice(0, 6) } },
      },
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer tok',
      },
    });
    expect(mcpRes.statusCode).toBe(200);

    // The Streamable HTTP transport responds with either JSON or an SSE-framed
    // message envelope ("event: message\ndata: {...}\n\n"). Extract the JSON
    // payload either way and parse the tool result.
    const raw = mcpRes.body;
    const jsonText = raw.startsWith('event:')
      ? raw.split('\n').find((l) => l.startsWith('data:'))!.slice('data:'.length).trim()
      : raw;
    const env = JSON.parse(jsonText) as {
      result?: { content: Array<{ text: string }>; isError?: boolean };
    };
    expect(env.result?.isError).toBeFalsy();
    const mcpDto = JSON.parse(env.result!.content[0]!.text) as {
      short_id: string;
      title: string;
    };

    expect(restBody.short_id).toBe(mcpDto.short_id);
    expect(restBody.title).toBe(mcpDto.title);
  });
});
