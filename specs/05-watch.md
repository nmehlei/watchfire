# Watchfire — Watch

## Purpose

Watch is the real-time counterpart to the nightly sweep. When an upstream system fires a webhook (OpenObserve alert today; Azure Monitor, Stripe, etc. tomorrow), Watchfire spins up a short, triage-focused agent run and decides whether to 🚨 page the operator, defer the signal to the next nightly digest, or drop it.

This spec owns:

- Webhook intake, signature verification, and payload parsing
- Concurrency (multiple webhooks in flight)
- The triage prompt shape (what differs from nightly)
- Turn & wallclock budgets
- The verdict protocol (`page` / `defer` / `drop`) and how rate-limiting consumes it
- Suppression aggregation into the nightly digest

This spec does **not** own: safety hook (08), memory schema (06 — with one small proposed extension, see below), digest rendering (07), deploy / rotation / Cloudflare Tunnel setup (09).

## Trigger

Three webhook endpoints, per `01-architecture.md`:

- `POST /webhook/openobserve` — primary source. OO alerts fire here.
- `POST /webhook/telegram` — operator command surface (mute / unmute / mutes / help). Does NOT spawn an agent run; dispatches synchronously into the bot command handler. See `specs/10-telegram-control.md` for command semantics.
- `POST /webhook/generic` — reserved for future sources. Schema defined when the first concrete user lands; no-op until then.

All three mount on the same HTTP server that exposes `/health` on `:8080`. No other endpoints exist in v1.

Watch has **no catch-up mechanism**. If Watchfire is down when a webhook fires, the alert is lost — OpenObserve's retry window is short and we do not persist pre-arrival webhooks. The nightly sweep is the backstop: anything a lost webhook would have surfaced gets caught within 24h. Documented as a known limitation; paired with the healthchecks.io dead-man's-switch in 01.

## Intake

### OpenObserve webhook

Expected shape (subset used — OO payloads carry more, we only parse what triage needs):

```json
{
  "alert_name": "…",
  "stream": "acme",
  "severity": "critical",
  "fired_at": "2026-04-20T02:14:07Z",
  "description": "…",
  "labels": { "service": "api", "env": "prod", "…": "…" },
  "evaluation": { "query": "…", "value": 0.42, "threshold": 0.3 }
}
```

The `stream` field maps to a tenant via `apps/agent/config/tenants.yaml`'s `observability.stream → tenant.id` lookup. Alerts that don't match a known stream are dropped with a 400 and a log line (never silently).

### Signature verification

OpenObserve will sign webhooks when configured; v1 ships with verification code but gates it on environment:

- If `OPENOBSERVE_WEBHOOK_SECRET` is set, verify the signature on every request; reject mismatches with 401.
- If the secret is unset, accept all requests (dev / not-yet-configured mode) and log a warn on every intake: `watch: webhook signature not verified (no secret configured)`.
- `WATCHFIRE_WEBHOOK_VERIFY=false` explicitly disables verification even when the secret is set. Reserved for emergency bypass / local testing; emits a warn on every intake.

The default posture is: **verify when possible, don't block deployment on OO's signing setup for v1.** Flip to "verify always, fail closed if no secret" once OO is producing signed payloads in all environments. Tracked as an ops task in `docs/operations.md`.

### Telegram webhook

`POST /webhook/telegram` receives Telegram Bot API `Update` payloads. Spec 10 owns the command surface; this section pins only the intake mechanics.

- **Auth**: Telegram's setWebhook supports a `secret_token` echoed back in the `X-Telegram-Bot-Api-Secret-Token` request header. The intake handler compares this header against `TELEGRAM_WEBHOOK_SECRET` (constant-time compare) and responds `401` on mismatch. Loaded from `secrets.yml` at boot; required (no fallback). Without this, anyone who finds the bot's public URL could forge `Update` payloads.
- **Sender authorization**: a second layer. The handler extracts `update.message.chat.id` (and falls back to `from.id` for non-message updates) and rejects anything not in `TELEGRAM_ALLOWED_CHAT_IDS` (single-element list in v1: the operator's chat). Mismatch → 200 OK with no reply (silently ignore; no engagement with attackers who guessed the URL + secret).
- **Dispatch**: the handler does NOT enqueue into the watch agent queue. Bot commands run synchronously in the request thread (DB read/write only, no agent spin-up, sub-100ms target). Path: `index.ts` → `webhooks/telegram.ts::handle(update)` → `apps/agent/src/bot/router.ts::dispatch(message)` → command handlers in `apps/agent/src/bot/commands/`.
- **Response**: respond 200 with empty body once dispatch completes. The handler may also call `sendMessage` directly to confirm the action ("✅ Muted finding 9b9896 until 2026-04-27") — but that's a separate outbound call, not the webhook response body. Telegram does support inline replies in the response body (`{ method: "sendMessage", text: "..." }`) but we keep send and receive paths separate to share retry/error code with digest send.
- **Idempotency**: `update.update_id` is the natural deduplication key. Telegram retries on non-200; we record the last seen `update_id` per chat in memory (process-local, not DB; loss-tolerant) and ignore duplicates. Applied AFTER auth, BEFORE dispatch.

### Generic endpoint

`POST /webhook/generic` returns 501 Not Implemented in v1. Reserved so operators can configure the URL in upstream systems ahead of time without Watchfire changing its surface when the handler lands.

## Concurrency

Webhooks can arrive faster than agents can process them. Watch handles this with a bounded serial queue:

- The HTTP server accepts connections normally.
- Incoming webhooks push into an in-process queue; agent runs consume serially.
- **Max queue depth: 10.** If a webhook arrives while 10 are already queued, respond `429 Too Many Requests` with a `Retry-After: 30` header. OpenObserve retries.
- Max wallclock per agent run: 60s (see Budget). So worst-case drain time is ~10 minutes — if we're backed up further than that, something is wrong upstream.

Single-writer semantics to the DB are preserved: watch runs serialize themselves, and nightlies are gated against each other by cron (one at a time). Concurrent nightly + watch writes rely on the WAL + `BEGIN IMMEDIATE` contract in 06.

No priority queue in v1: a `critical`-severity alert queued behind five `warn`-level alerts waits its turn. If ordering by severity becomes important, it's a small queue change; flag in Open Questions.

## Model, budget, wallclock

- **Model**: `claude-haiku-4-5`, same as nightly.
- **Prompt caching**: shared stable prefix with nightly where possible (role, tool inventory, finding schema, prompt-injection framing). Alert-specific blocks are per-run and not cached (different alert every time).
- **Turn budget**: 8 turns hard cap.
  - **Turn 6** (soft warning): "2 turns left. If you have a verdict, emit it now."
  - **Turn 8**: runner rejects any tool call other than `emit-finding` and `conclude-watch`. Agent gets one final turn.
  - **Turn 9**: run terminates. If no `conclude-watch` was called, the default verdict is **`defer`** (see below).
- **Wallclock cap**: 60s from agent-start to agent-exit. If the wallclock trips while a tool call is in flight, the call is cancelled, the loop ends, and — same as budget exhaustion — the default verdict is `defer`.
- **Cost target**: ~€0.01–0.02 per watch run. With 6 pages/hour max and probably ~10 dropped/deferred runs per day under steady state, the watch share of the monthly budget stays well under €1.

Tighter budgets than nightly because triage is bounded: one alert, a few drill-downs, a verdict. Anything requiring broad sweep belongs in the nightly.

## Prompt structure

Same five stable blocks as nightly (Role, Tool Inventory, Finding Schema, Prompt-Injection Framing, plus **Triage Algorithm** instead of Sweep Algorithm), followed by watch-specific context:

```
┌─ STABLE (cached, shared with nightly where possible) ────────────────┐
│  1. Role & invariants                                                │
│  2. Tool inventory (includes conclude-watch)                         │
│  3. Finding schema + emission protocol                               │
│  4. Prompt-injection framing                                         │
│  5. Triage algorithm                                                 │
├─ PER-RUN (not cached) ───────────────────────────────────────────────┤
│  6. Alert payload (rendered compactly)                               │
│  7. Affected tenant's context (adapter list, resource subset)        │
│  8. Recent findings for that tenant (last 7 days)                    │
├─ PER-TURN (not cached) ──────────────────────────────────────────────┤
│  9. Budget warnings                                                  │
│  10. Tool call / result history                                      │
└──────────────────────────────────────────────────────────────────────┘
```

Blocks 1–4 are shared with `04-nightly.md`'s blocks 1–4 via `apps/agent/src/agent/prompts/shared.ts`. The nightly's full tenant registry and full cross-tenant resource graph are **not** loaded — Watch only sees the tenant implicated by the alert. This keeps the cached prefix smaller (faster, cheaper) and focuses the agent.

### Block 5 — Triage algorithm

Conveys:

```
You are triaging a single alert, not sweeping. Your job:

  1. Understand what the alert is saying (block 6).
  2. Drill one or two layers deep into the affected tenant (observability
     search, adapter probes).
  3. Decide whether this merits a page, should roll into the next nightly
     digest, or should be dropped as noise.
  4. Emit findings for anything concrete you identify.
  5. Call conclude-watch with your verdict and a one-sentence reason.

Budget: 8 turns. If you haven't concluded by turn 8, the default verdict
is "defer" — the operator will see it in the next nightly regardless.

Err toward "defer" over "page." A page wakes a human; defer is free.
```

### Block 6 — Alert payload

The parsed webhook body, rendered as key-value pairs. ~15–30 lines typically. Raw JSON is avoided — the agent parses prose more efficiently.

### Block 7 — Affected tenant context

One line per adapter the tenant has, one line per cross-tenant resource owned by or affecting this tenant. Does NOT include the full `resources.yaml` for other tenants.

### Block 8 — Recent findings (tenant-scoped)

Findings from memory where `resource_id` belongs to this tenant (or `tenant:<id>`) AND `last_seen_at > 7 days ago`. Same shape as nightly's block 7 but narrower. Lets the agent see "this exact alert has fired three nights running — already ongoing, probably defer."

## Tool inventory (full)

Same as nightly, plus one:

- **`Bash`** — safety-hook-gated, same as nightly.
- **`emit-finding`** — same SDK tool as nightly.
- **`conclude-watch`** — **new**, SDK-registered. Schema:
  ```ts
  interface WatchVerdict {
    verdict: 'page' | 'defer' | 'drop';
    reason: string;          // <=200 chars, one sentence
  }
  ```
  Exactly one call per run; additional calls are rejected with a synthetic tool error. If the agent never calls it, the runner records `verdict='defer'` with `reason='default: no conclusion within budget'`.
- **`correlate-deep`** — **disabled** in Watch. Triage runs are too short to justify a Sonnet escalation; if a watch genuinely needs deep correlation, `defer` is the right verdict and the nightly can use `correlate-deep`.
- All other SDK defaults — disabled, same as nightly.

## Verdict protocol

Three verdicts, three outcomes:

| Verdict  | Operator impact                                             | Stored in memory as                           |
| -------- | ----------------------------------------------------------- | --------------------------------------------- |
| `page`   | 🚨 Telegram message fires immediately (subject to rate cap) | `runs.verdict='page'`, findings upserted, `page_sent` TRUE or FALSE depending on rate cap |
| `defer`  | No immediate message; findings upserted, visible in next nightly | `runs.verdict='defer'`, `page_sent=false` |
| `drop`   | No immediate message; no findings expected (agent should have emitted nothing or only `info` findings) | `runs.verdict='drop'`, `page_sent=false` |

`runs.verdict` and `runs.page_sent` are proposed new columns on the `runs` table. This spec assumes them; a follow-up edit to `06-memory.md` lands the schema change (same pattern as `truncated` did for nightly). Shape:

```sql
ALTER TABLE runs ADD COLUMN verdict   TEXT;      -- NULL for nightly runs
ALTER TABLE runs ADD COLUMN page_sent INTEGER;   -- NULL for nightly; 0/1 for watch
```

Both NULL for `type='nightly'`. Both set for `type='watch'`, always.

## Rate limiting + suppression aggregation

Policy: **max 6 pages per hour.**

Mechanism:

1. The agent produces a verdict via `conclude-watch`.
2. If `verdict='page'`, the runner consults the page-activity-window query from `06-memory.md`:
   ```sql
   SELECT COUNT(*) FROM runs
    WHERE type='watch' AND page_sent=1
      AND started_at > datetime('now', '-1 hour');
   ```
3. If the count is `< 6`: send the 🚨 Telegram message, record `page_sent=1`.
4. If the count is `>= 6`: **suppress** the page. Record `verdict='page'`, `page_sent=0`, write `"rate-limited: already 6 pages in the last hour"` to `runs.error` (abusing the field slightly; arguably wants its own column, but reusing `error` keeps schema small and it IS a kind of anomaly the operator should notice).

Suppressed pages are **never silently dropped**. The next nightly digest aggregates them:

```sql
SELECT COUNT(*) AS suppressed_count,
       MIN(started_at) AS window_start,
       MAX(started_at) AS window_end,
       GROUP_CONCAT(DISTINCT substr(error, 1, 80)) AS reasons
  FROM runs
 WHERE type='watch'
   AND verdict='page'
   AND page_sent=0
   AND started_at > datetime('now', '-24 hours');
```

The nightly digest renders this as a header block when `suppressed_count > 0`:

```
⚠️ 4 pages were suppressed between 14:02 and 18:37 (rate-limited).
```

Format ownership belongs to `07-reporting.md`; this spec pins only the data.

The 6/hour cap is intentionally sensitive: a genuine incident that produces >6 pages/hour is one we want aggregated into the digest anyway — you don't want 20 🚨 messages in your pocket.

## Run outcomes

| Status       | Triggered by                                                  | Verdict recorded | `page_sent` | Findings kept? |
| ------------ | ------------------------------------------------------------- | ---------------- | ----------- | -------------- |
| `success`    | Agent called `conclude-watch` within budget, normal exit.      | Agent's verdict  | true/false depending on rate limit + verdict | yes |
| `truncated`  | Turn budget exhausted without `conclude-watch`.                | `defer` (default) | false       | yes |
| `error`      | Safety hard-block, model error, or intake-level failure.       | NULL             | false       | yes (partial) |
| `crashed`    | Process died mid-run; set retroactively on startup.            | NULL             | false       | yes (partial) |

Watch runs never trigger the resolution sweep — that's nightly-only (see 06). Findings emitted during watch upsert normally and refresh `last_seen_at`.

The wallclock cap (60s) maps to `status='truncated'` if it trips. An in-flight tool call is cancelled; whatever the agent had emitted so far is kept.

## Error handling (during the triage loop)

- **Adapter failure / timeout**: same as nightly (08 + 04). Agent sees the stderr / timeout message, decides.
- **Safety hard-block**: `status='error'`, loop terminates. No verdict recorded.
- **Safety soft-block**: agent gets the hint, continues within budget.
- **Model error**: retried once with 2s backoff (tighter than nightly's two-attempt with exponential — watch is time-sensitive). Still failing → `status='error'`.
- **Webhook parse failure** (bad JSON, unknown tenant stream): respond 400 before starting an agent run. Log the failure. No `runs` row created.
- **No verdict before budget/wallclock**: default verdict `defer`, `status='truncated'`.

## Post-run pipeline

1. Finalize the `runs` row: `completed_at`, `status`, `verdict`, `page_sent`, `finding_count`, `tokens_{in,out,cached}`, `cost_eur`, `transcript_path`, `error` (if suppressed or errored).
2. If `verdict='page'` AND rate-limit check passes: send Telegram 🚨 (format per `07-reporting.md`).
3. Archive transcript to `/var/lib/watchfire/transcripts/<run_id>.jsonl`.

No retention sweep in watch — that's a nightly responsibility. No healthchecks ping — watch is event-driven, not a heartbeat signal.

## Module layout

```
apps/agent/src/watch/
  index.ts              # HTTP server, route handlers, /health, in-process queue
  triage.ts             # runWatch(alert) — orchestrator
  prompt.ts             # per-run prompt assembly (blocks 6–8)
  queue.ts              # bounded serial queue, 429 on overflow
  webhooks/
    openobserve.ts      # parse + signature verify
    telegram.ts         # secret-token + chat-id auth, dedup, dispatch into apps/agent/src/bot
    generic.ts          # stub; 501 until first real consumer

apps/agent/src/agent/
  tools/
    conclude-watch.ts   # SDK tool registration + WatchVerdict schema
  prompts/
    watch.ts            # block 5 (triage algorithm) + renderers for 6–8
    shared.ts           # blocks 1–4 shared with nightly (defined in 04)
```

## Open questions

- **Priority queue by severity.** v1 serial FIFO. If `critical` alerts getting queued behind `warn`s turns into a real problem, swap to a two-tier queue (critical jumps). Defer until we see it.
- **Per-tenant rate caps.** All tenants share one 6/hour budget. A noisy tenant (initech during an incident) can starve pages from quiet tenants. Alternative: 3/hour per tenant, 6/hour global. More complex. Defer until first observed problem.
- **`correlate-deep` in watch.** Disabled for v1 (triage budget too tight). If a specific class of webhook needs deep correlation, reconsider — might be cheaper to pay for Sonnet than to defer and re-spin-up via nightly.
- **Follow-up `06-memory.md` edit.** Add `verdict` and `page_sent` columns to `runs`. This spec assumes them; they need to land before any watch code does.
- **Webhook replay / catch-up.** None in v1; lost webhooks are lost. If operational gaps show real missed signals, add a small `pending_webhooks` table and a replay endpoint.
