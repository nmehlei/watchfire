import type { FastifyInstance } from 'fastify';
import type { ResourceGraph } from '../../config/types.js';
import {
  getRun,
  getRunFindings,
  getRunsRecent,
  isMuted,
  type Db,
} from '../../memory/index.js';
import { verifyBearer } from '../shared/auth.js';
import { emitApiAudit, type ApiAuditLogger } from '../shared/audit.js';
import { httpStatusFor } from '../shared/errors.js';
import { findingToSummaryDto } from '../shared/format.js';
import type { ApiErrorBody } from '../shared/types.js';

export interface RunsRoutesConfig {
  db: Db;
  apiToken: string;
  graph: ResourceGraph;
  knownTenants: readonly string[];
  log: ApiAuditLogger;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const VALID_TYPES = new Set(['nightly', 'watch', 'manual']);

export function registerRunsRoutes(app: FastifyInstance, cfg: RunsRoutesConfig): void {
  app.get<{ Querystring: { type?: string; limit?: string } }>('/api/runs', async (req, reply) => {
    const start = Date.now();
    if (!verifyBearer(req.headers.authorization, cfg.apiToken)) {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: null, args: null,
        result: 'unauthorized', result_count: null, latency_ms: Date.now() - start,
      });
      return reply.code(401).send({ error: 'unauthorized' } satisfies ApiErrorBody);
    }
    const type = req.query.type;
    if (type !== undefined && !VALID_TYPES.has(type)) {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: 'list_runs', args: { type },
        result: 'invalid_argument', result_count: 0, latency_ms: Date.now() - start,
      });
      return reply.code(httpStatusFor('invalid_argument')).send({
        error: 'invalid_argument', detail: `type must be one of nightly|watch|manual`,
      } satisfies ApiErrorBody);
    }
    const limitRaw = req.query.limit;
    const limit = limitRaw === undefined ? DEFAULT_LIMIT : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: 'list_runs', args: { type, limit: limitRaw ?? null },
        result: 'invalid_argument', result_count: 0, latency_ms: Date.now() - start,
      });
      return reply.code(httpStatusFor('invalid_argument')).send({
        error: 'invalid_argument', detail: `limit must be integer in [1, ${MAX_LIMIT}]`,
      } satisfies ApiErrorBody);
    }
    const runs = getRunsRecent(cfg.db, {
      ...(type ? { type: type as 'nightly' | 'watch' | 'manual' } : {}),
      limit,
    });
    emitApiAudit(cfg.log, {
      surface: 'rest', operation: 'list_runs', args: { type, limit },
      result: 'ok', result_count: runs.length, latency_ms: Date.now() - start,
    });
    return reply.code(200).send({ runs, total: runs.length, limit });
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    const start = Date.now();
    if (!verifyBearer(req.headers.authorization, cfg.apiToken)) {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: null, args: null,
        result: 'unauthorized', result_count: null, latency_ms: Date.now() - start,
      });
      return reply.code(401).send({ error: 'unauthorized' } satisfies ApiErrorBody);
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: 'get_run', args: { id: req.params.id },
        result: 'invalid_argument', result_count: 0, latency_ms: Date.now() - start,
      });
      return reply.code(httpStatusFor('invalid_argument')).send({
        error: 'invalid_argument', detail: 'id must be a positive integer',
      } satisfies ApiErrorBody);
    }
    const run = getRun(cfg.db, id);
    if (!run) {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: 'get_run', args: { id },
        result: 'not_found', result_count: 0, latency_ms: Date.now() - start,
      });
      return reply.code(httpStatusFor('not_found')).send({
        error: 'not_found', id: String(id),
      } satisfies ApiErrorBody);
    }
    emitApiAudit(cfg.log, {
      surface: 'rest', operation: 'get_run', args: { id },
      result: 'ok', result_count: 1, latency_ms: Date.now() - start,
    });
    return reply.code(200).send(run);
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/findings', async (req, reply) => {
    const start = Date.now();
    if (!verifyBearer(req.headers.authorization, cfg.apiToken)) {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: null, args: null,
        result: 'unauthorized', result_count: null, latency_ms: Date.now() - start,
      });
      return reply.code(401).send({ error: 'unauthorized' } satisfies ApiErrorBody);
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: 'get_run_findings', args: { id: req.params.id },
        result: 'invalid_argument', result_count: 0, latency_ms: Date.now() - start,
      });
      return reply.code(httpStatusFor('invalid_argument')).send({
        error: 'invalid_argument', detail: 'id must be a positive integer',
      } satisfies ApiErrorBody);
    }
    const findings = getRunFindings(cfg.db, id);
    const dtos = findings.map((f) =>
      findingToSummaryDto(f, {
        isMuted: isMuted(cfg.db, f.fingerprint),
        graph: cfg.graph,
        knownTenants: cfg.knownTenants,
      }),
    );
    emitApiAudit(cfg.log, {
      surface: 'rest', operation: 'get_run_findings', args: { id },
      result: 'ok', result_count: dtos.length, latency_ms: Date.now() - start,
    });
    return reply.code(200).send({ findings: dtos, total: dtos.length });
  });
}
