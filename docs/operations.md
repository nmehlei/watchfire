# Operations

How to run Watchfire day to day once it is deployed: what normal looks like, how to
inspect it, how to rotate its credentials, and how to debug it when a night goes
wrong. For getting it onto a host in the first place, see
[`deployment.md`](deployment.md).

This guide does not redefine behaviour. Where it says "the nightly resolves
findings", the owning spec is authoritative — the links point there.

## A normal day

- **02:30 Europe/Berlin** — the nightly sweep runs, and a 🌙 digest lands in
  Telegram a few minutes later. Glance at it; act on anything 🔴 or new. The
  schedule is `WATCHFIRE_NIGHTLY_CRON` (default `30 2 * * *`); the timezone is fixed
  at `Europe/Berlin`. A sparser cron costs less and detects later — if you widen
  it, raise `WATCHFIRE_CATCHUP_STALE_HOURS` to match, or a restart on a between-run
  day fires an unplanned sweep. See [`deployment.md`](deployment.md).
- **Occasionally** — a 🚨 page during the day, when an alert fired and triage
  judged it worth waking you for. Context is in the page; follow-up lands in the
  next digest.
- **Monthly** — look at spend (see [Cost](#cost)).
- **Quarterly** — check no credential is overdue for [rotation](#rotation).
- **Yearly** — review the command allowlists in `apps/agent/src/agent/safety.ts`
  and `infra/ssh/watchfire-shell.sh` against a year of real use.

## Looking inside

None of this touches your infrastructure. The only writes are mutes, which change Watchfire's own state.

| Where | What it tells you |
|---|---|
| 🌙 digest in Telegram | The nightly ran, and what it found |
| 🚨 page in Telegram | A real-time alert survived triage |
| `GET /health` | `{"ok":true}` when the process is up |
| The dashboard | Findings, runs, mutes, cost and adapter health, live |
| The REST API | The same data as JSON |
| `/var/lib/watchfire/transcripts/<run_id>.jsonl` | The definitive record of what the agent did in one run |
| The SQLite database | Everything, if you need a query the API does not offer |

### The API

Every route requires `Authorization: Bearer $WATCHFIRE_API_TOKEN`.

| Route | Returns |
|---|---|
| `GET /api/findings` | Recent findings |
| `GET /api/findings/search` | Findings matching a query |
| `GET /api/findings/:id` | One finding |
| `GET /api/runs` | Run history |
| `GET /api/runs/:id` | One run |
| `GET /api/runs/:id/findings` | Findings a run produced |
| `GET /api/mutes` | Active mutes |
| `POST /api/mutes` · `DELETE /api/mutes/:id` | Mute or unmute a finding |
| `GET /api/cost-window` | Spend over a window |
| `GET /api/adapters/health` | Last-known adapter status |
| `GET /api/events` | Server-sent events as runs complete |
| `POST /mcp` | The same surface as MCP tools, for a Claude session |

### The database

The runtime image deliberately ships no `sqlite3` binary. To query the database
without touching the running container, mount its volume read-only into a
throwaway one:

```bash
docker run --rm -it -v watchfire-data:/data:ro alpine \
  sh -c 'apk add --no-cache sqlite >/dev/null && sqlite3 -readonly /data/watchfire.db'
```

Replace `watchfire-data` with your deployment's volume name.

## Cost

```sql
-- Last 30 days, by run type
SELECT type, COUNT(*) AS runs, ROUND(SUM(cost_eur), 2) AS eur
  FROM runs
 WHERE started_at > datetime('now', '-30 days')
 GROUP BY type;

-- The ten most expensive runs
SELECT id, started_at, type, status, turn_count, cost_eur
  FROM runs
 WHERE started_at > datetime('now', '-30 days')
 ORDER BY cost_eur DESC
 LIMIT 10;
```

Two things to know when reading these numbers:

- `cost_eur` is the cost the Claude Agent SDK reports for the run, stored as-is.
  It is a USD figure treated as roughly equal to EUR; there is no pricing table
  to update when prices change.
- **Watch runs currently record no cost** (`cost_eur` is `NULL`). Nightly spend is
  accurate; total spend is understated by whatever triage consumes.

The budget target lives in [`specs/00-overview.md`](../specs/00-overview.md).

## Runbooks

### Add a new tenant

Architecture in [`specs/02-tenants.md`](../specs/02-tenants.md). Checklist:

1. Add the tenant to your registry — the file `WATCHFIRE_TENANTS_PATH` points at. Start
   from `apps/agent/config/tenants.example.yaml` for the shape. The registry holds
   environment-variable **names**, never values.
2. Issue read-only credentials for each of the tenant's systems. Per-provider
   setup is in [`integrations/`](integrations/).
3. Provide those values to the container under the names the registry declares.
4. If the tenant owns or depends on a shared resource, add it to the file
   `WATCHFIRE_RESOURCES_PATH` points at.
5. Restart the container. The registry is read at startup.
6. Confirm in the next digest that the tenant was swept. If it was not, search that
   run's transcript for the tenant id to see whether the agent visited it.

### Add a new target host

For systems only reachable over SSH. Per
[`specs/08-safety.md`](../specs/08-safety.md), every target gets a dedicated `watchfire`
user whose only possible command is the constrained shell.

1. On the target, as root:

   ```bash
   useradd -m -s /bin/bash watchfire
   install -m 0755 -o root -g root infra/ssh/watchfire-shell.sh /usr/local/bin/watchfire-shell
   mkdir -p /etc/watchfire
   # List the log and config paths this host may expose, one per line, in
   # /etc/watchfire/paths.allow. Globs are expanded by watchfire-shell, not the shell.
   ```

2. Append Watchfire's public key to `/home/watchfire/.ssh/authorized_keys`, pinned to the
   forced command:

   ```
   command="/usr/local/bin/watchfire-shell",no-pty,no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-user-rc <watchfire-public-key>
   ```

3. Verify both halves — that a permitted command works and a forbidden one is
   refused:

   ```bash
   ssh -i <watchfire-private-key> watchfire@<host> "df -h"      # a disk report
   ssh -i <watchfire-private-key> watchfire@<host> "rm -rf /"   # exit 2: command not permitted
   ```

4. Add the host to the tenant's `ssh_hosts` in your registry and restart.

### Rotation

Every credential follows the same shape, and the order matters:

1. Obtain the new credential from its issuer.
2. Replace the value wherever your deployment keeps secrets.
3. Restart the container so it reads the new value.
4. Confirm the credential works — see the table.
5. **Only then** revoke the old one at the issuer.

| Credential | Old and new valid at once? | How to confirm the new one works |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | The next nightly digest arrives |
| Telegram bot token | No — strict cutover | `/health` is OK and the next digest arrives |
| `OPENOBSERVE_USER` / `OPENOBSERVE_PASSWORD` | Depends on the auth backend | `obs-streams` lists streams |
| Azure DevOps PAT (per tenant) | Yes, until the old one expires | `check-ado --tenant <id>` succeeds |
| `WATCHFIRE_API_TOKEN` | No — also update the dashboard | The dashboard loads data |
| `TELEGRAM_WEBHOOK_SECRET` | No — re-register the webhook | A bot command gets a reply |
| `OPENOBSERVE_WEBHOOK_SECRET` | No — update the OpenObserve alert too | A test alert is accepted |

For a strict-cutover credential, expect a short gap between steps 3 and the
issuer-side change. Do it when a missed page would not matter.

### Enable webhook signature verification

⚠️ **Without a secret, OpenObserve webhooks are accepted unverified** — Watchfire logs a
warning and processes them anyway. Anyone who can reach the endpoint can then queue
triage runs, and every triage run costs money. Turn verification on:

1. Configure the OpenObserve alert to sign outgoing webhooks and note the secret.
2. Provide it to the container as `OPENOBSERVE_WEBHOOK_SECRET`.
3. Make sure `WATCHFIRE_WEBHOOK_VERIFY=false` is **not** set — it forces verification off
   even when a secret is present.
4. Restart, fire a test alert, and confirm it is accepted. Then send one with a wrong
   signature and confirm it gets `401`.

### Move to a new host

1. On the old host, stop the container and export the data volume:

   ```bash
   docker compose down
   docker run --rm -v watchfire-data:/src -v /tmp:/dst alpine tar czf /dst/watchfire-data.tgz -C /src .
   ```

2. Copy `watchfire-data.tgz` and your registry files to the new host.
3. Restore the volume there:

   ```bash
   docker volume create watchfire-data
   docker run --rm -v watchfire-data:/dst -v /tmp:/src alpine tar xzf /src/watchfire-data.tgz -C /dst
   ```

4. Start Watchfire with the same environment and mounts, and repoint DNS.
5. Keep the old host until two nightlies have succeeded on the new one.

## Debugging

### No nightly digest

Work down this list:

1. Is it really missing, or just unread?
2. Is the container running? Read its logs for a startup error.
3. Does `/health` answer?
4. What does the run history say?

   ```sql
   SELECT id, started_at, completed_at, status, error, turn_count, cost_eur
     FROM runs
    WHERE type = 'nightly'
    ORDER BY started_at DESC
    LIMIT 5;
   ```

5. Read the latest row's `status`:

   | `status` | Meaning | Next step |
   |---|---|---|
   | `success` or `truncated`, but no message | The sweep finished; sending failed | Check `error` for a Telegram failure |
   | `truncated` | The agent hit its turn cap (40 by default) | Normal occasionally; persistent means the prompt or a tenant needs attention |
   | `error` starting `safety:` | The safety hook stopped a command | See [Safety block](#safety-block) |
   | `crashed` | The process died mid-run | The container logs and the transcript tell the story |
   | no recent row at all | The schedule did not fire | The process may be wedged — restart it |

On startup, Watchfire runs a catch-up nightly if the last completed one is older than
`WATCHFIRE_CATCHUP_STALE_HOURS` (default 24), so a restart is also the quickest way to get
a missed digest back — and why that value has to track your cron.

### Safety block

```sql
SELECT id, started_at, type, error
  FROM runs
 WHERE error LIKE 'safety:%'
 ORDER BY started_at DESC
 LIMIT 10;
```

Open the run's transcript and find the last tool call before it stopped. There are
three usual causes:

- **The agent misfired** — it reached for the wrong verb. Tighten the prompt in
  `apps/agent/src/nightly/prompt.ts` or `apps/agent/src/watch/prompt.ts`.
- **Prompt injection through tool output** — a log line contained instructions and
  the agent tried to follow them. The hook did its job; strengthen the prompt's
  framing that tool output is data, not instructions.
- **A legitimate new tool nobody allowlisted.** Update
  [`specs/08-safety.md`](../specs/08-safety.md), then the code and its tests.

**Never loosen a block pattern without a reviewed spec change.** The safety hook is
one of the layers that makes Watchfire safe to point at production.

### Findings that will not clear

```sql
SELECT fingerprint, resource_id, state, first_seen_at, last_seen_at, run_count, title
  FROM findings
 WHERE state = 'ongoing'
 ORDER BY run_count DESC
 LIMIT 20;
```

If the underlying problem is fixed but the finding persists:

1. Read the latest nightly's transcript. Did the agent visit that resource at all?
2. If it did, compare the emitted `resource_id` with the stored one — a
   canonicalisation mismatch creates a new fingerprint instead of resolving the old.
3. If it did not, the resource may be outside what the current adapters can see.

If you need it gone now, mute it from Telegram or the dashboard rather than editing
the database — a mute is reversible and leaves a record.

### Alerts do not produce a triage run

1. Send a test webhook:

   ```bash
   curl -i -X POST https://<your-watchfire-host>/webhook/openobserve \
        -H "Content-Type: application/json" \
        -d '<a payload in your OpenObserve alert template's shape>'
   ```

2. Read the response:

   | Response | Meaning |
   |---|---|
   | `202` | Queued — a `watch` row should appear in `runs` |
   | `400` | The payload did not parse; the container logs show why |
   | `401` | Signature verification failed — check `OPENOBSERVE_WEBHOOK_SECRET` |
   | `429` | The triage queue is full (10 deep); something upstream is firing hard |

3. If the test is accepted but real alerts never arrive, the problem is between
   OpenObserve and Watchfire — check OpenObserve's delivery logs and your ingress.

A page is also held back once 6 pages have been sent in the past hour; the finding
still reaches the next digest.

## Retention

| Data | Kept for | How |
|---|---|---|
| Resolved findings | 90 days | Automatic, after each successful nightly |
| Observations | 30 days | Automatic |
| Runs | 365 days | Automatic |
| Expired mutes | Removed on expiry | Automatic |
| Transcripts | **Forever** | Manual — see below |
| Container logs | Your Docker log driver's default | Docker |

Transcripts are the audit record for safety reviews and cannot be rebuilt, so
nothing deletes them automatically. Watch their size:

```bash
du -sh /var/lib/watchfire/transcripts
```

Prune only once you are sure nothing in the deleted window is under review:

```bash
find /var/lib/watchfire/transcripts -name '*.jsonl' -mtime +365 -delete
```

## Alerting

Watchfire does not yet emit a heartbeat, so **nothing inside Watchfire will tell you that Watchfire
itself has stopped.** Until it does, add a check from outside the host:

- an uptime monitor on `GET /health`, and
- an alert if `GET /api/runs` shows no `success` or `truncated` nightly in the last
  25 hours.

Run that check somewhere other than the host Watchfire lives on. A monitor that dies with
the thing it watches is not a monitor.

## Known limitations

These are by design, not defects:

- **No dead-man's switch is built in** — see [Alerting](#alerting).
- **Webhooks that arrive while the container is down are lost.** The next nightly
  sweep is the backstop.
- **Triage is first come, first served.** A critical alert can queue behind warnings.
- **The page budget is global.** One noisy tenant can use up the 6 pages an hour.
- **One container, one volume.** Acceptable for a report-only system at this scale.

## Guardrails

- **Report-only, always.** Never add a capability that changes what Watchfire observes.
- **No plaintext secrets** in the repository, the registry, or logs.
- **Do not change the default model** without checking what it does to the budget.
- **Do not loosen safety patterns** without a reviewed spec change.
