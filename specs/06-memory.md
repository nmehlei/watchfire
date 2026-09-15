# Watchfire — Memory

## Purpose

Defines how Watchfire persists state between runs: the SQLite schema (`findings`, `runs`, `observations`), how findings are fingerprinted and move through their lifecycle, retention rules, and the query patterns the rest of the system depends on. This spec is the canonical source for the memory layer; `01-architecture.md` sketched the `runs` table — the definitive version lives here.

Display and formatting rules — including the 7-day resolved-findings cutoff and the ⚠️ escalating rendering — belong in `07-reporting.md`. Safety hook and transcript audit concerns belong in `08-safety.md`. This spec references those boundaries without defining them.

## Storage

One SQLite file at `/var/lib/iris/iris.db`, on the mounted `iris-data` volume. Single file, no replicas. Backups are out of scope for memory — if we lose the file we lose historical lifecycle state but gain it back over a few nights (every ongoing finding re-surfaces as 🆕 new, and normal lifecycle resumes). Acceptable given the scale.

PRAGMAs set at open:

- `journal_mode=WAL` — concurrent readers while a writer is active; required because Watch webhooks can fire during a nightly run.
- `busy_timeout=5000` — tolerate brief contention between nightly and watch.
- `synchronous=NORMAL` — durable enough; we can lose <1s of writes on a hard kill.
- `foreign_keys=OFF` — referential integrity is documented but not enforced (see "Referential integrity").

Schema is applied and evolved via sequential SQL files under `apps/agent/src/memory/migrations/NNNN-*.sql`, tracked in `schema_migrations`, applied at process startup.

## Schema

### `runs`

Execution history; source of truth for catch-up decisions, cost accounting, and watch rate limiting.

```sql
CREATE TABLE runs (
  id              INTEGER PRIMARY KEY,
  type            TEXT NOT NULL,       -- 'nightly' | 'watch' | 'manual'
  trigger         TEXT NOT NULL,       -- 'cron' | 'catchup' | 'webhook' | 'manual'
  started_at      TEXT NOT NULL,       -- ISO 8601
  completed_at    TEXT,                -- NULL while running or if crashed
  status          TEXT,                -- 'success' | 'truncated' | 'error' | 'crashed'
  verdict         TEXT,                -- watch only: 'page' | 'defer' | 'drop'; NULL for nightly/manual
  page_sent       INTEGER,             -- watch only: 0/1 after rate-limit check; NULL for nightly/manual
  finding_count   INTEGER,
  turn_count      INTEGER,             -- total agent turns used; lets the digest render "14 turns" without transcript parsing
  tokens_in       INTEGER,
  tokens_out      INTEGER,
  tokens_cached   INTEGER,
  cost_eur        REAL,                -- computed at run-end from tokens; cached for fast cost queries
  error           TEXT,
  transcript_path TEXT
);
CREATE INDEX idx_runs_type_started ON runs(type, started_at DESC);
CREATE INDEX idx_runs_started      ON runs(started_at DESC);
```

`cost_eur` is cached at run-end so the monthly self-check is an `O(rows)` sum instead of a token-math query. Model price tables live in `apps/agent/src/memory/pricing.ts` and are applied at `completeRun` time.

### `findings`

Every finding Watchfire has ever seen, across all lifecycle states. One row per unique `(resource_id, issue_class)` pair.

```sql
CREATE TABLE findings (
  id              INTEGER PRIMARY KEY,
  fingerprint     TEXT NOT NULL UNIQUE,      -- sha256 hex of "<resource_id>\0<issue_class>"
  resource_id     TEXT NOT NULL,             -- canonicalized; e.g. 'sql.acme.internal', 'tenant:acme'
  issue_class     TEXT NOT NULL,             -- enum; see below

  state           TEXT NOT NULL,             -- 'new' | 'ongoing' | 'resolved'
  severity        TEXT NOT NULL,             -- 'info' | 'warn' | 'critical'
  prev_severity   TEXT,                      -- severity from previous sighting; NULL on first

  title           TEXT NOT NULL,             -- <= 140 chars, latest
  evidence        TEXT,                      -- prose, <= 2000 chars, latest
  likely_cause    TEXT,                      -- prose, optional, latest

  first_seen_at   TEXT NOT NULL,             -- ISO 8601; reset on re-emergence from 'resolved'
  last_seen_at    TEXT NOT NULL,             -- bumped each run this fingerprint is re-sighted
  resolved_at     TEXT,                      -- ISO 8601; NULL unless state='resolved'
  run_count       INTEGER NOT NULL DEFAULT 1,

  first_run_id    INTEGER NOT NULL,          -- run where this fingerprint first appeared (this episode)
  last_run_id     INTEGER NOT NULL           -- most recent run that sighted it
);
CREATE UNIQUE INDEX idx_findings_fp          ON findings(fingerprint);
CREATE        INDEX idx_findings_state_seen  ON findings(state, last_seen_at DESC);
CREATE        INDEX idx_findings_resource    ON findings(resource_id);
CREATE        INDEX idx_findings_resolved_at ON findings(resolved_at);
```

A finding does **not** carry its affected-tenants list; the digest post-processor expands `affects` from `apps/agent/config/resources.yaml` at report time. Keeping it out of the row avoids stale-data bugs when the resource graph changes.

### `observations`

Per-run measurements used by adapters to detect drift and anomalies (HTTP latency regression, SSL days-until-expiry trend). Raw samples; aggregation at read time.

```sql
CREATE TABLE observations (
  id            INTEGER PRIMARY KEY,
  tenant        TEXT NOT NULL,
  source        TEXT NOT NULL,           -- adapter name, e.g. 'check-http', 'check-ssl'
  subject       TEXT NOT NULL,           -- identifier within source (endpoint name, hostname, ...)
  metric        TEXT NOT NULL,           -- e.g. 'response_ms', 'status_code', 'days_until_expiry'
  value         REAL NOT NULL,
  observed_at   TEXT NOT NULL,           -- ISO 8601
  run_id        INTEGER NOT NULL
);
CREATE INDEX idx_obs_lookup ON observations(tenant, source, subject, metric, observed_at DESC);
CREATE INDEX idx_obs_run    ON observations(run_id);
```

Named `observations`, not `baselines`: the table stores **raw samples**. "Baseline" (p50 / p95 over a window) is computed on read by the caller. At our scale the math is trivially cheap and avoids maintaining a second derived table.

### `mutes`

Operator-controlled suppressions. A mute is keyed on a finding's full
fingerprint (`sha256(canonical_resource_id || \0 || issue_class)`); the
operator usually addresses mutes by short ID (first 6 hex chars of the
fingerprint) — see `specs/10-telegram-control.md` for the resolution rules.

Mutes are a render-time filter only: muted findings still upsert normally
(audit trail intact), but `07-reporting.md` excludes them from the digest
and `05-watch.md` suppresses pages for them.

```sql
CREATE TABLE mutes (
  id            INTEGER PRIMARY KEY,
  fingerprint   TEXT NOT NULL,        -- exact match against findings.fingerprint
  reason        TEXT,                 -- operator note, optional
  created_at    TEXT NOT NULL,        -- ISO 8601
  expires_at    TEXT,                 -- ISO 8601; NULL = indefinite
  source        TEXT NOT NULL         -- 'telegram' | 'manual'
);
CREATE INDEX idx_mutes_fingerprint ON mutes(fingerprint);
CREATE INDEX idx_mutes_expires_at  ON mutes(expires_at);
```

A "mute is active" iff `expires_at IS NULL OR expires_at > now`. There can
be multiple mute rows for the same fingerprint (e.g. operator re-muted
after expiry) — readers treat any active row as authoritative. Expired
rows are pruned in the retention sweep.

### `schema_migrations`

```sql
CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL
);
```

### Referential integrity

`findings.first_run_id`, `findings.last_run_id`, and `observations.run_id` are **logical** foreign keys to `runs.id` — not enforced by SQLite because the `runs` retention sweep (365 days) will prune rows still referenced by long-lived ongoing findings. Callers that need run metadata use `LEFT JOIN` and tolerate NULL. This is a deliberate trade: the relation survives as documentation and most joins succeed, while the pruner stays simple.

## Finding ingest contract

Nightly and Watch agents emit findings as Agent SDK structured output. The contract memory accepts:

```ts
interface AgentFinding {
  resource_id: string;          // required; will be canonicalized before fingerprinting
  issue_class: IssueClass;      // required; enum, see below
  severity: 'info' | 'warn' | 'critical';
  title: string;                // required; <= 140 chars
  evidence: string;             // required; <= 2000 chars; prose or bullets, agent's choice
  likely_cause?: string;        // optional prose
}

type IssueClass =
  | 'disk-pressure'
  | 'cert-expiry'
  | 'error-rate-spike'
  | 'unhealthy-pod'
  | 'http-down'
  | 'latency-regression'
  | 'auth-failure-spike'
  | 'build-red'
  | 'unknown';
```

`build-red` — a pipeline's latest default-branch run failed (`check-ado`, spec 03). One finding per pipeline via `resource_id = ado.<tenant>.<project>.<pipeline-slug>`; its age carries the "red for N days" signal.

`IssueClass` is intentionally small. Extending it is a **spec change** (edit this section + the JSON schema used by the Agent SDK output tool) — not a code-only change. Adding a new class without updating this spec is a bug.

`unknown` exists as an escape hatch. It is not a dumping ground: if `unknown` findings recur for the same resource across multiple nightlies, the operator is expected to promote them to a new named class in the next PR.

### `resource_id` canonicalization

Before fingerprinting, `resource_id` is canonicalized:

- Lowercased, whitespace trimmed.
- No inline port numbers for v1.
- Reserved prefixes:
  - `tenant:<id>` — scoped to a whole tenant, no specific resource (e.g. "every adapter failed for acme this run").
  - `global` — not tenant-specific (rare; prefer `tenant:<id>` where possible).
- Unknown resources (not listed in `apps/agent/config/resources.yaml`) are accepted. The digest post-processor defaults `affects` to `[owner]` where owner is derivable from the resource naming convention, otherwise to the tenant from the run context.
- **Kubernetes workloads** key off the stable owner — Deployment / StatefulSet / DaemonSet / CronJob — never the pod. Pods are cattle with UUID suffixes; fingerprinting on a pod would flap on every rollout, OOMKill, or node drain. Concrete pod names belong in `evidence`. The rare genuinely pod-local case (e.g. stuck pod on a bad node) is almost always better expressed as a node-scoped finding. Exact `resource_id` format for K8s workloads is pinned in `04-nightly.md`.

Canonicalization happens exactly once, at ingest, in `apps/agent/src/memory/fingerprint.ts`. The canonical form is what goes into `findings.resource_id`.

## Fingerprint algorithm

```
fingerprint = sha256( canonicalize(resource_id) + "\0" + issue_class ).hex()
```

Full 64-char hex; no truncation. Disk cost is negligible and a full hash keeps the index opaque to accidental parsing.

The fingerprint is recomputed from the two inputs on every ingest; the DB stores it only for the unique-index lookup. If canonicalization rules ever change, existing rows must be migrated in the same PR as the rule change.

## Lifecycle

Persisted states in `findings.state`:

| State      | Entered when                                                                |
| ---------- | --------------------------------------------------------------------------- |
| `new`      | Fingerprint first appears, OR re-appears after being `resolved`.            |
| `ongoing`  | A finding currently `new` is re-sighted by a subsequent run.                 |
| `resolved` | A nightly run does **not** re-sight a finding previously `new` or `ongoing`. |

`escalating` is **not a persisted state** — it is computed at report time as:

```
escalating(f) = f.state == 'ongoing'
             && severity_rank(f.severity) > severity_rank(f.prev_severity)
             && f.prev_severity IS NOT NULL
```

with `info < warn < critical`. Rendering lives in `07-reporting.md`.

### Transition rules

On ingest of a finding with fingerprint `fp` during run `r`:

```
row = SELECT * FROM findings WHERE fingerprint = fp

IF row IS NULL:
    INSERT state='new',
           first_seen_at=now, last_seen_at=now,
           run_count=1,
           first_run_id=r.id, last_run_id=r.id,
           prev_severity=NULL,
           severity, title, evidence, likely_cause FROM incoming

ELSE:
    new_state       = 'new' IF row.state == 'resolved' ELSE 'ongoing'
    new_first_seen  = now   IF row.state == 'resolved' ELSE row.first_seen_at
    new_first_run   = r.id  IF row.state == 'resolved' ELSE row.first_run_id

    UPDATE state         = new_state,
           last_seen_at  = now,
           last_run_id   = r.id,
           run_count     = row.run_count + 1,
           first_seen_at = new_first_seen,
           first_run_id  = new_first_run,
           prev_severity = row.severity,
           severity, title, evidence, likely_cause FROM incoming,
           resolved_at   = NULL
```

When a `resolved` finding re-surfaces, `first_seen_at` and `first_run_id` **reset** to the current run. Semantic: "new" means "new this episode." Long-term re-surfacing history is reconstructible from `runs` + transcripts.

### Resolution sweep (nightly only)

Only nightly runs can move findings to `resolved`. Watch runs create or refresh findings but never resolve them — Watch only sees what its trigger points at, not the whole system.

At the end of each successful nightly run `r`, after the digest has been composed (but may fire before it's posted; sweep and post are independent):

```sql
UPDATE findings
   SET state       = 'resolved',
       resolved_at = :now
 WHERE state IN ('new', 'ongoing')
   AND last_seen_at < :r_started_at;
```

Time-bounded by `r.started_at`, not by a snapshot of prior findings taken at nightly start. This makes the sweep correct under concurrent Watch writes: a Watch run that refreshes a finding's `last_seen_at` past `r.started_at` correctly protects it from being swept.

**Sweep eligibility by run status:**

| `runs.status` | Sweep runs? | Reason                                                                                         |
| ------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `success`     | ✅           | Agent completed normally and reported its full view.                                           |
| `truncated`   | ✅           | Agent did visit the world; the budget ended before it declared itself done, but unseen findings are legitimately absent. Sweep is the point — it would be wrong to skip. |
| `error`       | ❌           | A partial or failed view must not be allowed to resolve findings.                              |
| `crashed`     | ❌           | Same as `error`.                                                                               |

### Watch concurrency

Watch runs can overlap with a nightly. Safety contract:

- All ingest, resolution, and retention operations run inside `BEGIN IMMEDIATE` transactions.
- The sweep's `last_seen_at < :r_started_at` clause is the concurrency correctness anchor (see above).
- **Single clock source.** All timestamps in this schema (`started_at`, `completed_at`, `first_seen_at`, `last_seen_at`, `resolved_at`, `observed_at`) are sourced from `SELECT datetime('now')` on the DB host, never from an application `new Date()`. Today Watchfire is single-host so this is a convention; if we ever split writers across hosts, it becomes load-bearing — the sweep's time-bounded anchor assumes one clock, and a drifty watch writer would otherwise produce findings that never resolve.
- No other cross-run coordination is needed.

## Retention

Run at end of each successful nightly, after the digest has been posted:

```sql
DELETE FROM findings
 WHERE state = 'resolved'
   AND resolved_at < datetime('now', '-90 days');

DELETE FROM observations
 WHERE observed_at < datetime('now', '-30 days');

DELETE FROM runs
 WHERE started_at < datetime('now', '-365 days');

DELETE FROM mutes
 WHERE expires_at IS NOT NULL AND expires_at < datetime('now');
```

Rationale:

- **Findings (90 days in `resolved`)** — monthly-trend audits stay possible; stale zombie rows don't accumulate.
- **Observations (30 days)** — anomaly detection uses up-to-30-day windows; longer history is in transcripts.
- **Runs (365 days)** — one year of cost and cadence history is enough for this scale.
- **Expired mutes** — pruned eagerly so the digest's "🤫 N muted" footer is accurate. Unbounded mutes (`expires_at IS NULL`) live forever until `/unmute`.

Transcript **files** on disk are governed by `docs/operations.md`; memory does not own their lifecycle. If `runs.transcript_path` points to a file that has been deleted, callers must tolerate it.

## Query patterns

The rest of the system touches memory only through these queries (implemented in `apps/agent/src/memory/*.ts` as typed functions, not ad-hoc SQL at call sites).

### Nightly

**Seed context for the agent prompt** — recent findings the agent should know exist:

```sql
SELECT fingerprint, resource_id, issue_class, state, severity, title,
       first_seen_at, last_seen_at, run_count
  FROM findings
 WHERE state IN ('new', 'ongoing')
    OR last_seen_at > datetime('now', '-30 days')
 ORDER BY last_seen_at DESC;
```

**Ingest findings**: `upsertFinding(run_id, finding)` per the transition rules.

**Resolution sweep**: see above.

**Digest composition** (active + recently-resolved; ordering is a display concern and is finalized in 07):

```sql
SELECT *
  FROM findings
 WHERE state IN ('new', 'ongoing')
    OR (state = 'resolved' AND resolved_at > datetime('now', '-7 days'));
```

### Watch

**Page-activity-window query** — count of pages actually sent in the trailing 1-hour window. Used by the watch runner to decide "page" vs. "suppress-and-roll-into-digest." This spec owns the query shape; the cap itself (currently "6 pages/hour") is policy and belongs to `05-watch.md`, which should reference this query by its label rather than inlining the SQL. The implementation is free to pick any function name.

```sql
SELECT COUNT(*) FROM runs
 WHERE type       = 'watch'
   AND verdict    = 'page'
   AND page_sent  = 1
   AND started_at > datetime('now', '-1 hour');
```

**Suppressed-pages-window query** — count and time window of watch runs where the agent's verdict was `page` but the rate limit prevented it. Read by the nightly digest composer (`07-reporting.md`) to render the "N pages were suppressed between X and Y" header.

```sql
SELECT COUNT(*)       AS suppressed_count,
       MIN(started_at) AS window_start,
       MAX(started_at) AS window_end
  FROM runs
 WHERE type      = 'watch'
   AND verdict   = 'page'
   AND page_sent = 0
   AND started_at > datetime('now', '-24 hours');
```

Scope is rolling 24h — an approximation for "since the last nightly." If nightlies run more than once in 24h (catch-up) or less than once (outage), this may double-count or miss. Acceptable for v1; tighten to "since last successful nightly" if operator experience shows drift.

**Ingest findings**: same `upsertFinding` as nightly. No sweep.

### Startup

**Mark crashed runs**:

```sql
UPDATE runs SET status = 'crashed'
 WHERE completed_at IS NULL AND status IS NULL;
```

**Catch-up decision**:

```sql
SELECT MAX(started_at) FROM runs
 WHERE type = 'nightly' AND status IN ('success', 'truncated');
```

If `> 24h` ago (or NULL), trigger a catch-up nightly before entering the normal loop. Truncated runs count as "swept" — they posted a digest and resolved findings, just under a budget-limited view.

### Mutes

**Is a fingerprint actively muted?** — called by digest composer (07) per finding and by watch triage (05) before sending a page.

```sql
SELECT 1 FROM mutes
 WHERE fingerprint = ?
   AND (expires_at IS NULL OR expires_at > datetime('now'))
 LIMIT 1;
```

**Resolve a short-id prefix to a full fingerprint** — called by the Telegram command handler (10) to translate `/mute 9b9896` → unique fingerprint. Returns 0, 1, or N candidates; N>1 forces the operator to disambiguate.

```sql
SELECT DISTINCT fingerprint FROM findings
 WHERE fingerprint LIKE ? || '%'
 ORDER BY fingerprint;
```

**List active mutes** — for the `/mutes` reply and the digest's `🤫 N muted` footer.

```sql
SELECT m.fingerprint, m.reason, m.created_at, m.expires_at, m.source,
       f.resource_id, f.issue_class, f.title
  FROM mutes m
  LEFT JOIN findings f ON f.fingerprint = m.fingerprint
 WHERE m.expires_at IS NULL OR m.expires_at > datetime('now')
 ORDER BY m.created_at DESC;
```

**Insert a mute** — duration parsed by the command handler; NULL `expiresAt` means indefinite.

```sql
INSERT INTO mutes (fingerprint, reason, created_at, expires_at, source)
VALUES (?, ?, datetime('now'), ?, ?);
```

**Delete a mute** — `/unmute <id>` after prefix resolution. Hard delete; the `findings` row is untouched.

```sql
DELETE FROM mutes WHERE fingerprint = ?;
```

### Observations

**Append**:

```sql
INSERT INTO observations (tenant, source, subject, metric, value, observed_at, run_id)
VALUES (?, ?, ?, ?, ?, ?, ?);
```

**Baseline window** — caller computes p50/p95/stddev itself:

```sql
SELECT value
  FROM observations
 WHERE tenant = ? AND source = ? AND subject = ? AND metric = ?
   AND observed_at > datetime('now', '-30 days')
 ORDER BY observed_at DESC;
```

### Ops / audits

**Monthly cost**:

```sql
SELECT SUM(cost_eur) FROM runs
 WHERE started_at > datetime('now', '-30 days');
```

**Finding history for a resource**:

```sql
SELECT * FROM findings WHERE resource_id = ? ORDER BY last_seen_at DESC;
```

## Crash recovery

Memory-side behavior on restart:

1. Any `runs` row with `completed_at IS NULL AND status IS NULL` is marked `status='crashed'` (see startup flow in `01-architecture.md`).
2. Findings partially upserted during a crashed nightly remain in the DB; they carry the crashed run's ID in `last_run_id`. The next successful nightly either re-sights them (normal transition) or resolves them (if the underlying issue cleared). No explicit rollback.
3. Observations appended by a crashed run remain; they are harmless data points.

A crashed nightly can leave findings in slightly-stale state for up to one day. Acceptable.

## Module layout

```
apps/agent/src/memory/
  index.ts              # public API: openDb, withTransaction
  schema.ts             # PRAGMA + migration runner
  migrations/
    0001-initial.sql
  findings.ts           # upsertFinding, resolveSweep, queries
  runs.ts               # insertRun, completeRun, catchup queries
  observations.ts       # appendObservation, baseline window
  retention.ts          # pruneOldData
  fingerprint.ts        # canonicalize, sha256
  pricing.ts            # token → cost_eur conversion, by model
  types.ts              # AgentFinding, IssueClass, Severity, State
```

One pure module per table plus small utility modules. Each `foo.ts` pairs with `foo.test.ts` (Vitest, in-memory SQLite).

## Open questions

- **Evidence body size.** `evidence` is capped at 2000 chars. If an agent's evidence is naturally longer (e.g. 10 log lines × 200 chars), do we truncate, spill to a side-table, or file-spool? Default plan: truncate with an ellipsis, rely on the transcript for the full payload. Revisit if truncation hides signal in the digest.
- **Finding-event log.** Today, severity escalations and resolution→new flips are detectable but not archived as discrete events — only as the current-state row. If long-term timeline analysis becomes interesting, add a `finding_events` append-only table. Not needed for v1.
