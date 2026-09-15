import type { FastifyInstance } from 'fastify';
import { getCostWindow, type Db } from '../../memory/index.js';
import { verifyBearer } from '../shared/auth.js';
import { emitApiAudit, type ApiAuditLogger } from '../shared/audit.js';
import { httpStatusFor } from '../shared/errors.js';
import type { ApiErrorBody } from '../shared/types.js';

export interface CostRoutesConfig {
  db: Db;
  apiToken: string;
  log: ApiAuditLogger;
}

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;

export function registerCostRoutes(app: FastifyInstance, cfg: CostRoutesConfig): void {
  app.get<{ Querystring: { days?: string } }>('/api/cost-window', async (req, reply) => {
    const start = Date.now();
    if (!verifyBearer(req.headers.authorization, cfg.apiToken)) {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: null, args: null,
        result: 'unauthorized', result_count: null, latency_ms: Date.now() - start,
      });
      return reply.code(401).send({ error: 'unauthorized' } satisfies ApiErrorBody);
    }
    const daysRaw = req.query.days;
    const days = daysRaw === undefined ? DEFAULT_DAYS : Number(daysRaw);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: 'cost_window', args: { days: daysRaw ?? null },
        result: 'invalid_argument', result_count: 0, latency_ms: Date.now() - start,
      });
      return reply.code(httpStatusFor('invalid_argument')).send({
        error: 'invalid_argument', detail: `days must be integer in [1, ${MAX_DAYS}]`,
      } satisfies ApiErrorBody);
    }
    const out = getCostWindow(cfg.db, { days });
    emitApiAudit(cfg.log, {
      surface: 'rest', operation: 'cost_window', args: { days },
      result: 'ok', result_count: out.daily_buckets.length, latency_ms: Date.now() - start,
    });
    return reply.code(200).send(out);
  });
}
