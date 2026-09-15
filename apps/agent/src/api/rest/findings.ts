import type { FastifyInstance } from 'fastify';
import type { ResourceGraph } from '../../config/types.js';
import {
  getFindingByFingerprint,
  getRecentFindings,
  isMuted,
  searchFindings,
  type Db,
} from '../../memory/index.js';
import { emitApiAudit, type ApiAuditLogger } from '../shared/audit.js';
import { verifyBearer } from '../shared/auth.js';
import { httpStatusFor } from '../shared/errors.js';
import { findingToDto, findingToSummaryDto, shortFingerprint } from '../shared/format.js';
import { resolveShortId } from '../shared/resolve-id.js';
import type {
  AmbiguousCandidate,
  ApiErrorBody,
  FindingDto,
  RecentFindingsResponse,
} from '../shared/types.js';

export interface FindingsRoutesConfig {
  db: Db;
  apiToken: string;
  graph: ResourceGraph;
  knownTenants: readonly string[];
  log: ApiAuditLogger;
}

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

export function registerFindingsRoutes(app: FastifyInstance, cfg: FindingsRoutesConfig): void {
  app.get<{ Params: { id: string } }>('/api/findings/:id', async (req, reply) => {
    const start = Date.now();
    if (!verifyBearer(req.headers.authorization, cfg.apiToken)) {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: null, args: null,
        result: 'unauthorized', result_count: null, latency_ms: Date.now() - start,
      });
      return reply.code(401).send({ error: 'unauthorized' } satisfies ApiErrorBody);
    }

    const id = req.params.id;
    const resolved = resolveShortId(cfg.db, id, { minHex: 6 });

    if (resolved.kind === 'invalid') {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: 'get_finding', args: { id },
        result: 'invalid_argument', result_count: 0, latency_ms: Date.now() - start,
      });
      return reply.code(httpStatusFor('invalid_argument')).send({
        error: 'invalid_argument',
        detail: 'id must be 6+ hex chars',
      } satisfies ApiErrorBody);
    }
    if (resolved.kind === 'none') {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: 'get_finding', args: { id },
        result: 'not_found', result_count: 0, latency_ms: Date.now() - start,
      });
      return reply.code(httpStatusFor('not_found'))
        .send({ error: 'not_found', id } satisfies ApiErrorBody);
    }
    if (resolved.kind === 'ambiguous') {
      const candidates: AmbiguousCandidate[] = resolved.candidates
        .map((fp) => getFindingByFingerprint(cfg.db, fp))
        .filter((f): f is NonNullable<typeof f> => f !== null)
        .map((f) => ({
          short_id: shortFingerprint(f.fingerprint),
          resource_id: f.resource_id,
          issue_class: f.issue_class,
          title: f.title,
          state: f.state,
        }));
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: 'get_finding', args: { id },
        result: 'ambiguous', result_count: candidates.length, latency_ms: Date.now() - start,
      });
      return reply.code(httpStatusFor('ambiguous'))
        .send({ error: 'ambiguous', candidates } satisfies ApiErrorBody);
    }

    const f = getFindingByFingerprint(cfg.db, resolved.fingerprint);
    if (!f) {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: 'get_finding', args: { id },
        result: 'not_found', result_count: 0, latency_ms: Date.now() - start,
      });
      return reply.code(httpStatusFor('not_found'))
        .send({ error: 'not_found', id } satisfies ApiErrorBody);
    }

    const dto: FindingDto = findingToDto(f, {
      isMuted: isMuted(cfg.db, f.fingerprint),
      graph: cfg.graph,
      knownTenants: cfg.knownTenants,
    });
    emitApiAudit(cfg.log, {
      surface: 'rest', operation: 'get_finding', args: { id },
      result: 'ok', result_count: 1, latency_ms: Date.now() - start,
    });
    return reply.code(200).send(dto);
  });

  app.get<{
    Querystring: { limit?: string; include_resolved?: string; include_muted?: string };
  }>('/api/findings', async (req, reply) => {
    const start = Date.now();
    if (!verifyBearer(req.headers.authorization, cfg.apiToken)) {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: null, args: null,
        result: 'unauthorized', result_count: null, latency_ms: Date.now() - start,
      });
      return reply.code(401).send({ error: 'unauthorized' } satisfies ApiErrorBody);
    }

    const limitRaw = req.query.limit;
    const limit = limitRaw === undefined ? DEFAULT_LIMIT : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: 'recent_findings', args: { limit: limitRaw ?? null },
        result: 'invalid_argument', result_count: 0, latency_ms: Date.now() - start,
      });
      return reply.code(httpStatusFor('invalid_argument')).send({
        error: 'invalid_argument',
        detail: `limit must be an integer in [1, ${MAX_LIMIT}]`,
      } satisfies ApiErrorBody);
    }

    const includeResolved = req.query.include_resolved === 'true';
    const includeMuted = req.query.include_muted === 'true';

    const result = getRecentFindings(cfg.db, { limit, includeResolved, includeMuted });

    const dtos = result.findings.map((f) =>
      findingToSummaryDto(f, {
        isMuted: includeMuted ? isMuted(cfg.db, f.fingerprint) : false,
        graph: cfg.graph,
        knownTenants: cfg.knownTenants,
      }),
    );

    const body: RecentFindingsResponse = { findings: dtos, total: result.total, limit };
    emitApiAudit(cfg.log, {
      surface: 'rest', operation: 'recent_findings',
      args: { limit, include_resolved: includeResolved, include_muted: includeMuted },
      result: 'ok', result_count: dtos.length, latency_ms: Date.now() - start,
    });
    return reply.code(200).send(body);
  });

  app.get<{ Querystring: { q?: string; limit?: string } }>(
    '/api/findings/search',
    async (req, reply) => {
      const start = Date.now();
      if (!verifyBearer(req.headers.authorization, cfg.apiToken)) {
        emitApiAudit(cfg.log, {
          surface: 'rest', operation: null, args: null,
          result: 'unauthorized', result_count: null, latency_ms: Date.now() - start,
        });
        return reply.code(401).send({ error: 'unauthorized' } satisfies ApiErrorBody);
      }
      const q = (req.query.q ?? '').trim();
      const limitRaw = req.query.limit;
      const limit = limitRaw === undefined ? DEFAULT_LIMIT : Number(limitRaw);

      if (q.length === 0) {
        emitApiAudit(cfg.log, {
          surface: 'rest', operation: 'search_findings', args: { q, limit: limitRaw ?? null },
          result: 'invalid_argument', result_count: 0, latency_ms: Date.now() - start,
        });
        return reply.code(httpStatusFor('invalid_argument')).send({
          error: 'invalid_argument', detail: 'q is required and non-empty',
        } satisfies ApiErrorBody);
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        emitApiAudit(cfg.log, {
          surface: 'rest', operation: 'search_findings', args: { q, limit: limitRaw ?? null },
          result: 'invalid_argument', result_count: 0, latency_ms: Date.now() - start,
        });
        return reply.code(httpStatusFor('invalid_argument')).send({
          error: 'invalid_argument', detail: `limit must be integer in [1, ${MAX_LIMIT}]`,
        } satisfies ApiErrorBody);
      }

      const rows = searchFindings(cfg.db, { q, limit });
      const dtos = rows.map((f) =>
        findingToSummaryDto(f, {
          isMuted: false,
          graph: cfg.graph,
          knownTenants: cfg.knownTenants,
        }),
      );
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: 'search_findings', args: { q, limit },
        result: 'ok', result_count: dtos.length, latency_ms: Date.now() - start,
      });
      return reply.code(200).send({ findings: dtos, total: dtos.length, limit });
    },
  );
}
