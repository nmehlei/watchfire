import type { FastifyInstance } from 'fastify';
import { verifyBearer } from '../shared/auth.js';
import { emitApiAudit, type ApiAuditLogger } from '../shared/audit.js';
import { getEventBus, type WatchfireEventName, type WatchfireEventPayload } from './bus.js';

export interface EventsRouteConfig {
  apiToken: string;
  log: ApiAuditLogger;
}

const HEARTBEAT_MS = 25_000;
const ALL_EVENTS: WatchfireEventName[] = [
  'nightly.completed',
  'watch.completed',
  'mute.created',
  'mute.deleted',
  'finding.upserted',
];

export function registerEventsRoute(app: FastifyInstance, cfg: EventsRouteConfig): void {
  app.get('/api/events', async (req, reply) => {
    const start = Date.now();
    if (!verifyBearer(req.headers.authorization, cfg.apiToken)) {
      emitApiAudit(cfg.log, {
        surface: 'rest', operation: null, args: null,
        result: 'unauthorized', result_count: null, latency_ms: Date.now() - start,
      });
      return reply.code(401).send({ error: 'unauthorized' });
    }

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.hijack();
    // Flush headers + open the stream so the client's reader unblocks immediately.
    reply.raw.write(': connected\n\n');

    const bus = getEventBus();
    type Listener = (p: WatchfireEventPayload[WatchfireEventName]) => void;
    const listeners: Array<{ name: WatchfireEventName; fn: Listener }> = [];

    for (const name of ALL_EVENTS) {
      const fn: Listener = (payload) => {
        const json = JSON.stringify(payload);
        try {
          reply.raw.write(`event: ${name}\ndata: ${json}\n\n`);
        } catch {
          // connection closed; cleanup happens via 'close' handler below
        }
      };
      bus.on(name, fn as (p: WatchfireEventPayload[typeof name]) => void);
      listeners.push({ name, fn });
    }

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: keepalive\n\n`);
      } catch {
        // ignore
      }
    }, HEARTBEAT_MS);

    reply.raw.on('close', () => {
      clearInterval(heartbeat);
      for (const { name, fn } of listeners) {
        bus.off(name, fn as (p: WatchfireEventPayload[typeof name]) => void);
      }
    });
  });
}
