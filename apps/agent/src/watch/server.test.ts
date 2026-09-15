import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Tenant } from '../config/types.js';
import { BoundedSerialQueue } from './queue.js';
import { createWatchServer, type WatchEnqueuePayload } from './server.js';

const TENANTS: Tenant[] = [
  {
    id: 'acme',
    display_name: 'ACME',
    systems: [{ type: 'observability', stream: 'acme', token_env: 'X' }],
  },
  {
    id: 'initech',
    display_name: 'Initech',
    systems: [{ type: 'observability', stream: 'initech', token_env: 'Y' }],
  },
];

function makeAlert(stream: string) {
  return {
    alert_name: 'disk-high',
    stream,
    severity: 'critical',
    fired_at: '2026-04-22T02:14:07Z',
  };
}

describe('watch server', () => {
  let received: WatchEnqueuePayload[];
  let queue: BoundedSerialQueue<WatchEnqueuePayload>;

  beforeEach(() => {
    received = [];
    queue = new BoundedSerialQueue<WatchEnqueuePayload>(async (p) => {
      received.push(p);
    });
  });

  afterEach(async () => {
    await queue.idle();
  });

  it('GET /health → 200 ok:true', async () => {
    const app = createWatchServer({ tenants: TENANTS, queue, signature: {} });
    const resp = await app.inject({ method: 'GET', url: '/health' });
    expect(resp.statusCode).toBe(200);
    expect(resp.json()).toEqual({ ok: true });
    await app.close();
  });

  it('POST /webhook/openobserve → 202 + enqueued', async () => {
    const app = createWatchServer({ tenants: TENANTS, queue, signature: {} });
    const resp = await app.inject({
      method: 'POST',
      url: '/webhook/openobserve',
      headers: { 'content-type': 'application/json' },
      payload: makeAlert('acme'),
    });
    expect(resp.statusCode).toBe(202);
    expect(resp.json()).toMatchObject({ queued: true });
    await queue.idle();
    expect(received).toHaveLength(1);
    expect(received[0]!.tenant.id).toBe('acme');
    await app.close();
  });

  it('unknown stream → 400', async () => {
    const app = createWatchServer({ tenants: TENANTS, queue, signature: {} });
    const resp = await app.inject({
      method: 'POST',
      url: '/webhook/openobserve',
      headers: { 'content-type': 'application/json' },
      payload: makeAlert('unknown-stream'),
    });
    expect(resp.statusCode).toBe(400);
    expect(resp.json()).toMatchObject({ error: expect.stringMatching(/unknown stream/) });
    await app.close();
  });

  it('malformed JSON → 400', async () => {
    const app = createWatchServer({ tenants: TENANTS, queue, signature: {} });
    const resp = await app.inject({
      method: 'POST',
      url: '/webhook/openobserve',
      headers: { 'content-type': 'application/json' },
      payload: 'not json',
    });
    expect(resp.statusCode).toBe(400);
    await app.close();
  });

  it('signature required when secret configured; rejects missing', async () => {
    const app = createWatchServer({
      tenants: TENANTS,
      queue,
      signature: { secret: 'shared-secret' },
    });
    const resp = await app.inject({
      method: 'POST',
      url: '/webhook/openobserve',
      headers: { 'content-type': 'application/json' },
      payload: makeAlert('acme'),
    });
    expect(resp.statusCode).toBe(401);
    expect(resp.json()).toMatchObject({ error: 'missing-signature' });
    await app.close();
  });

  it('signature verifies correctly when valid', async () => {
    const app = createWatchServer({
      tenants: TENANTS,
      queue,
      signature: { secret: 'shared-secret' },
    });
    const body = JSON.stringify(makeAlert('acme'));
    const sig = createHmac('sha256', 'shared-secret').update(body).digest('hex');
    const resp = await app.inject({
      method: 'POST',
      url: '/webhook/openobserve',
      headers: {
        'content-type': 'application/json',
        'x-openobserve-signature': sig,
      },
      payload: body,
    });
    expect(resp.statusCode).toBe(202);
    await app.close();
  });

  it('bad signature → 401', async () => {
    const app = createWatchServer({
      tenants: TENANTS,
      queue,
      signature: { secret: 'shared-secret' },
    });
    const body = JSON.stringify(makeAlert('acme'));
    const sig = createHmac('sha256', 'wrong-secret').update(body).digest('hex');
    const resp = await app.inject({
      method: 'POST',
      url: '/webhook/openobserve',
      headers: {
        'content-type': 'application/json',
        'x-openobserve-signature': sig,
      },
      payload: body,
    });
    expect(resp.statusCode).toBe(401);
    expect(resp.json()).toMatchObject({ error: 'signature-invalid' });
    await app.close();
  });

  it('IRIS_WEBHOOK_VERIFY=false bypasses even with secret set', async () => {
    const app = createWatchServer({
      tenants: TENANTS,
      queue,
      signature: { secret: 'shared-secret', skip: true },
    });
    const resp = await app.inject({
      method: 'POST',
      url: '/webhook/openobserve',
      headers: { 'content-type': 'application/json' },
      payload: makeAlert('acme'),
    });
    expect(resp.statusCode).toBe(202);
    await app.close();
  });

  it('POST /webhook/generic → 501', async () => {
    const app = createWatchServer({ tenants: TENANTS, queue, signature: {} });
    const resp = await app.inject({
      method: 'POST',
      url: '/webhook/generic',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(resp.statusCode).toBe(501);
    await app.close();
  });

  it('POST /webhook/telegram → 501 when no handler configured', async () => {
    const app = createWatchServer({ tenants: TENANTS, queue, signature: {} });
    const resp = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(resp.statusCode).toBe(501);
    await app.close();
  });

  it('POST /webhook/telegram → 401 on bad secret, 200 otherwise', async () => {
    let calls = 0;
    const handler = async (input: { secretHeader: string | undefined }) => {
      calls += 1;
      if (input.secretHeader === 'good') return { kind: 'dispatched' as const, command: '/help', outcome: 'ok' };
      return { kind: 'unauthenticated' as const };
    };
    const app = createWatchServer({
      tenants: TENANTS,
      queue,
      signature: {},
      telegram: handler,
    });
    const bad = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'wrong' },
      payload: { update_id: 1 },
    });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'good' },
      payload: { update_id: 1 },
    });
    expect(ok.statusCode).toBe(200);
    expect(calls).toBe(2);
    await app.close();
  });

  it('queue full → 429 with Retry-After', async () => {
    // Use a slow processor so the queue fills.
    const slowQueue = new BoundedSerialQueue<WatchEnqueuePayload>(
      () => new Promise((resolve) => setTimeout(resolve, 50)),
      { maxDepth: 2 },
    );
    const app = createWatchServer({
      tenants: TENANTS,
      queue: slowQueue,
      signature: {},
      retryAfterSeconds: 42,
    });
    try {
      const first = await app.inject({
        method: 'POST',
        url: '/webhook/openobserve',
        headers: { 'content-type': 'application/json' },
        payload: makeAlert('acme'),
      });
      expect(first.statusCode).toBe(202);
      const second = await app.inject({
        method: 'POST',
        url: '/webhook/openobserve',
        headers: { 'content-type': 'application/json' },
        payload: makeAlert('acme'),
      });
      expect(second.statusCode).toBe(202);
      const third = await app.inject({
        method: 'POST',
        url: '/webhook/openobserve',
        headers: { 'content-type': 'application/json' },
        payload: makeAlert('acme'),
      });
      expect(third.statusCode).toBe(429);
      expect(third.headers['retry-after']).toBe('42');
    } finally {
      await slowQueue.idle();
      await app.close();
    }
  });
});
