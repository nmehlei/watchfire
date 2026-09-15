import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { EventBus, _setEventBusForTests } from './bus.js';
import { registerEventsRoute } from './server.js';

function buildApp(token = 'tok'): FastifyInstance {
  const app = Fastify({ logger: false });
  registerEventsRoute(app, { apiToken: token, log: () => {} });
  return app;
}

describe('GET /api/events', () => {
  it('401 without bearer', async () => {
    const r = await buildApp().inject({ method: 'GET', url: '/api/events' });
    expect(r.statusCode).toBe(401);
  });

  it('streams an event when emitted', async () => {
    const bus = new EventBus();
    _setEventBusForTests(bus);
    const app = buildApp();

    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    try {
      const ctrl = new AbortController();
      const resp = await fetch(`http://127.0.0.1:${port}/api/events`, {
        headers: { authorization: 'Bearer tok' },
        signal: ctrl.signal,
      });
      expect(resp.status).toBe(200);
      expect(resp.headers.get('content-type')).toMatch(/text\/event-stream/);

      setTimeout(() => bus.emit('mute.created', { fingerprint: 'abc'.padEnd(64, 'a') }), 10);

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.includes('event: mute.created')) break;
      }
      ctrl.abort();
      expect(buffer).toContain('event: mute.created');
      expect(buffer).toContain('"fingerprint"');
    } finally {
      await app.close();
      _setEventBusForTests(null);
    }
  });
});
