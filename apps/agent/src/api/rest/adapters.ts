import type { FastifyInstance } from 'fastify';
import { getAdapterHealth, type Db } from '../../memory/index.js';
import { verifyBearer } from '../shared/auth.js';
import { emitApiAudit, type ApiAuditLogger } from '../shared/audit.js';
import type { ApiErrorBody } from '../shared/types.js';

export interface AdaptersRoutesConfig {
  db: Db;
  apiToken: string;
  knownAdapters: readonly string[];
  log: ApiAuditLogger;
}

export function registerAdaptersRoutes(app: FastifyInstance, cfg: AdaptersRoutesConfig): void {
  app.get('/api/adapters/health', async (req, reply) => {
    const start = Date.now();
    if (!verifyBearer(req.headers.authorization, cfg.apiToken)) {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: null, args: null,
        result: 'unauthorized', result_count: null, latency_ms: Date.now() - start,
      });
      return reply.code(401).send({ error: 'unauthorized' } satisfies ApiErrorBody);
    }
    const adapters = getAdapterHealth(cfg.db, cfg.knownAdapters);
    emitApiAudit(cfg.log, {
      surface: 'rest', operation: 'adapter_health', args: {},
      result: 'ok', result_count: adapters.length, latency_ms: Date.now() - start,
    });
    return reply.code(200).send({ adapters, total: adapters.length });
  });
}
