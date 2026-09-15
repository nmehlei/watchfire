# Watchfire-Dashboard

## Purpose

A Next.js web app that gives the operator a real overview of Watchfire — current findings, run history, mutes, cost trend, adapter health — installable as a PWA on the operator's phone. Consumes Watchfire's API surfaces (spec 11) server-side; the bearer token never leaves the dashboard's App Service environment.

The killer use case: operator gets a Telegram ping, opens the dashboard on their phone, has the full picture in 5 seconds. Beyond that, the dashboard is the canonical "how is Watchfire doing?" status board — replaces the implicit knowledge that today lives in `git log` + `sqlite3 iris.db` over SSH.

This spec owns:

- Repo + deploy shape (the `apps/dashboard/` workspace here, built by Azure Pipelines; infrastructure in the IaC repo's `solutions/iris-dashboard/`)
- Hosting (existing Windows App Service plan, native Node.js, no container)
- User-facing auth (Entra ID via ACME AAD tenant, single-operator gate)
- Page surface and per-page data flow
- PWA layer (manifest, service worker, offline behaviour)
- Mobile-first UX (bottom-tab navigation, responsive breakpoints)
- Real-time event flow (SSE, BFF proxying)
- Observability (OpenObserve, request correlation)
- Module layout under `src/`

This spec **does not** own: the Watchfire API contract itself (that's `specs/11-mcp.md`, which gets amended in lockstep — see §Spec 11 dependencies), the underlying findings DB schema (`specs/06-memory.md`), the AAD module's Terraform internals (lives in `your-iac-repo/modules/azure/aad_app_registration`), or the Azure DevOps pipeline service-connection setup (lives in your-iac-repo project settings).

## Non-goals

- **Multi-user.** Single operator, gated at the AAD layer via `assignmentRequired: true`. No user-management UI. No role splits. If a second operator is ever onboarded, that's a future spec change with explicit RBAC.
- **Mutating tenant infrastructure.** Same report-only invariant as Watchfire itself. The dashboard can mute/unmute findings (Watchfire-state writes) but never anything reaching tenant infra.
- **Replacing Telegram.** Telegram remains the push surface for digests + pages. The dashboard is for *consumption* and *control*, not notification. No web push notifications in v1.
- **Offline-first.** The dashboard is an *online* tool with offline degradation, not a local-first app. PWA caching gets you the last-seen state when the network drops; mutations require connectivity.
- **Real-time-first.** SSE updates are a quality bump, not a hard requirement. The dashboard works fine if SSE is disabled — manual refresh + polling fall-back gives the same data.
- **Browser-direct API access.** Spec 11's "no CORS, no browser-direct" stance is preserved. All Watchfire calls go through the dashboard's BFF (Next.js route handlers). Bearer never reaches the browser.

## Architecture

```
                       Operator's phone / desktop
                                  │
                        Microsoft Entra sign-in
                                  │
                                  ▼
                ┌─────────────────────────────────────────┐
                │  iris-dashboard.example.com             │
                │  (Windows App Service, native Node ≥22) │
                │                                         │
                │  Next.js 15 (latest stable)             │
                │  ├─ RSC pages (overview, findings, ...) │
                │  ├─ Client components (filters, search) │
                │  ├─ /api/iris/[...] BFF proxy           │
                │  ├─ /api/events SSE proxy               │
                │  └─ /api/auth/[...nextauth] Auth.js     │
                │                                         │
                │  IRIS_API_TOKEN in app_settings         │
                │  (server-side only, never reaches DOM)  │
                └─────────────────────────────────────────┘
                                  │
                          Authorization: Bearer …
                                  ▼
                       https://iris.example.com
                          (Watchfire — spec 11)
```

Three boundaries:

1. **User → Dashboard.** Cookie session minted by Auth.js after Entra sign-in. HttpOnly, Secure, SameSite=Lax, `__Host-` prefixed.
2. **Dashboard → Watchfire.** Bearer token in `Authorization` header. Server-side only. Token sourced from App Service `app_settings`, rendered by Terraform from `secrets.enc.yaml`.
3. **Operator's user identity** (Entra `oid`) is never sent to Watchfire. Watchfire doesn't track per-user data; the dashboard's auth gate is purely access control for the dashboard itself.

## Repo + deploy

**Source: the `@watchfire/dashboard` workspace at `apps/dashboard/` in this repository.** The dashboard began as a separate Azure DevOps repository and was folded into the Watchfire monorepo; source and pipeline live together at `apps/dashboard/ci/azure-pipelines.yml`.

Azure Pipelines remains its CI/CD — GitHub Actions builds only the agent image. Because the pipeline's source must be repointed at the monorepo by hand (a GitHub service connection in the Azure DevOps project), see `docs/deployment.md` for the cutover, and do not archive the old repository until a GitHub-sourced run has deployed successfully.

**Infrastructure: `your-iac-repo/solutions/iris-dashboard/`.** Two repos total. Layout follows `app-service-plan-metrics-forwarder`:

```
your-iac-repo/solutions/iris-dashboard/
  terraform/                # App Service, custom domain, AAD app reg, DNS
  ansible/                  # (none — App Service deploy is via pipeline, no host config)
  secrets.enc.yaml          # SOPS+age encrypted: IRIS_API_TOKEN, AAD client secret
  edit-secrets.sh           # SOPS edit wrapper
  deploy.sh                 # decrypt secrets → terraform apply
  README.md
```

**New your-iac-repo module: `your-iac-repo/modules/azure/aad_app_registration`.** Encapsulates `azuread_application` + service principal + client secret + `assignment_required` gating + redirect URIs. Reusable for any future Entra-protected web app. Outputs: `client_id`, `tenant_id`, `client_secret` (sensitive).

**CI: Azure DevOps Pipelines.** `ci/azure-pipelines.yml` in the dashboard repo. On push to `main`:

1. `npm ci`
2. `npm run lint && npm run typecheck && npm test`
3. `npm run build` (produces `.next/standalone/` + static assets)
4. Package the standalone build as a zip
5. `AzureWebApp@1` task deploys to the App Service via an **AzureRM service connection** (Azure DevOps service principal with `Website Contributor` on the dashboard's RG)

**Rollback**: re-run a previous pipeline run, or use App Service deployment slots for blue/green on Standard tier+. Slot swap is one click in the portal.

## Hosting

- **Existing Windows App Service plan**, native Node.js runtime stack (LTS Node ≥ 22).
- **No container.** Next.js `output: 'standalone'` produces a self-contained `server.js`; App Service runs it as the startup command.
- **Hostname: `iris-dashboard.example.com`** → CNAME to App Service default hostname (Azure DNS, Terraform via the existing `modules/azure/cname_record`).
- **TLS: App Service managed certificate** (free for custom domains on B1+).
- **Always On**: enabled.

## Authentication

Entra ID via the ACME AAD tenant, gated to a single user.

### Sign-in flow

1. Operator opens `https://iris-dashboard.example.com`.
2. Auth.js middleware detects no session → redirects to Microsoft sign-in (PKCE flow, mobile-friendly).
3. After Microsoft auth → callback to `/api/auth/callback/microsoft-entra-id`.
4. Auth.js mints a session cookie. JWT strategy (no DB needed at this scale).
5. Subsequent requests carry the cookie; middleware validates and either proceeds or redirects to sign-in.

### Single-operator restriction

The AAD app registration is created with `assignment_required: true`. Only the operator's user object ID is added as an assigned principal. Anyone else attempting to sign in — including other users in the same ACME tenant — is bounced at Microsoft's authorization endpoint with a `consent_required` / `unauthorized` error before the dashboard ever sees them.

This is enforced at the platform layer, not the application layer. Even a misconfigured route handler can't accidentally let an unauthorized user in.

### Session

- **Strategy: JWT** (Auth.js default). No database for session storage.
- **Cookie**: HttpOnly, Secure, SameSite=Lax, `__Host-` prefixed. 30-day max-age; sliding refresh on activity.
- **Sign-out**: Auth.js `signOut()` clears the cookie. Operator can also revoke from the Microsoft "My Apps" page.

### Auth.js configuration

Provider: `MicrosoftEntraID` (was `azure-ad` in v4). Tenant ID + client ID from environment (`AZURE_AD_TENANT_ID`, `AZURE_AD_CLIENT_ID`); client secret from `AZURE_AD_CLIENT_SECRET`. All three rendered into the App Service `app_settings` from `secrets.enc.yaml` by Terraform.

## Page surface

| Route | Server / Client | Purpose |
|---|---|---|
| `/` | RSC | **Overview**. Top: severity counts (active critical/warn/info), last-nightly status pill, MTD cost. Middle: cost-trend sparkline (30 days) + adapter-health pills. Bottom: top 5 active findings teaser, "view all →" link to `/findings`. |
| `/findings` | RSC + client filters | **Findings list**. Filterable by tenant / severity / state / muted. Pagination 50/page (spec 11 cap). Click row → `/findings/[short_id]`. |
| `/findings/[short_id]` | RSC | **Finding detail**. Full DTO from `get_finding`. Mute toggle inline. |
| `/runs` | RSC + client filters | **Run history**. Filterable by type (nightly / watch). Each row: started_at, status, finding_count, turn_count, cost. Click → `/runs/[id]`. |
| `/runs/[id]` | RSC | **Run detail**. Full Run row + findings touched in this run. Link to transcript if available. |
| `/mutes` | RSC | **Active mutes**. Per-row unmute. |
| `/search` | client | **Search**. LIKE-search title + resource_id, live as you type, debounced 200ms. |
| `/api/auth/[...nextauth]` | Auth.js | Sign-in / callback / sign-out. |
| `/api/iris/[...path]` | route handler | Generic BFF proxy: `GET /api/iris/findings/abc` → `GET https://iris.example.com/api/findings/abc` with bearer injected. |
| `/api/events` | route handler | SSE proxy: dashboard server opens an EventSource to Watchfire, pipes events through to client. |

**Mobile layout** (default for screen widths < 768px):

- Bottom tab bar with 5 tabs: Overview, Findings, Runs, Mutes, Search.
- Detail pages stack-push with a back arrow in the top bar.
- Touch targets ≥ 44px per Apple HIG.
- Single-column layout; pull-to-refresh on list views.

**Desktop layout** (≥ 768px):

- Same bottom-tab affordances surfaced as a top nav.
- List views use a 2-column layout (list left, detail right) on screens ≥ 1280px.
- Otherwise drilldown navigation, same as mobile.

## Data flow

**Server-rendered pages** (`/`, `/findings`, `/findings/[id]`, `/runs`, `/runs/[id]`, `/mutes`):

- Next.js fetches in the RSC using `lib/iris.ts::irisFetch(path)` — a thin wrapper around `fetch` that injects the bearer and sets `cache: 'no-store'`.
- Stale-page risk is handled by the SSE-driven invalidation (see §Real-time below).

**Client interactivity** (filters, search, mute toggle):

- Client components use **TanStack Query** with `fetch('/api/iris/...')` → BFF route handler → Watchfire.
- Query keys factored in `src/lib/queryKeys.ts` so the SSE listener can invalidate precisely.
- Mute toggle uses a server action: form submit → server-side `irisFetch` POST → on success, `revalidatePath` for the affected page + emit a local `mute.created` to the SSE bus (which Watchfire will also broadcast, but the local emit gives the caller immediate UI feedback).

**Caching**: client-side only via TanStack Query (5s stale time on lists, 30s on the overview, infinite on finding detail until invalidated by SSE). Server-side `cache: 'no-store'` everywhere — we never want stale data on the server.

## Spec 11 dependencies

The dashboard requires **new endpoints + MCP tools** not in spec 11 v1. These get added to spec 11 in lockstep with this spec. See `specs/11-mcp.md` once amended.

**New read endpoints:**

| Endpoint | Purpose |
|---|---|
| `GET /api/runs?type=…&limit=…` | List recent runs (paginated, default 20, max 50) |
| `GET /api/runs/:id` | Single run detail |
| `GET /api/runs/:id/findings` | Findings touched by this run |
| `GET /api/findings/search?q=…&limit=…` | LIKE-search title + resource_id, case-insensitive |
| `GET /api/mutes` | List active mutes (already have `listActiveMutes` helper) |
| `GET /api/cost-window?days=30` | Aggregated cost: total, by type, daily buckets |
| `GET /api/adapters/health` | Per-adapter `last_observed_at` from observations table |
| `GET /api/events` | Server-Sent Events stream — see §Real-time |

**New write endpoints** (relaxes spec 11 §Non-goals to allow Watchfire-state writes — still no infra writes):

| Endpoint | Purpose |
|---|---|
| `POST /api/mutes` | Body `{ id, duration?, reason? }` — resolves id, calls `insertMute`, returns 201 with `{ fingerprint, expires_at }` |
| `DELETE /api/mutes/:id` | Resolves id, calls `deleteMutesByFingerprint`, returns 204 |

**New MCP tools** (matching the new endpoints):

`list_runs`, `get_run`, `get_run_findings`, `search_findings`, `list_mutes`, `mute_finding`, `unmute_finding`, `cost_window`, `adapter_health`.

**Spec 11 §Non-goals updated:** the line "no writes of any kind in v1" is replaced with "no infra writes; Watchfire-state writes (mutes, future ad-hoc run triggers) allowed under the same bearer-token gate. Report-only invariant for tenant infrastructure preserved."

### Decisions on the new endpoints

- **Search scope**: title + resource_id only. Skipping evidence (often noisy log lines, low signal-to-noise for finding lookup).
- **Adapter health**: derived from `observations.source` last-write. Adapters that don't write observations (`obs-search`, `obs-streams` query-only) report `last_observed_at: null` with a UI note. Acceptable approximation for v1; if it stops being useful, instrument adapters to write a heartbeat observation.
- **Cost trend granularity**: daily buckets, 30-day window. Each bucket is `SUM(cost_eur) WHERE date(started_at) = D`.
- **Run detail's "findings touched"**: query `findings WHERE last_run_id = ? OR first_run_id = ?` — captures every finding that was either created or refreshed by this run.

## Real-time event flow (SSE)

### Watchfire server side

- New module `apps/agent/src/api/events/bus.ts` — process-local `EventEmitter`. Singleton.
- Emitters wired in:
  - `runNightly()` end → emit `nightly.completed` `{ runId, status }`
  - `runWatch()` end → emit `watch.completed` `{ runId, verdict, pageSent }`
  - REST `POST /api/mutes` handler → emit `mute.created` `{ fingerprint }`
  - REST `DELETE /api/mutes/:id` → emit `mute.deleted` `{ fingerprint }`
  - `upsertFinding` → emit `finding.upserted` `{ fingerprint, state }`, **debounced over a 5-second window during agent runs** to avoid event storms (the listener gets one collapsed event per fingerprint per window).
- New route `GET /api/events` in `apps/agent/src/api/events/server.ts`:
  - Bearer-gated like every other API surface.
  - Hijacks the Fastify reply, sets `content-type: text/event-stream`, writes a heartbeat comment every 25 seconds to keep proxies from idling out the connection.
  - Subscribes to the bus, writes each event as `event: <type>\ndata: <json>\n\n`.
  - On client disconnect (`reply.raw.on('close')`), unsubscribes and removes the listener.

### Dashboard client side

- `src/lib/sse.ts` — `useIrisEvents()` hook that opens an `EventSource('/api/events')`.
- The dashboard's `/api/events` route handler opens its own `EventSource('https://iris.example.com/api/events', { headers: { Authorization: 'Bearer …' } })` and pipes events through to the client. Bearer never reaches the browser.
- In `app/layout.tsx`'s root client component, on each event, invalidate the relevant TanStack Query keys.
- **Reconnection**: `EventSource` auto-reconnects. On reconnect, dashboard force-refetches all open queries (no Last-Event-ID replay in v1; we accept "missed events while disconnected → refetch on reconnect").

### Why SSE not WebSocket

Server → client only — we don't need bidirectional real-time. Mutes go via POST, not over the same channel. SSE has built-in reconnection, simpler proxy story, and works through standard HTTP. WebSocket would buy bidirectional features we have no use case for.

## PWA layer

### Manifest

- `name`: "Watchfire-Dashboard"
- `short_name`: "Watchfire"
- `theme_color`: dark (matches Telegram aesthetic — exact value pinned during implementation)
- `display`: `standalone`
- `start_url`: `/`
- `icons`: 192×192, 512×512, maskable. Operator-supplied during implementation; placeholder icons in v1.

### Service worker

Hand-rolled (`public/sw.js`). Strategies:

- **Network-first** for `/api/*` — always try fresh, fall back to last cached response if offline.
- **Cache-first** for static assets (`_next/static/*`, fonts, manifest, icons).
- **Stale-while-revalidate** for the overview shell — instant load from cache, then update in background.

`next-pwa` is intentionally **not** used. As of writing, the package's Next 15 App Router story is fragile and the maintenance has slowed. A hand-rolled SW is ~200 LOC and gives precise control.

### Offline behaviour

- Top-of-screen banner: `📵 Offline — last update X ago` when `navigator.onLine === false` or repeated fetch failures.
- Mute toggles disabled with a tooltip explaining why.
- Read-only views work from cache; writes block.

### Install prompt

Capture `beforeinstallprompt`, surface a small "Install app" button in the overview footer on supported browsers. iOS Safari does not fire this event — operator installs via the Share menu manually (documented in the dashboard's `docs/`).

## Observability

- **Server logs**: structured JSON to stdout. App Service Log Stream picks up; OpenTelemetry collector forwards to OpenObserve, stream `iris-dashboard.*` (separate from `iris.*`).
- **Request correlation**: dashboard generates a `traceparent` per incoming request, forwards it to Watchfire in an `x-trace-id` header. Both sides log the same id. Cross-stream queries in OpenObserve give a complete request flow.
- **Errors**: server-side errors logged with stack; user-facing pages render a generic error screen with a "copy error code" button (the trace id).
- **No App Insights** — OpenObserve is the single observability backend across the ACME stack.

## Testing

- **Vitest** for unit + component tests. Test files alongside code (`Button.test.tsx` next to `Button.tsx`).
- **Playwright** for E2E in `tests/e2e/`. Specs cover: sign-in flow, finding detail render, mute toggle round-trip, SSE event reception, offline banner appearance.
- **MSW** to mock Watchfire in component tests — intercept `fetch('/api/iris/*')` and return canned DTOs from fixtures.
- **No visual regression testing in v1.** Add when designs stabilize.

## Security

- **No CORS** — preserved from spec 11. Dashboard's BFF is server-side; no Origin header from a third-party browser ever reaches Watchfire.
- **Bearer token never leaves App Service env.** BFF route handlers attach it server-side; client code never sees it.
- **Single user** enforced at AAD layer (`assignmentRequired: true`, only operator's user object ID assigned).
- **Session cookies**: HttpOnly, Secure, SameSite=Lax, `__Host-` prefixed.
- **CSP**: strict default-src self; explicit allow for the AAD endpoints during sign-in. Pinned during implementation.
- **No client-side telemetry** that hits a third-party endpoint. All metrics go to OpenObserve via the BFF.

## Module layout

```
apps/dashboard/
  src/
    app/
      layout.tsx                   # root layout, AppShell, SSE hook mount
      page.tsx                     # overview (RSC)
      findings/
        page.tsx                   # list (RSC + client filters)
        [short_id]/page.tsx        # detail (RSC)
      runs/
        page.tsx
        [id]/page.tsx
      mutes/page.tsx
      search/page.tsx
      api/
        auth/[...nextauth]/route.ts
        iris/[...path]/route.ts    # generic BFF proxy with bearer injection
        events/route.ts            # SSE proxy
    components/
      ui/                          # shadcn-style atoms (Button, Card, Pill, Skeleton)
      findings/                    # FindingCard, FindingDetail, FilterChips
      overview/                    # StatusHeader, CostSparkline, AdapterHealthRow
      runs/                        # RunRow, RunDetail
      layout/                      # AppShell, BottomNav, OfflineBanner
    lib/
      iris.ts                      # server-side Watchfire client (bearer-injecting fetch)
      auth.ts                      # Auth.js config (Entra provider, allowlist)
      schemas.ts                   # zod schemas mirroring Watchfire DTOs
      sse.ts                       # useIrisEvents() client hook
      queryKeys.ts                 # TanStack Query key factory
    middleware.ts                  # auth guard for all non-/api/auth/* routes
  tests/
    e2e/                           # Playwright specs
  ci/
    azure-pipelines.yml            # build + deploy via AzureWebApp@1
  docs/                            # architectural notes, ADRs
  public/
    manifest.json
    icons/
    sw.js                          # service worker
  next.config.mjs                  # output: 'standalone'; experimental.typedRoutes: true
  tailwind.config.ts
  vitest.config.ts
  playwright.config.ts
  package.json
  tsconfig.json
  README.md
```

## Tech stack

- Next.js latest stable, App Router
- TypeScript strict
- Auth.js v5 (the `next-auth` package on Next.js, with the `MicrosoftEntraID` provider from `@auth/core/providers/microsoft-entra-id`)
- Tailwind CSS 4
- TanStack Query
- Recharts (cost trend chart)
- shadcn/ui (component primitives)
- Vitest + Playwright + MSW
- zod (DTO schemas)

## Build order

Implementation lands **after** spec 11's amendments are committed. The dashboard depends on endpoints that don't yet exist; building the dashboard first would be theatre. Sequence:

1. Spec 11 amendments PR (this spec's §Spec 11 dependencies → updates in spec 11 itself).
2. Watchfire implementation PR adds the new endpoints + MCP tools + SSE bus + write paths to `apps/agent/src/api/`.
3. your-iac-repo PR adds `solutions/iris-dashboard/` (Terraform, secrets template, deploy.sh) + `modules/azure/aad_app_registration`. Run `./deploy.sh terraform` once to provision empty App Service + AAD app.
4. Watchfire-Dashboard repo created on Azure DevOps with the scaffolding + first deploy.
5. Iterate page by page — overview first, then findings, runs, mutes, search.

Implementation estimate: ~2–3 weeks part-time. The spec 11 expansion is ~1 week; the dashboard itself is ~1–2 weeks because each page is small but mobile UX takes iteration.

## Open questions

- **Icons + theme color**: TBD during implementation. Operator supplies a logo or we use a placeholder.
- **Cost-trend timezone**: daily buckets are computed on the Watchfire server in UTC. The dashboard renders bucket labels in `Europe/Berlin`. Cosmetic; no bucket boundaries shift.
- **Run transcript display**: spec 09 says transcripts are JSONL files on disk, not in the DB. Surfacing them in the dashboard would require a new endpoint (`GET /api/runs/:id/transcript`) that streams the file. Out of scope for v1; defer until operator misses it.
- **Push notifications**: out of scope. Telegram already does push. If the dashboard ever needs PWA push, it's a substantial spec change (VAPID keys, subscription endpoint, server-side push).
- **Service-principal lifecycle for Azure DevOps deploy**: Terraform creates the AAD app for sign-in; Azure DevOps's deploy SP is a separate principal. Probably created manually in the Azure DevOps project settings during bootstrap. Document the procedure in your-iac-repo's `solutions/iris-dashboard/README.md`.
