# Usage

How to configure Watchfire, give it credentials, and run it. For running it day to day
afterwards, see [`operations.md`](operations.md); for putting it on a host, see
[`deployment.md`](deployment.md).

## Prerequisites

- **Node 24.**
- **An Anthropic API key.** Watchfire runs on `claude-haiku-4-5` by default.
- **A Telegram bot and a chat.** Digests and pages go there, and Watchfire will not start
  without them. See [`integrations/telegram.md`](integrations/telegram.md).
- **At least one system to watch** that Watchfire has an adapter for.

## Configuration

Watchfire reads two YAML files. The repository ships examples; your real files are yours
and are never committed.

```bash
cp apps/agent/config/tenants.example.yaml   apps/agent/config/tenants.yaml
cp apps/agent/config/resources.example.yaml apps/agent/config/resources.yaml
```

Point Watchfire at them with `WATCHFIRE_TENANTS_PATH` and `WATCHFIRE_RESOURCES_PATH`. If either file
is missing, Watchfire refuses to start and names the example to copy.

### Tenants

A **tenant** is a group of systems that belong together — one customer, one product,
one environment. Each tenant lists the systems Watchfire should look at:

```yaml
tenants:
  - id: acme                 # short, stable, used in commands and findings
    display_name: ACME
    systems:
      - observability:
          stream: acme            # the OpenObserve stream holding this tenant's logs
          token_env: OBS_TOKEN_ACME   # required by the schema; see the note below
      - ssl:
          hosts: [acme.example, mail.acme.example]
      - http_health:
          endpoints:
            - name: public
              url: https://acme.example
      - azure_devops:
          org_url: https://dev.azure.com/acme
          project: Platform
          pat_env: ADO_PAT_ACME   # the NAME of the variable holding the token
```

**The registry holds environment-variable names, never values.** A field ending in
`_env` names the variable Watchfire reads the secret from.

⚠️ `observability.token_env` is required by the registry schema, but the OpenObserve
adapter does not read it: it authenticates with the shared `OPENOBSERVE_*` credentials
below, and tells tenants apart by `stream`. Name a variable that does not have to
exist, and do not provision a credential per tenant for it.

What each system type needs, and whether it is built:

| System | Fields | Adapter |
|---|---|---|
| `observability` | `stream`, `token_env` | ✅ `obs-search`, `obs-streams` |
| `ssl` | `hosts` | ✅ `check-ssl` |
| `http_health` | `endpoints` (each `name`, `url`) | ✅ `check-http` |
| `azure_devops` | `org_url`, `project`, `pat_env` | ✅ `check-ado` |
| `azure` | `subscription_id`, `tenant_id`, `sp_env` | specified, not built |
| `hetzner` | `account`, `token_env`, `ssh_hosts` | specified, not built |
| `kubernetes` | `kubeconfig_env`, `context` | specified, not built |

Unbuilt system types parse and validate, so you can describe them now; nothing reads
them yet. See [`specs/README.md`](../specs/README.md).

### Shared resources

`resources.yaml` lists resources more than one tenant depends on — a shared database
server, a mail relay. It changes how findings are reported, not what is checked: a
problem on a shared resource is attributed to every tenant in its `affects` list.

```yaml
resources:
  - id: sql.acme.internal
    type: mssql-server
    owner: acme
    affects: [acme, globex]
    notes: "Hosts globex's production database."
```

Resources used by a single tenant do not need an entry.

## Environment variables

### Required

Watchfire stops at startup, naming the missing variable, if any of these is unset.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | The agent's model access |
| `TELEGRAM_BOT_TOKEN` | Sending digests and pages |
| `TELEGRAM_CHAT_ID` | Where they are sent |

### Paths

The defaults suit a container. Outside one, set all three.

| Variable | Default | Purpose |
|---|---|---|
| `WATCHFIRE_TENANTS_PATH` | `/etc/watchfire/tenants.yaml` | Tenant registry |
| `WATCHFIRE_RESOURCES_PATH` | `/etc/watchfire/resources.yaml` | Shared-resource graph |
| `WATCHFIRE_DB_PATH` | `/var/lib/watchfire/watchfire.db` | SQLite memory — **its directory must already exist** |
| `WATCHFIRE_TRANSCRIPT_DIR` | `transcripts/` beside the database | Per-run transcripts |
| `WATCHFIRE_HTTP_PORT` | `8080` | Webhooks, health, and the API |

### Optional features

| Variable | Enables |
|---|---|
| `WATCHFIRE_API_TOKEN` | The REST API and MCP endpoint. Unset, both are disabled. |
| `TELEGRAM_WEBHOOK_URL` + `TELEGRAM_WEBHOOK_SECRET` | Receiving bot commands. Without both, Watchfire still sends messages but never hears commands. |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Which chats may send commands. Defaults to `TELEGRAM_CHAT_ID`. |
| `WATCHFIRE_NIGHTLY_CRON` | The sweep schedule, as a cron expression. Default `30 2 * * *`. |
| `WATCHFIRE_CATCHUP_STALE_HOURS` | How stale the last nightly must be for a startup catch-up. Default `24`. |
| `OPENOBSERVE_WEBHOOK_SECRET` | Verifying incoming alert webhooks. **Set this** — see below. |
| `WATCHFIRE_WEBHOOK_VERIFY=false` | Forces verification off even with a secret. For debugging only. |

### System credentials

| Variable | Used by |
|---|---|
| `OPENOBSERVE_URL`, `OPENOBSERVE_USER`, `OPENOBSERVE_PASSWORD`, `OPENOBSERVE_ORG` | All OpenObserve access. One credential set covers every tenant; tenants are told apart by `stream`. |
| Whatever a tenant's `*_env` field names | That tenant's system, e.g. `ADO_PAT_ACME` |

Provider-specific setup, including how to issue read-only credentials, is in
[`integrations/`](integrations/README.md).

## Running locally

With the configuration and variables above in place:

```bash
mkdir -p apps/agent/data
export WATCHFIRE_TENANTS_PATH=config/tenants.yaml WATCHFIRE_RESOURCES_PATH=config/resources.yaml WATCHFIRE_DB_PATH=data/watchfire.db
npm run dev
```

Relative paths resolve from `apps/agent/`. Check it is up:

```bash
curl localhost:8080/health    # {"ok":true}
```

### Running one adapter by hand

Every adapter is a command in `apps/agent/bin/` — the same commands the agent runs.
Running one yourself is the fastest way to check a credential:

```bash
cd apps/agent
./bin/check-ssl --tenant acme
./bin/check-http --tenant acme
./bin/obs-streams --tenant acme
./bin/obs-search --tenant acme --query error --since 1h
./bin/check-ado --tenant acme
```

From `apps/agent/`, the commands find `config/tenants.yaml` on their own; elsewhere,
they read `WATCHFIRE_TENANTS_PATH` or take `--tenants-path`.

## The nightly sweep

By default, every night at **02:30 Europe/Berlin**, the agent works through each
tenant with the adapters available to it, records findings, and sends a digest.
`WATCHFIRE_NIGHTLY_CRON` changes the cadence — a sparser schedule costs less and finds
problems later. The timezone is fixed at `Europe/Berlin`. It has a budget of
**40 turns**; if it runs out, the run is marked `truncated` and the digest says so.

After the digest, Watchfire resolves findings it no longer sees and prunes old data. If the
process was down at the scheduled time, it runs a catch-up sweep on startup once the
last completed nightly is older than `WATCHFIRE_CATCHUP_STALE_HOURS` (default 24).

⚠️ **These two settings are coupled.** If you widen the cron, raise the catch-up
window to cover the longest gap it can produce — otherwise a restart on a between-run
day triggers an unplanned sweep and spends the money the sparser schedule saved.

## Watch mode

Alerts become triage runs. Point your OpenObserve alert at:

```
POST https://<your-watchfire-host>/webhook/openobserve
```

Each alert is queued and investigated with a budget of **8 turns**. The agent then
decides to **page** you now, **defer** to the next digest, or **drop** it as noise.

- The queue holds 10 alerts; beyond that, Watchfire answers `429` so the sender retries.
- At most 6 pages go out per hour. Further page-worthy findings still reach the digest.
- A muted finding never pages.

⚠️ **Set `OPENOBSERVE_WEBHOOK_SECRET`.** Without it, Watchfire accepts webhooks unverified,
and anyone who can reach the endpoint can queue triage runs — each of which costs
money. With it, unsigned or wrongly signed requests get `401`.

## Telegram commands

Once `TELEGRAM_WEBHOOK_URL` and `TELEGRAM_WEBHOOK_SECRET` are set, Watchfire registers its
webhook with Telegram on startup and answers commands from allowed chats:

| Command | Does |
|---|---|
| `/mute <id> [1d\|7d\|30d\|forever] [-- reason]` | Stops a finding from paging and cluttering digests. Duration is one of those four values; a reason follows `--`. |
| `/unmute <finding>` | Lifts a mute |
| `/mutes` | Lists active mutes |
| `/help` | Shows the command reference |

The full surface is in [`specs/10-telegram-control.md`](../specs/10-telegram-control.md).

## The API and MCP

Set `WATCHFIRE_API_TOKEN` to a long random value. Every request then needs:

```
Authorization: Bearer <WATCHFIRE_API_TOKEN>
```

The REST routes are listed in [`operations.md`](operations.md#the-api). The same
surface is available as MCP tools over Streamable HTTP, so a Claude session can query
Watchfire directly:

```bash
claude mcp add --transport http watchfire https://<your-watchfire-host>/mcp \
  --header "Authorization: Bearer <WATCHFIRE_API_TOKEN>"
```

Then ask things like "what's still open on acme?" or "mute the disk finding for a
week". The design is in [`specs/11-mcp.md`](../specs/11-mcp.md).

## The dashboard

The dashboard is a Next.js app that reads the REST API server-side; the token never
reaches the browser. Sign-in uses Microsoft Entra ID.

```bash
cp apps/dashboard/.env.example apps/dashboard/.env.local
# fill in WATCHFIRE_API_URL, WATCHFIRE_API_TOKEN, AUTH_SECRET and the three Entra ID values
npm run dev -w @watchfire/dashboard
```

It serves on `http://localhost:3000`. For local sign-in to complete, your Entra ID app
registration must allow the redirect URI
`http://localhost:3000/api/auth/callback/microsoft-entra-id`. Generate `AUTH_SECRET`
with `openssl rand -base64 32`.

The design, including why it is a single-operator app, is in
[`specs/12-dashboard.md`](../specs/12-dashboard.md).

## Troubleshooting

| Symptom | Cause |
|---|---|
| `missing required env var: NAME` at startup | One of the three required variables is unset |
| `Config file not found: …` at startup | The registry path is wrong, or you have not copied the example |
| `unable to open database file` | `WATCHFIRE_DB_PATH`'s directory does not exist — create it |
| The bot sends messages but ignores commands | `TELEGRAM_WEBHOOK_URL` or `TELEGRAM_WEBHOOK_SECRET` is unset, or the chat is not allowed |
| `/api/…` returns `404` | `WATCHFIRE_API_TOKEN` is unset, so the API is disabled |
| An adapter reports an authentication error | Run it by hand (above) to isolate the credential |
| A digest arrives but a tenant is missing | See [`operations.md`](operations.md#no-nightly-digest) |
