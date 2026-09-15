# Watchfire — External surfaces (MCP + REST)

## Purpose

Two external surfaces over the Watchfire findings DB, sharing one auth scope, one DTO set, and one set of resolution rules:

- **MCP** — for Claude Code sessions running on the operator's laptop. Originating motivation: the operator sees a finding in the nightly digest on Telegram, opens a Claude session in the affected repo (your-iac-repo, a tenant's app, an ad-hoc shell), and wants to say "look up Watchfire finding `9b9896`" rather than copy-pasting title + evidence + likely_cause out of Telegram.
- **REST** — for the Watchfire-Dashboard (separate App Service, see `12-dashboard.md`) and any future server-to-server consumer.

Both surfaces are operator-scoped read views onto memory, plus a narrow set of Watchfire-state writes (mutes today, future ad-hoc run triggers tomorrow). They differ only in transport — the underlying queries, DTOs, error semantics, and write paths are identical.

This spec owns:

- The two MCP tools and the two REST endpoints, with their argument / response shapes
- Auth (bearer token, shared across both surfaces)
- Mounting decision (in-process vs sidecar)
- Module layout under `apps/agent/src/api/`
- Audit logging
- Error model

This spec does **not** own: the `findings` schema or the underlying queries (06), digest rendering (07), `mutes` (06 + 10), token storage / rotation (01 §Secret management), the dashboard itself (future spec), or hosting (01 §Hosting).

## Non-goals

- **Mutating tenant infrastructure.** The global report-only invariant is preserved. Every endpoint touches Watchfire-internal state only (memory rows, mute records); none reach tenant infra. Adding any endpoint that *would* mutate tenant infra is a breaking spec change, not a casual feature.
- **Multi-operator / multi-token.** One token gates both surfaces, one trust boundary. Splitting tokens or roles is unnecessary at this scale.
- **Replacing Telegram.** The digest is still the primary push surface. These surfaces exist to bridge "I saw this in Telegram, now I'm in a coding session" and to back the dashboard — not to be the channel where Watchfire speaks first.
- **Browser-direct calls.** REST is consumed server-to-server (Next.js route handlers / server actions). No CORS in v1. If a future browser client needs direct access, it earns its own token scope.

## Mounting

In-process, mounted on the existing HTTP server (the same Node process described in `01-architecture.md` §Components). Both the MCP handler and the REST handlers share the DB connection, the tenant registry, and the resource graph with the rest of `watchfire-core`. No sidecar.

Why not a sidecar binary opening the DB read-only:

- The HTTP server already exists; more routes are cheaper than a second container.
- Sharing the DB connection pool avoids a second consumer with its own auth and connection budget.
- The trust boundary is identical either way (network-exposed, token-gated). Process isolation buys nothing here because the read surface IS the API.

**Mount points** (paths only — the host and TLS termination are owned by `01-architecture.md §Hosting`):

- `/mcp` — Streamable HTTP MCP transport.
- `/api/findings` and `/api/findings/:id` — REST.
- `/health` — unchanged, no auth.

**MCP transport** is Streamable HTTP. Stdio is excluded because the DB does not live on the consuming machine, and we do not want to ship the DB or build an SSH bridge.

## Auth

Single bearer token, env var `WATCHFIRE_API_TOKEN`, generated as a 32-byte hex string at bootstrap. The token gates **both** the MCP and REST surfaces — one secret, one trust scope, one rotation surface. Storage and rotation procedure are owned by `01-architecture.md §Secret management`.

Verification at every request (MCP and REST alike):

- Missing or malformed `Authorization: Bearer <token>` header → `401 Unauthorized`.
- Token mismatch → `401 Unauthorized`. Do not distinguish missing-vs-wrong in the response body — a generic `unauthorized` keeps the surface boring.
- Constant-time compare (`crypto.timingSafeEqual`). Token length is fixed, so length-leak through compare-time is moot, but using the safe compare avoids a code-review eyebrow.

No per-IP rate limiting in v1: one operator + one dashboard, low single-digit RPS. If the token ever leaks, the right answer is rotation, not throttling.

After rotation the operator updates the token in:

1. The dashboard App Service's app settings (so the dashboard's server-side fetcher picks it up at next deploy / restart).
2. Their local Claude Code MCP config (e.g. `claude mcp add watchfire … --header "Authorization: Bearer <new>" --scope user --force`).

The exact rotation procedure (where the secret lives, how it's edited, what re-deploy steps it triggers) is `01 §Secret management`'s problem, not this spec's.

## Tools

Each MCP tool maps 1:1 to a REST endpoint — same args, same DTO, same errors. The two surfaces share the underlying handler. The detail prose here covers the original two tools (`get_finding`, `recent_findings`); the rest are documented compactly under `### Additional tools` and lean on `## REST endpoints` for the full DTO contract.

### `get_finding`

Resolve a finding by short ID or full fingerprint and return its full context.

**Arguments:**

```ts
{
  id: string;   // 6+ hex chars; either a short_id prefix or the full 64-char fingerprint
}
```

**Resolution rules** (mirror `/mute` ID resolution from 10 §Short-ID resolution):

- `id` must match `^[0-9a-f]{6,64}$` — otherwise `InvalidArgument`.
- Lookup runs the same SQL shape as the `/mute` resolver (06 §Mutes "Resolve a short-id prefix"): `SELECT DISTINCT fingerprint FROM findings WHERE fingerprint LIKE ? || '%'`.
- 0 candidates → `NotFound`.
- 1 candidate → return finding.
- >1 candidates → `Ambiguous`, payload includes a candidate list (`short_id`, `resource_id`, `issue_class`, `title`, `state`) so the operator can disambiguate by re-issuing with more hex.

**Response shape** on success:

```ts
{
  short_id: string;            // first 6 hex of fingerprint
  fingerprint: string;         // full 64-char hex
  resource_id: string;         // canonical
  issue_class: IssueClass;     // see 06
  state: 'new' | 'ongoing' | 'resolved';
  severity: 'info' | 'warn' | 'critical';
  prev_severity: 'info' | 'warn' | 'critical' | null;
  escalating: boolean;         // computed per 06 §Lifecycle
  muted: boolean;              // active mute lookup at request time
  title: string;
  evidence: string;
  likely_cause: string | null;
  affects: string[];           // tenant ids; expanded from apps/agent/config/resources.yaml at request time, same logic as the digest
  first_seen_at: string;       // ISO 8601
  last_seen_at: string;
  resolved_at: string | null;
  age_days: number;            // floor((now − first_seen_at) / 1 day)
  run_count: number;
  first_run_id: number;
  last_run_id: number;
}
```

Field semantics match `findings` columns 1:1 except for the five computed fields (`short_id`, `escalating`, `muted`, `affects`, `age_days`), which are derived at response time — never persisted in `findings`. Computation lives in `apps/agent/src/api/shared/format.ts` and is the same logic the digest renderer uses (07).

`get_finding` returns muted findings unchanged — the operator looking up an ID has obviously seen it referenced and needs the body. The `muted: true` flag tells the consuming session "yes, this is acknowledged; don't re-page the operator about it."

`get_finding` does not include observations. If the consuming Claude session needs trend data, that is a future tool, not this one. Most "look up the finding" flows do not need it.

### `recent_findings`

List currently-relevant findings, ordered most-recent first.

**Arguments:**

```ts
{
  limit?: number;            // default 20, max 50
  include_resolved?: boolean; // default false
  include_muted?: boolean;    // default false
}
```

**Selection:**

- `state IN ('new', 'ongoing')` always included.
- `include_resolved=true` widens to `OR (state = 'resolved' AND resolved_at > datetime('now', '-7 days'))`. Window matches the digest's recently-resolved cutoff (07).
- `include_muted=false` (default) excludes findings whose fingerprint has an active mute. `include_muted=true` includes them with `muted: true` set on each row. Default-false matches the digest's render-time mute filter — the common "what's Watchfire worried about?" question excludes acknowledged noise.
- Ordered by `last_seen_at DESC` then by severity rank (`critical` > `warn` > `info`) as a tiebreaker. Severity is stored as a string, so the ranking is expressed via a `CASE` expression at query time, not by lexicographic `DESC` (which would produce `warn`, `info`, `critical` and is wrong).
- Hard cap `limit ≤ 50`. Out-of-range → `InvalidArgument`. The hard cap is for response-size sanity, not auth.

**Response shape:**

```ts
{
  findings: Array<{
    short_id: string;
    fingerprint: string;
    resource_id: string;
    issue_class: IssueClass;
    state: 'new' | 'ongoing' | 'resolved';
    severity: 'info' | 'warn' | 'critical';
    escalating: boolean;
    muted: boolean;
    title: string;
    affects: string[];
    last_seen_at: string;
    run_count: number;
  }>;
  total: number;     // count of findings matching the filter, before limit
  limit: number;     // effective limit (echoed for clarity)
}
```

Compact rows by design: no `evidence`, no `likely_cause`, no run IDs. Consumers that want the full body call `get_finding` with the `short_id`. Keeping `recent_findings` compact means the consuming session can ingest 20+ rows without burning context on bodies it might not need.

### Additional tools

Added as the dashboard (spec 12) needed them. Each is a thin handler over an existing memory-layer function; full DTO shapes live under §REST endpoints.

**Reads:**

- **`list_runs`** — args `{ type?: 'nightly'|'watch', limit?: number = 20 }`. Returns `RunSummaryDto[]` (status, started_at, finding_count, turn_count, cost_eur, transcript_path).
- **`get_run`** — args `{ id: number }`. Returns full `RunDto` for one run.
- **`get_run_findings`** — args `{ id: number }`. Returns `FindingSummaryDto[]` for findings touched in this run (created or refreshed). Implementation: `SELECT … WHERE last_run_id = ? OR first_run_id = ?`.
- **`search_findings`** — args `{ q: string, limit?: number = 20 }`. LIKE-search across `title` + `resource_id`, case-insensitive. Returns `FindingSummaryDto[]`. Search scope is deliberately narrow — see §Decisions worth remembering.
- **`list_mutes`** — no args. Returns `ActiveMute[]` (already in `apps/agent/src/memory/mutes.ts::listActiveMutes`).
- **`cost_window`** — args `{ days?: number = 30 }`. Returns `{ total_eur, by_type: { nightly, watch }, daily_buckets: Array<{ date: string; eur: number }> }`. Cheap aggregation at our scale.
- **`adapter_health`** — no args. Returns `Array<{ source: string; emits_observations: boolean; last_observed_at: string | null; observation_count_24h: number }>`. Derived from `observations.source`.

  `emits_observations` distinguishes two states a bare `last_observed_at: null` conflates: an adapter that *should* be reporting telemetry and has gone quiet (a real problem) versus one that never reports any (working as designed — see 03 §Observation emission). Consumers render the first as stale and the second as "no telemetry"; only the first is alarming. The flag is derived from the adapter registry, not from the data, so a newly-added emitting adapter reads as stale from its first run rather than silently looking fine.

**Writes (Watchfire-state only — no infra mutation):**

- **`mute_finding`** — args `{ id: string, duration?: string, reason?: string }`. Resolves `id` via shared resolver (min 6 hex), parses `duration` per spec 10 (`30m`, `2h`, `7d`, etc.; absent = indefinite), inserts into `mutes` table. Returns `{ fingerprint, expires_at: string | null }`. Emits `mute.created` on the event bus.
- **`unmute_finding`** — args `{ id: string }`. Resolves `id`, deletes all rows for that fingerprint from `mutes`. Returns `{ fingerprint, deleted_count: number }`. Emits `mute.deleted`.

**Still not in scope:**

- **`get_observations(...)`** — observations are a debugging surface, not a dashboard concern. Not added.
- **`trigger_run(...)`** — ad-hoc run triggers are an obvious future write tool (operator wants to investigate something *now*). Out of scope until the dashboard has a real flow that needs it; spec 12 doesn't.

## REST endpoints

The endpoints mirror the MCP tools 1:1 — same DTOs, same resolution rules, same error semantics, plain HTTP transport. The two original endpoints (`GET /api/findings/:id`, `GET /api/findings`) are documented in detail; the additions are listed compactly afterward.

### `GET /api/findings/:id`

Equivalent of `get_finding`.

- `:id` follows the same `^[0-9a-f]{6,64}$` rule. Failure → `400 Bad Request` with `{error: "invalid_argument", detail}`.
- Resolution rules identical: 0 matches → `404`, 1 match → `200`, >1 matches → `409 Conflict` with the candidate list in the body.
- Response body on success: same DTO as `get_finding` (single object, not wrapped).

### `GET /api/findings`

Equivalent of `recent_findings`.

- Query params:
  - `limit` (number, default 20, max 50)
  - `include_resolved` (`true` | `false`, default `false`)
  - `include_muted` (`true` | `false`, default `false`)
- Out-of-range / unparseable param → `400 Bad Request`.
- Response body on success: same DTO as `recent_findings` (`{findings, total, limit}`).

### Additional read endpoints

| Endpoint | Body / response | Maps to tool |
|---|---|---|
| `GET /api/runs?type=&limit=` | `RunSummaryDto[]` (status, started_at, finding_count, turn_count, cost_eur). Default limit 20, max 50. | `list_runs` |
| `GET /api/runs/:id` | Full `RunDto` (every column from `runs`). 404 on unknown id. | `get_run` |
| `GET /api/runs/:id/findings` | `FindingSummaryDto[]` for findings created or refreshed in this run. | `get_run_findings` |
| `GET /api/findings/search?q=&limit=` | `FindingSummaryDto[]` matching `title LIKE %q% OR resource_id LIKE %q%`, case-insensitive. Default limit 20, max 50. | `search_findings` |
| `GET /api/mutes` | `ActiveMute[]` — uses `listActiveMutes`. | `list_mutes` |
| `GET /api/cost-window?days=` | `{ total_eur, by_type: {nightly, watch}, daily_buckets: Array<{date, eur}> }`. Default 30 days, max 90. | `cost_window` |
| `GET /api/adapters/health` | `Array<{ source, emits_observations, last_observed_at, observation_count_24h }>`. Adapters that never emit report `emits_observations: false`; render those as "no telemetry", not stale. | `adapter_health` |

All gated by the same bearer. All emit one `watchfire.api.request` audit event per call (per §Audit).

### Write endpoints (Watchfire-state only)

The report-only invariant for **tenant infrastructure** is preserved. These endpoints write to Watchfire's own state — the `mutes` table — never to any tenant resource.

| Endpoint | Body | Response | Maps to tool |
|---|---|---|---|
| `POST /api/mutes` | `{ id: string, duration?: string, reason?: string }` | `201` with `{ fingerprint, expires_at }`. Errors: `400 invalid_argument` (id format, bad duration), `404 not_found`, `409 ambiguous`, `401 unauthorized`. | `mute_finding` |
| `DELETE /api/mutes/:id` | (none) | `200` with `{ fingerprint, deleted_count }`. Errors: `400`, `404`, `409`, `401`. | `unmute_finding` |

Implementation calls into `apps/agent/src/memory/mutes.ts::insertMute` and `deleteMutesByFingerprint` — both already exist for the Telegram bot's `/mute` and `/unmute` commands. The HTTP handlers are thin wrappers that resolve the short-id, validate args, run the memory call, and emit a `mute.created` / `mute.deleted` event onto the bus (see §Streaming surface).

`duration` parsing follows spec 10 §Mute duration grammar (`30m`, `2h`, `7d`, etc.; absent → indefinite).

## Streaming surface

`GET /api/events` — Server-Sent Events stream. The dashboard subscribes; Watchfire pushes events when state changes.

### Why SSE not WebSocket

Server → client only — we don't need bidirectional real-time. Mutes go via POST, not over the same channel. SSE has built-in reconnection in `EventSource`, simpler proxy story, and works through standard HTTP. WebSocket would buy bidirectional features we have no use case for.

### Event types

```
event: nightly.completed
data: {"runId": 1234, "status": "success"}

event: watch.completed
data: {"runId": 1235, "verdict": "page", "pageSent": true}

event: mute.created
data: {"fingerprint": "abc...def"}

event: mute.deleted
data: {"fingerprint": "abc...def"}

event: finding.upserted
data: {"fingerprint": "abc...def", "state": "ongoing"}
```

`finding.upserted` is **debounced over a 5-second window** during agent runs to avoid event storms. The listener gets one collapsed event per fingerprint per window — sufficient for "refresh the relevant query".

### Bus implementation

A process-local `EventEmitter` in `apps/agent/src/api/events/bus.ts`. Singleton; emitters are wired in:

- `runNightly()` end → `nightly.completed`
- `runWatch()` end → `watch.completed`
- `POST /api/mutes` handler → `mute.created`
- `DELETE /api/mutes/:id` → `mute.deleted`
- `upsertFinding` (debounced) → `finding.upserted`

### Connection model

The Fastify route hijacks the reply, sets `content-type: text/event-stream`, writes a heartbeat comment (`: keepalive\n\n`) every 25 seconds to keep proxies from idling out the connection. On client disconnect (`reply.raw.on('close')`), the route unsubscribes from the bus and removes the listener. Multi-client fanout is supported (the operator might have the dashboard open in two tabs); the bus is a Node `EventEmitter` so per-listener delivery is built-in.

No Last-Event-ID replay in v1. On reconnect, clients refetch all open queries. Acceptable: missed events become "stale data window of <reconnect-delay seconds>", and the polling fallback in the dashboard's TanStack Query layer covers anything missed.

### Why not separate it from MCP into its own spec

Both surfaces are thin adapters over the same resolver and the same DTOs. The auth, the error model, the audit log, and the module boundary are shared. Splitting would force readers to cross-reference for every shared decision — net more friction, no isolation benefit. The streaming surface is added inline because it shares the same bearer + audit conventions.

## Errors

Both surfaces share one error model, transported differently.

| Internal code     | MCP code         | HTTP status | Trigger                                                 | Body                                                                                              |
| ----------------- | ---------------- | ----------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `unauthorized`    | `Unauthorized`   | `401`       | Missing / malformed / wrong bearer token                | `{ error: "unauthorized" }`                                                                       |
| `not_found`       | `NotFound`       | `404`       | `get_finding` / `GET /api/findings/:id` matched 0 rows  | `{ error: "not_found", id }`                                                                      |
| `ambiguous`       | `Ambiguous`      | `409`       | id prefix matched >1 rows                               | `{ error: "ambiguous", candidates: Array<{ short_id, resource_id, issue_class, title, state }> }` |
| `invalid_argument`| `InvalidArgument`| `400`       | `id` regex fails, `limit` out of range, bad query param | `{ error: "invalid_argument", detail: string }`                                                   |
| `internal`        | `Internal`       | `500`       | DB error, unexpected exception                          | `{ error: "internal" }` — full detail in server logs only                                         |

Token values are never echoed in errors, never logged, never included in audit events. Bodies are intentionally minimal — neither Claude sessions nor the dashboard need stack traces.

## Audit

Every MCP tool invocation and every REST request emits one structured log event to OpenObserve, in the same `watchfire.*` stream as the rest of the process:

```json
{
  "event": "watchfire.api.request",
  "surface": "mcp" | "rest",
  "operation": "get_finding" | "recent_findings",
  "args": { /* validated args, sanitized */ },
  "result": "ok" | "not_found" | "ambiguous" | "invalid_argument" | "unauthorized" | "internal",
  "result_count": number | null,
  "latency_ms": number,
  "ts": "<ISO 8601>"
}
```

Notes:

- `surface` distinguishes MCP and REST so dashboards can split traffic by consumer without parsing operation names.
- `operation` is the logical operation, normalized across surfaces: `GET /api/findings/:id` and MCP `get_finding` both log as `get_finding`. This keeps audit dashboards simple.
- `args` echoes only validated, parsed arguments (e.g. the resolved `id` string, the effective `limit`). No headers, no token, no raw body, no query string.
- `unauthorized` requests still log an event, with `operation: null` and `args: null`, so token-failure storms are visible in OO.
- No `runs` row is inserted for these requests. They are not "runs" — there is no agent, no turn budget, no transcript. Logging in OO is sufficient observability.

## Module layout

```
apps/agent/src/api/
  shared/
    auth.ts            # bearer token verification (timingSafeEqual); used by both surfaces
    format.ts          # short_id, age_days, affects expansion, escalating computation
    resolve-id.ts      # the prefix-resolution rule (shared with /mute in 10)
    audit.ts           # watchfire.api.request emitter
    errors.ts          # internal error codes; transport-level wrappers live in mcp/ and rest/
    types.ts           # DTOs for both surfaces
    duration.ts        # parse mute duration ("30m" / "2h" / "7d"); shared with bot/duration
  events/
    bus.ts             # process-local EventEmitter singleton; spec 11 §Streaming surface
    server.ts          # GET /api/events SSE handler (Fastify reply.hijack)
    debounce.ts        # 5s coalescing for finding.upserted
  mcp/
    server.ts          # mounts the Streamable-HTTP MCP transport; registers all tools
    tools/
      get-finding.ts
      recent-findings.ts
      list-runs.ts
      get-run.ts
      get-run-findings.ts
      search-findings.ts
      list-mutes.ts
      mute-finding.ts
      unmute-finding.ts
      cost-window.ts
      adapter-health.ts
  rest/
    findings.ts        # GET /api/findings, GET /api/findings/:id, GET /api/findings/search
    runs.ts            # GET /api/runs, GET /api/runs/:id, GET /api/runs/:id/findings
    mutes.ts           # GET /api/mutes, POST /api/mutes, DELETE /api/mutes/:id
    cost.ts            # GET /api/cost-window
    adapters.ts        # GET /api/adapters/health
```

Conventions match the rest of the codebase (CLAUDE.md): one module per concern, pure functions over `apps/agent/src/memory/*`, side effects only at the surface entry points (`mcp/server.ts`, `rest/findings.ts`). Each module pairs with a `*.test.ts` (Vitest, seeded with fixture findings).

`shared/format.ts` is shared with the digest renderer (07). If duplication appears between `apps/agent/src/api/shared/format.ts` and `apps/agent/src/render/*` during implementation, the shared bit lifts into a top-level `apps/agent/src/format/` and both call into it. Implementation-time housekeeping, not a spec decision.

`shared/resolve-id.ts` is also called by the `/mute` command handler in 10 — same rule, same source. The resolver is **not** a memory function despite touching the DB; it's a surface-shared utility because the resolution rules (regex, ambiguous handling, candidate-list shape) belong to the external contract, not to memory's storage model.

## Sensitivity

Findings can contain log lines and lightly-redacted infra context (hostnames, error fragments). Today this content already flows to:

- Telegram (operator-only chat)
- The findings DB (operator-controlled)
- Anthropic during nightly + watch agent runs

These surfaces add two paths:

- **MCP** — the operator's local Claude Code session, which itself forwards finding bodies to Anthropic when the consuming session reasons about them. Trust boundary is the same as the existing nightly path; Anthropic already sees evidence content. No new exfiltration vector beyond what the operator chooses to invoke.
- **REST** — the dashboard's server side, which renders finding content into the operator's browser. No third party involved on the read path; sensitivity is bounded by who can authenticate to the dashboard. Dashboard auth is a separate spec's concern.

Operator responsibility: do not configure the MCP into a Claude session running on shared hardware, and do not expose the dashboard publicly without auth. Single-operator assumption is load-bearing here as elsewhere.

## Implementation status

**v1 — shipped 2026-05-04.** `GET /api/findings`, `GET /api/findings/:id`, `POST /mcp` (with `get_finding` and `recent_findings`) live on production behind `WATCHFIRE_API_TOKEN`. See `git log apps/agent/src/api/` for the trail.

**v2 — in flight (driven by spec 12).** Adds the additional read endpoints (runs, search, cost-window, adapter-health), the write endpoints (`POST/DELETE /api/mutes`), the streaming surface (`GET /api/events`), and the matching MCP tools. Unshipped at time of writing; lands in lockstep with the Watchfire-Dashboard implementation per `12-dashboard.md` §Build order.

The dashboard that consumes the REST surface is a separate spec, separate repo, separate App Service, separate timeline.

## Decisions worth remembering

- **`affects` is expanded at request time** from current `apps/agent/config/resources.yaml`, not snapshotted at finding ingest. Trade-off: a resolved finding may report different `affects` than it did when it first fired, if the resource graph changed in between. Spec 06 already chose this for the digest; the API follows so consumers see one consistent expansion behaviour.
- **No CORS, no browser-direct access.** REST is consumed server-to-server only. A future browser client (e.g. a different dashboard) earns its own token scope and CORS rules — out of scope for this spec.
- **Writes are Watchfire-state only, never tenant infra.** The report-only invariant for tenant infrastructure is preserved by *construction*: every write endpoint touches one of the Watchfire tables (`mutes` today, future state tables tomorrow). Any future write that would reach a tenant resource is a hard veto, not a spec discussion.
- **SSE for live updates, not WebSocket.** Server → client only is the actual need; WebSocket would buy nothing and complicate the proxy story. Re-litigated in §Streaming surface.

## Open questions

- **Telegram-side affordance.** Should the digest render lines like `🔍 /lookup 9b9896` next to each finding, copy-paste into a Claude session? Probably overkill — the short_id alone is what the operator needs, and they can paste it into whatever phrase they want ("look up Watchfire 9b9896" / "check finding 9b9896" / etc). Defer until usage tells us otherwise.
- **Pagination for `recent_findings` / `GET /api/findings`.** Hard cap 50, no cursor. If 50 is ever insufficient, that is a digest problem first, not an API problem — Watchfire shouldn't have 50+ active findings. Revisit if the cap actually hits.
