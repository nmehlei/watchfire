import type { FastifyInstance } from 'fastify';
import type { ResourceGraph } from '../../config/types.js';
import { listActiveMutes, type Db } from '../../memory/index.js';
import { getEventBus } from '../events/bus.js';
import { applyMute, removeMute } from '../shared/mute-actions.js';
import { verifyBearer } from '../shared/auth.js';
import { emitApiAudit, type ApiAuditLogger } from '../shared/audit.js';
import { httpStatusFor } from '../shared/errors.js';
import type { ApiErrorBody } from '../shared/types.js';

export interface MutesRoutesConfig {
  db: Db;
  apiToken: string;
  graph: ResourceGraph;
  knownTenants: readonly string[];
  log: ApiAuditLogger;
}

export function registerMutesRoutes(app: FastifyInstance, cfg: MutesRoutesConfig): void {
  app.get('/api/mutes', async (req, reply) => {
    const start = Date.now();
    if (!verifyBearer(req.headers.authorization, cfg.apiToken)) {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: null, args: null,
        result: 'unauthorized', result_count: null, latency_ms: Date.now() - start,
      });
      return reply.code(401).send({ error: 'unauthorized' } satisfies ApiErrorBody);
    }
    const mutes = listActiveMutes(cfg.db);
    emitApiAudit(cfg.log, {
      surface: 'rest', operation: 'list_mutes', args: {},
      result: 'ok', result_count: mutes.length, latency_ms: Date.now() - start,
    });
    return reply.code(200).send({ mutes, total: mutes.length });
  });

  app.post<{ Body: { id?: string; duration?: string; reason?: string } }>(
    '/api/mutes',
    async (req, reply) => {
      const start = Date.now();
      if (!verifyBearer(req.headers.authorization, cfg.apiToken)) {
        emitApiAudit(cfg.log, {
          surface: 'rest', operation: null, args: null,
          result: 'unauthorized', result_count: null, latency_ms: Date.now() - start,
        });
        return reply.code(401).send({ error: 'unauthorized' } satisfies ApiErrorBody);
      }
      const body = req.body ?? {};
      if (!body.id || typeof body.id !== 'string') {
        emitApiAudit(cfg.log, {
          surface: 'rest', operation: 'mute_finding', args: { id: body.id ?? null },
          result: 'invalid_argument', result_count: 0, latency_ms: Date.now() - start,
        });
        return reply.code(httpStatusFor('invalid_argument')).send({
          error: 'invalid_argument', detail: 'id is required',
        } satisfies ApiErrorBody);
      }

      const out = applyMute(cfg.db, {
        id: body.id,
        ...(body.duration ? { duration: body.duration } : {}),
        ...(body.reason !== undefined ? { reason: body.reason } : {}),
        source: 'manual',
      });

      const auditArgs = {
        id: body.id,
        duration: body.duration ?? null,
        reason: body.reason ?? null,
      };

      if (out.kind === 'invalid_argument') {
        emitApiAudit(cfg.log, {
          surface: 'rest', operation: 'mute_finding', args: auditArgs,
          result: 'invalid_argument', result_count: 0, latency_ms: Date.now() - start,
        });
        return reply.code(httpStatusFor('invalid_argument')).send({
          error: 'invalid_argument', detail: out.detail,
        } satisfies ApiErrorBody);
      }
      if (out.kind === 'not_found') {
        emitApiAudit(cfg.log, {
          surface: 'rest', operation: 'mute_finding', args: auditArgs,
          result: 'not_found', result_count: 0, latency_ms: Date.now() - start,
        });
        return reply.code(httpStatusFor('not_found')).send({
          error: 'not_found', id: body.id,
        } satisfies ApiErrorBody);
      }
      if (out.kind === 'ambiguous') {
        emitApiAudit(cfg.log, {
          surface: 'rest', operation: 'mute_finding', args: auditArgs,
          result: 'ambiguous', result_count: out.candidates.length, latency_ms: Date.now() - start,
        });
        return reply.code(httpStatusFor('ambiguous')).send({
          error: 'ambiguous', candidates: out.candidates,
        } satisfies ApiErrorBody);
      }

      getEventBus().emit('mute.created', { fingerprint: out.fingerprint });
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: 'mute_finding', args: auditArgs,
        result: 'ok', result_count: 1, latency_ms: Date.now() - start,
      });
      return reply.code(201).send({ fingerprint: out.fingerprint, expires_at: out.expires_at });
    },
  );

  app.delete<{ Params: { id: string } }>('/api/mutes/:id', async (req, reply) => {
    const start = Date.now();
    if (!verifyBearer(req.headers.authorization, cfg.apiToken)) {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: null, args: null,
        result: 'unauthorized', result_count: null, latency_ms: Date.now() - start,
      });
      return reply.code(401).send({ error: 'unauthorized' } satisfies ApiErrorBody);
    }
    const out = removeMute(cfg.db, { id: req.params.id });
    const auditArgs = { id: req.params.id };

    if (out.kind === 'invalid_argument') {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: 'unmute_finding', args: auditArgs,
        result: 'invalid_argument', result_count: 0, latency_ms: Date.now() - start,
      });
      return reply.code(httpStatusFor('invalid_argument')).send({
        error: 'invalid_argument', detail: out.detail,
      } satisfies ApiErrorBody);
    }
    if (out.kind === 'not_found') {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: 'unmute_finding', args: auditArgs,
        result: 'not_found', result_count: 0, latency_ms: Date.now() - start,
      });
      return reply.code(httpStatusFor('not_found')).send({
        error: 'not_found', id: req.params.id,
      } satisfies ApiErrorBody);
    }
    if (out.kind === 'ambiguous') {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: 'unmute_finding', args: auditArgs,
        result: 'ambiguous', result_count: out.candidates.length, latency_ms: Date.now() - start,
      });
      return reply.code(httpStatusFor('ambiguous')).send({
        error: 'ambiguous', candidates: out.candidates,
      } satisfies ApiErrorBody);
    }

    if (out.deleted_count > 0) {
      getEventBus().emit('mute.deleted', { fingerprint: out.fingerprint });
    }
    emitApiAudit(cfg.log, {
      surface: 'rest', operation: 'unmute_finding', args: auditArgs,
      result: 'ok', result_count: out.deleted_count, latency_ms: Date.now() - start,
    });
    return reply.code(200).send({ fingerprint: out.fingerprint, deleted_count: out.deleted_count });
  });
}
