import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { registerEventsRoute } from '../api/events/server.js';
import { registerMcpRoute } from '../api/mcp/server.js';
import { enterTrace, normalizeTraceId } from '../api/shared/trace.js';
import { registerAdaptersRoutes } from '../api/rest/adapters.js';
import { registerCostRoutes } from '../api/rest/cost.js';
import { registerFindingsRoutes } from '../api/rest/findings.js';
import { registerMutesRoutes } from '../api/rest/mutes.js';
import { registerRunsRoutes } from '../api/rest/runs.js';
import type { ApiAuditLogger } from '../api/shared/audit.js';
import type { ResourceGraph, Tenant } from '../config/types.js';
import type { Db } from '../memory/index.js';
import type { BoundedSerialQueue } from './queue.js';
import {
  parseOpenObservePayload,
  type ParsedAlert,
} from './webhooks/openobserve.js';
import {
  verifyOpenObserveSignature,
  type SignatureConfig,
} from './webhooks/signature.js';
import type { createTelegramHandler } from './webhooks/telegram.js';

export interface WatchEnqueuePayload {
  tenant: Tenant;
  parsed: ParsedAlert;
  source: 'openobserve';
}

export interface ServerConfig {
  tenants: readonly Tenant[];
  queue: BoundedSerialQueue<WatchEnqueuePayload>;
  signature: SignatureConfig;
  /**
   * Optional Telegram webhook handler. When provided, the server mounts
   * `POST /webhook/telegram`; absent → 501 stub.
   */
  telegram?: ReturnType<typeof createTelegramHandler>;
  /** Logger injection; default false keeps test output quiet. */
  logger?: boolean;
  /** Seconds advertised in Retry-After when the queue is full. Default 30. */
  retryAfterSeconds?: number;
  /**
   * When provided, mount the spec 11 read surfaces:
   *   - GET /api/findings, GET /api/findings/:id (REST)
   *   - POST /mcp (Streamable HTTP MCP)
   * Both are gated by the same bearer token.
   */
  api?: {
    db: Db;
    apiToken: string;
    graph: ResourceGraph;
    knownTenants: readonly string[];
    knownAdapters: readonly string[];
    log: ApiAuditLogger;
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

/**
 * Build (but do NOT start) the watch HTTP server. Call `.listen({ port })`
 * when you want the socket up; tests use `.inject()` for speed.
 */
export function createWatchServer(config: ServerConfig): FastifyInstance {
  const app = Fastify({ logger: config.logger ?? false });
  const streamToTenant = buildStreamIndex(config.tenants);
  const retryAfterSeconds = config.retryAfterSeconds ?? 30;

  // Bind a trace id per request (forwarded by the dashboard BFF as
  // x-trace-id, or freshly minted). The audit emitter reads it ambiently
  // so both sides log the same id (spec 11 §Audit / spec 12 §Observability).
  app.addHook('onRequest', async (req) => {
    enterTrace(normalizeTraceId(req.headers['x-trace-id'] as string | undefined));
  });

  // Preserve the raw body on the request so signature verification sees the
  // exact bytes that were signed. Fastify parses JSON by default, so we
  // override the parser to stash the raw string first.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req: FastifyRequest, body, done) => {
      req.rawBody = body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        const wrapped = err as Error & { statusCode?: number };
        wrapped.statusCode = 400;
        done(wrapped, undefined);
      }
    },
  );

  app.get('/health', async () => ({ ok: true }));

  app.post('/webhook/openobserve', async (req, reply) => {
    const raw = req.rawBody ?? '';
    const signatureHeader =
      (req.headers['x-openobserve-signature'] as string | undefined) ??
      (req.headers['x-webhook-signature'] as string | undefined);

    const verification = verifyOpenObserveSignature(raw, signatureHeader, config.signature);
    if (!verification.verified) {
      return reply.code(401).send({ error: verification.reason });
    }

    const parsed = parseOpenObservePayload(raw);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.reason });
    }

    const tenant = streamToTenant.get(parsed.parsed.alert.stream);
    if (!tenant) {
      return reply
        .code(400)
        .send({ error: `unknown stream: ${parsed.parsed.alert.stream}` });
    }

    const enqueued = config.queue.enqueue({
      tenant,
      parsed: parsed.parsed,
      source: 'openobserve',
    });

    if (!enqueued) {
      return reply
        .code(429)
        .header('retry-after', String(retryAfterSeconds))
        .send({ error: 'queue full; retry later' });
    }

    return reply.code(202).send({ queued: true, depth: config.queue.depth });
  });

  app.post('/webhook/telegram', async (req, reply) => {
    if (!config.telegram) {
      return reply.code(501).send({ error: 'telegram webhook not configured' });
    }
    const secretHeader = req.headers['x-telegram-bot-api-secret-token'] as string | undefined;
    const outcome = await config.telegram({ body: req.body, secretHeader });
    if (outcome.kind === 'unauthenticated') {
      return reply.code(401).send({ error: 'bad secret token' });
    }
    return reply.code(200).send({});
  });

  app.post('/webhook/generic', async (_req, reply) =>
    reply.code(501).send({ error: 'not implemented' }),
  );

  if (config.api) {
    registerFindingsRoutes(app, config.api);
    registerRunsRoutes(app, config.api);
    registerMutesRoutes(app, config.api);
    registerCostRoutes(app, {
      db: config.api.db,
      apiToken: config.api.apiToken,
      log: config.api.log,
    });
    registerAdaptersRoutes(app, {
      db: config.api.db,
      apiToken: config.api.apiToken,
      knownAdapters: config.api.knownAdapters,
      log: config.api.log,
    });
    registerEventsRoute(app, {
      apiToken: config.api.apiToken,
      log: config.api.log,
    });
    registerMcpRoute(app, config.api);
  }

  return app;
}

function buildStreamIndex(tenants: readonly Tenant[]): Map<string, Tenant> {
  const index = new Map<string, Tenant>();
  for (const t of tenants) {
    for (const s of t.systems) {
      if (s.type === 'observability') {
        if (index.has(s.stream)) {
          throw new Error(
            `duplicate observability stream "${s.stream}" on tenants ${
              index.get(s.stream)?.id
            } + ${t.id}`,
          );
        }
        index.set(s.stream, t);
      }
    }
  }
  return index;
}
