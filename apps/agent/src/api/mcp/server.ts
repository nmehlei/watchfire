import type { FastifyInstance } from 'fastify';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ResourceGraph } from '../../config/types.js';
import type { Db } from '../../memory/index.js';
import { verifyBearer } from '../shared/auth.js';
import { emitApiAudit, type ApiAuditLogger, type ApiOperation } from '../shared/audit.js';
import {
  ADAPTER_HEALTH_TOOL,
  handleAdapterHealth,
} from './tools/adapter-health.js';
import {
  COST_WINDOW_TOOL,
  handleCostWindow,
  type CostWindowArgs,
} from './tools/cost-window.js';
import {
  GET_FINDING_TOOL,
  handleGetFinding,
  type GetFindingArgs,
} from './tools/get-finding.js';
import {
  GET_RUN_TOOL,
  handleGetRun,
  type GetRunArgs,
} from './tools/get-run.js';
import {
  GET_RUN_FINDINGS_TOOL,
  handleGetRunFindings,
  type GetRunFindingsArgs,
} from './tools/get-run-findings.js';
import {
  LIST_MUTES_TOOL,
  handleListMutes,
} from './tools/list-mutes.js';
import {
  LIST_RUNS_TOOL,
  handleListRuns,
  type ListRunsArgs,
} from './tools/list-runs.js';
import {
  MUTE_FINDING_TOOL,
  handleMuteFinding,
  type MuteFindingArgs,
} from './tools/mute-finding.js';
import {
  RECENT_FINDINGS_TOOL,
  handleRecentFindings,
  type RecentFindingsArgs,
} from './tools/recent-findings.js';
import {
  SEARCH_FINDINGS_TOOL,
  handleSearchFindings,
  type SearchFindingsArgs,
} from './tools/search-findings.js';
import {
  UNMUTE_FINDING_TOOL,
  handleUnmuteFinding,
  type UnmuteFindingArgs,
} from './tools/unmute-finding.js';

export interface McpRouteConfig {
  db: Db;
  apiToken: string;
  graph: ResourceGraph;
  knownTenants: readonly string[];
  knownAdapters: readonly string[];
  log: ApiAuditLogger;
}

interface Outcome {
  kind: string;
  detail?: string;
  id?: string;
  candidates?: unknown;
}

/** Build the MCP tool-call response from an outcome union + payload. */
function toResult(out: Outcome, okPayload: unknown): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
} {
  if (out.kind === 'ok') {
    return { content: [{ type: 'text', text: JSON.stringify(okPayload) }] };
  }
  const body: Record<string, unknown> = { error: out.kind };
  if (out.detail !== undefined) body['detail'] = out.detail;
  if (out.id !== undefined) body['id'] = out.id;
  if (out.candidates !== undefined) body['candidates'] = out.candidates;
  return { content: [{ type: 'text', text: JSON.stringify(body) }], isError: true };
}

function buildServer(cfg: McpRouteConfig): Server {
  const server = new Server(
    { name: 'iris', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      GET_FINDING_TOOL,
      RECENT_FINDINGS_TOOL,
      LIST_RUNS_TOOL,
      GET_RUN_TOOL,
      GET_RUN_FINDINGS_TOOL,
      SEARCH_FINDINGS_TOOL,
      LIST_MUTES_TOOL,
      MUTE_FINDING_TOOL,
      UNMUTE_FINDING_TOOL,
      COST_WINDOW_TOOL,
      ADAPTER_HEALTH_TOOL,
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const start = Date.now();
    const { name, arguments: args } = req.params;
    const argsRecord = (args ?? {}) as Record<string, unknown>;

    const dbDeps = { db: cfg.db };
    const fullDeps = { db: cfg.db, graph: cfg.graph, knownTenants: cfg.knownTenants };
    const adapterDeps = { db: cfg.db, knownAdapters: cfg.knownAdapters };

    function audit(op: ApiOperation, out: Outcome, count: number): void {
      emitApiAudit(cfg.log, {
        surface: 'mcp', operation: op, args: argsRecord,
        result: out.kind === 'ok'
          ? 'ok'
          : (out.kind as 'unauthorized' | 'not_found' | 'ambiguous' | 'invalid_argument' | 'internal'),
        result_count: count,
        latency_ms: Date.now() - start,
      });
    }

    switch (name) {
      case 'get_finding': {
        const out = handleGetFinding(fullDeps, argsRecord as unknown as GetFindingArgs);
        const payload = out.kind === 'ok' ? out.dto : null;
        audit('get_finding', out, out.kind === 'ok' ? 1 : out.kind === 'ambiguous' ? out.candidates.length : 0);
        return toResult(out, payload);
      }
      case 'recent_findings': {
        const out = handleRecentFindings(fullDeps, argsRecord as unknown as RecentFindingsArgs);
        const payload = out.kind === 'ok' ? out.body : null;
        audit('recent_findings', out, out.kind === 'ok' ? out.body.findings.length : 0);
        return toResult(out, payload);
      }
      case 'list_runs': {
        const out = handleListRuns(dbDeps, argsRecord as unknown as ListRunsArgs);
        const payload = out.kind === 'ok' ? { runs: out.runs, total: out.total, limit: out.limit } : null;
        audit('list_runs', out, out.kind === 'ok' ? out.runs.length : 0);
        return toResult(out, payload);
      }
      case 'get_run': {
        const out = handleGetRun(dbDeps, argsRecord as unknown as GetRunArgs);
        const payload = out.kind === 'ok' ? out.run : null;
        audit('get_run', out, out.kind === 'ok' ? 1 : 0);
        return toResult(out, payload);
      }
      case 'get_run_findings': {
        const out = handleGetRunFindings(fullDeps, argsRecord as unknown as GetRunFindingsArgs);
        const payload = out.kind === 'ok' ? { findings: out.findings, total: out.total } : null;
        audit('get_run_findings', out, out.kind === 'ok' ? out.findings.length : 0);
        return toResult(out, payload);
      }
      case 'search_findings': {
        const out = handleSearchFindings(fullDeps, argsRecord as unknown as SearchFindingsArgs);
        const payload = out.kind === 'ok' ? { findings: out.findings, total: out.total, limit: out.limit } : null;
        audit('search_findings', out, out.kind === 'ok' ? out.findings.length : 0);
        return toResult(out, payload);
      }
      case 'list_mutes': {
        const out = handleListMutes(dbDeps);
        const payload = { mutes: out.mutes, total: out.total };
        audit('list_mutes', out, out.mutes.length);
        return toResult(out, payload);
      }
      case 'mute_finding': {
        const out = handleMuteFinding(dbDeps, argsRecord as unknown as MuteFindingArgs);
        const payload = out.kind === 'ok' ? { fingerprint: out.fingerprint, expires_at: out.expires_at } : null;
        audit('mute_finding', out, out.kind === 'ok' ? 1 : out.kind === 'ambiguous' ? out.candidates.length : 0);
        return toResult(out, payload);
      }
      case 'unmute_finding': {
        const out = handleUnmuteFinding(dbDeps, argsRecord as unknown as UnmuteFindingArgs);
        const payload = out.kind === 'ok' ? { fingerprint: out.fingerprint, deleted_count: out.deleted_count } : null;
        audit('unmute_finding', out, out.kind === 'ok' ? out.deleted_count : out.kind === 'ambiguous' ? out.candidates.length : 0);
        return toResult(out, payload);
      }
      case 'cost_window': {
        const out = handleCostWindow(dbDeps, argsRecord as unknown as CostWindowArgs);
        const payload = out.kind === 'ok' ? out.body : null;
        audit('cost_window', out, out.kind === 'ok' ? out.body.daily_buckets.length : 0);
        return toResult(out, payload);
      }
      case 'adapter_health': {
        const out = handleAdapterHealth(adapterDeps);
        const payload = { adapters: out.adapters, total: out.total };
        audit('adapter_health', out, out.adapters.length);
        return toResult(out, payload);
      }
      default:
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'not_found' }) }],
          isError: true,
        };
    }
  });

  return server;
}

export function registerMcpRoute(app: FastifyInstance, cfg: McpRouteConfig): void {
  app.post('/mcp', async (req, reply) => {
    const start = Date.now();
    if (!verifyBearer(req.headers.authorization, cfg.apiToken)) {
      emitApiAudit(cfg.log, {
        surface: 'mcp', operation: null, args: null,
        result: 'unauthorized', result_count: null, latency_ms: Date.now() - start,
      });
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const server = buildServer(cfg);
    const transport = new StreamableHTTPServerTransport({});

    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport as Parameters<typeof server.connect>[0]);
      reply.hijack();
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (err) {
      cfg.log('iris.api.error', {
        surface: 'mcp',
        error: err instanceof Error ? err.message : String(err),
      });
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.end(JSON.stringify({ error: 'internal' }));
      }
    }
  });
}

