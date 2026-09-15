import { auth } from "@/auth";
import { env } from "@/lib/env";
import { log, newTraceId } from "@/lib/log";

export const dynamic = "force-dynamic";

const ALLOWED_METHODS = new Set(["GET", "POST", "DELETE"]);
// Defence in depth — Auth.js gates the route, but a stray request that
// somehow reaches the handler must not be allowed to call arbitrary Watchfire
// paths (e.g. to bypass the bearer scope Watchfire enforces). Each prefix
// matches what the dashboard actually uses.
const ALLOWED_PREFIXES = [
  "findings",
  "runs",
  "mutes",
  "cost-window",
  "adapters",
  "events",
];

/**
 * Generic BFF proxy: forwards /api/watchfire/<path...> to <WATCHFIRE_API_URL>/api/<path...>
 * with the bearer attached server-side. The client never sees the token.
 *
 * Every request gets a trace_id forwarded to Watchfire as `x-trace-id`. Both
 * sides log the same id so cross-stream queries in OpenObserve give a
 * complete request flow (spec 12 §Observability).
 */
async function proxy(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const trace_id = req.headers.get("x-trace-id") ?? newTraceId();
  const started = Date.now();

  const session = await auth();
  if (!session) {
    log.warn("bff.unauthorized", { trace_id, path: new URL(req.url).pathname });
    return new Response("Unauthorized", { status: 401 });
  }

  if (!ALLOWED_METHODS.has(req.method)) {
    return new Response("Method not allowed", { status: 405 });
  }

  const { path } = await ctx.params;
  if (!path?.length || !ALLOWED_PREFIXES.includes(path[0]!)) {
    log.warn("bff.forbidden_prefix", { trace_id, prefix: path?.[0] ?? null });
    return new Response("Not found", { status: 404 });
  }

  const target = new URL(req.url);
  const upstream = new URL(`${env.WATCHFIRE_API_URL}/api/${path.join("/")}`);
  upstream.search = target.search;

  const body = req.method === "GET" || req.method === "DELETE" ? undefined : await req.text();

  const upstreamRes = await fetch(upstream, {
    method: req.method,
    headers: {
      authorization: `Bearer ${env.WATCHFIRE_API_TOKEN}`,
      "content-type": req.headers.get("content-type") ?? "application/json",
      accept: "application/json",
      "x-trace-id": trace_id,
    },
    body,
    cache: "no-store",
  });

  log.info("bff.request", {
    trace_id,
    method: req.method,
    upstream_path: `${upstream.pathname}${upstream.search}`,
    status: upstreamRes.status,
    latency_ms: Date.now() - started,
  });

  // Stream the upstream body back unchanged. Drop the bearer header (it
  // isn't in the response anyway — defence in depth).
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: {
      "content-type": upstreamRes.headers.get("content-type") ?? "application/json",
      "x-trace-id": trace_id,
    },
  });
}

export { proxy as GET, proxy as POST, proxy as DELETE };
