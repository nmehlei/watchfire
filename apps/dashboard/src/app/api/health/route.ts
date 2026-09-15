export const dynamic = "force-dynamic";

/**
 * Liveness probe for App Service. Public — middleware excludes it from
 * the auth gate. Intentionally does NOT call Watchfire: this endpoint just
 * confirms the dashboard process is alive and the runtime is healthy.
 */
export function GET(): Response {
  return Response.json({ ok: true });
}
