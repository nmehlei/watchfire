import { auth } from "@/auth";
import { env } from "@/lib/env";
import { log, newTraceId } from "@/lib/log";

export const dynamic = "force-dynamic";
// Tell Next.js this route runs in Node.js (not Edge) — we need
// fetch's streaming body + a long-lived response.
export const runtime = "nodejs";

/**
 * SSE proxy: opens an upstream EventSource-shaped connection to
 * Watchfire /api/events with the bearer attached, then streams every
 * byte through to the browser as text/event-stream. The browser
 * uses the standard EventSource API — no auth header reaches it.
 *
 * Forwards x-trace-id upstream so the SSE channel correlates with
 * the BFF requests issued from the same browser session (spec 12
 * §Observability).
 */
export async function GET(req: Request): Promise<Response> {
  const trace_id = newTraceId();
  const session = await auth();
  if (!session) {
    log.warn("sse.unauthorized", { trace_id });
    return new Response("Unauthorized", { status: 401 });
  }

  const upstream = await fetch(`${env.WATCHFIRE_API_URL}/api/events`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${env.WATCHFIRE_API_TOKEN}`,
      accept: "text/event-stream",
      "x-trace-id": trace_id,
    },
    // Important: do NOT set cache, do NOT buffer. We need the body
    // stream live.
    signal: req.signal,
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    log.error("sse.upstream_refused", {
      trace_id,
      status: upstream.status,
      body: text.slice(0, 200),
    });
    return new Response(`Upstream SSE refused: ${upstream.status} ${text.slice(0, 200)}`, {
      status: 502,
    });
  }

  log.info("sse.open", { trace_id });
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
      "x-trace-id": trace_id,
    },
  });
}
