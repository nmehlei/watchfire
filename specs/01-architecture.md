# Watchfire — Architecture

## Shape

One long-running container, one codebase, one image. Internal scheduler handles nightly; HTTP server handles Watch; SQLite tracks everything.

```
┌─────────────────────────────────────────────────────────────────┐
│              Netcup VPS `ops-host` (shared host)                    │
│                                                                 │
│   Nginx Proxy Manager ──► ┌──────────────────────────────┐      │
│   (TLS, routes            │        iris (container)      │      │
│    iris.example.com       │  ┌────────────────────────┐  │      │
│    → iris:8080)           │  │  HTTP server (Watch)   │  │      │
│                           │  │  node-cron (Nightly)   │  │      │
│                           │  │  startup catch-up      │  │      │
│                           │  └──────────┬─────────────┘  │      │
│                           │             │                │      │
│                           │     ┌───────▼──────┐         │      │
│                           │     │  iris-core   │         │      │
│                           │     │  (shared)    │         │      │
│                           │     └───────┬──────┘         │      │
│                           │             │                │      │
│                           │  SQLite: findings + runs     │      │
│                           │  JSONL: transcripts          │      │
│                           └──────────────┬───────────────┘      │
└──────────────────────────────────────────┼──────────────────────┘
                                           │
                              Telegram • Anthropic • OpenObserve
```

## Components

One long-running container, three concerns inside it: an HTTP server for Watch, an in-process scheduler for Nightly, and a shared core that both use. No systemd timers on the host; Portainer sees one service.

### `iris-core` (library)

Shared code used throughout the process.

- **Tenant registry** — reads `apps/agent/config/tenants.yaml`, resolves per-tenant credentials from env/secrets.
- **Observability adapters** — `openobserve.ts`, `signoz.ts`; both implement the same interface used by the `obs-*` CLI wrappers.
- **System adapters** — thin CLI wrappers around `az`, `hcloud`, `kubectl`, SSH, SSL/HTTP probes. Each reads tenant from `--tenant` flag and looks up creds from the registry.
- **Memory (SQLite)** — mounted volume. Tables: `findings` (lifecycle), `runs` (execution history, see below), `baselines` (HTTP latency, etc.).
- **Telegram notifier** — one bot, one chat, two message styles (🌙 digest, 🚨 page).
- **Agent runner** — wraps Claude Agent SDK `query()` with the common safety hook, tool allow-list, transcript capture, and prompt caching.

### The `iris` process

The container runs a single Node process that does three things concurrently:

1. **HTTP server** on `:8080` for Watch webhooks and `/health`.
2. **Cron scheduler** (`node-cron`) that triggers `runNightly()` on `IRIS_NIGHTLY_CRON` (default `30 2 * * *`, daily) Europe/Berlin.
3. **Startup catch-up** that checks the `runs` table — if the last successful nightly is older than `IRIS_CATCHUP_STALE_HOURS` (default 24h), it fires one immediately (covers deploys, crashes, OOM kills during the cron window). A deployment running a sparser cron must raise this to match, or a restart between scheduled runs triggers an unplanned extra sweep.

All three share one tenant registry, one SQLite handle, one Telegram client, one Anthropic client.

### Nightly behavior (`runNightly()`)

1. Insert `runs` row with `type='nightly'`, `started_at=now`, `trigger='cron'` (or `'catchup'`).
2. Load tenant registry + resource graph.
3. Load last 30 days of findings from memory.
4. Run agent with the nightly prompt (see `04-nightly.md`): sweep all tenants, correlate, produce findings.
5. For each finding: fingerprint → check memory → classify as 🆕 new, 🔁 ongoing, or ✅ resolved.
6. Format digest with new findings on top, ongoing below, resolved at the bottom.
7. Post digest to Telegram.
8. Update `runs` row: `completed_at`, `status`, `finding_count`, `tokens_{in,out,cached}`, `transcript_path`.
9. Ping healthchecks.io heartbeat.
10. Archive transcript to `/var/lib/iris/transcripts/`.

**Model**: `claude-haiku-4-5` with prompt caching on system prompt + tenant config (reused every turn).
**Budget**: ~20 agent turns, ~€0.10–0.15 per night.

### Watch behavior (HTTP endpoints)

- `POST /webhook/openobserve` — receives OO alert, validates signature, matches alert to tenant(s), spawns a short agent run via `runWatch(alert)`.
- `POST /webhook/generic` — reserved for future sources (Azure Monitor, Stripe, etc.).
- `GET /health` — for tunnel + healthchecks.

`runWatch(alert)` inserts a `runs` row with `type='watch'`, `trigger='webhook'`, runs the triage prompt (~8 turns, 60s wallclock cap), decides page/defer/drop, updates the row. Pages go out as 🚨 Telegram messages.

**Model**: `claude-haiku-4-5`, same caching.
**Rate limit**: max 6 pages/hour (configurable) to prevent runaway alert storms turning into token storms.

## Run tracking

SQLite `runs` table, queried both on startup (catch-up) and on demand (cost/drift audits):

```sql
CREATE TABLE runs (
  id              INTEGER PRIMARY KEY,
  type            TEXT NOT NULL,       -- 'nightly' | 'watch' | 'manual'
  trigger         TEXT NOT NULL,       -- 'cron' | 'catchup' | 'webhook' | 'manual'
  started_at      TEXT NOT NULL,       -- ISO 8601
  completed_at    TEXT,                -- NULL while running or if crashed
  status          TEXT,                -- 'success' | 'error' | 'crashed'
  finding_count   INTEGER,
  tokens_in       INTEGER,
  tokens_out      INTEGER,
  tokens_cached   INTEGER,
  error           TEXT,
  transcript_path TEXT
);
CREATE INDEX idx_runs_type_started ON runs(type, started_at DESC);
```

**Startup sequence**:
1. Mark any `completed_at IS NULL` row as `status='crashed'` (it didn't finish last time).
2. Query last successful nightly. If older than `IRIS_CATCHUP_STALE_HOURS` (default 24h) → trigger a catch-up run before entering normal loop.
3. Start HTTP server + cron.

Monthly cost self-check: `SELECT SUM(tokens_in)*1.0/1e6, SUM(tokens_out)*5.0/1e6 FROM runs WHERE started_at > date('now', '-30 days')`.

## Finding lifecycle

Each finding is fingerprinted by `(resource_id, issue_class)` and stored in the memory DB:

| State     | Meaning                                 | Digest display             |
| --------- | --------------------------------------- | -------------------------- |
| 🆕 new    | First time seen, or re-seen after resolution | Top of digest, full detail |
| 🔁 ongoing | Seen in a previous run, still present  | Middle, condensed, age shown ("8th night") |
| ✅ resolved | Previously seen, not in today's sweep  | Bottom, one line each      |
| ⚠️ escalating | Ongoing + severity increased         | Back to top, with delta     |

Findings auto-age out of "resolved" display after 7 days.

## Cross-tenant dependencies

Each resource in `apps/agent/config/resources.yaml` declares:

```yaml
- id: sql.acme.internal
  type: mssql-server
  owner: acme
  affects: [acme, globex, initech]
```

When the agent reports a finding, it references resource IDs. A post-processor expands each finding's `affects` set into a tenant-tag list displayed in the digest:

```
🆕 🔴 [acme, globex, initech] Disk at 94% on sql.acme.internal
   Evidence: ...
   Likely cause: ...
```

This keeps the agent's prompt simple (it just names resources) while still producing correct cross-tenant impact analysis.

## Hosting

**Primary host: `ops-host.example.com`** — the existing Netcup VPS that already runs Portainer, Nginx Proxy Manager (NPM), OpenObserve, SigNoz, and several other ACME services. Watchfire is a new container alongside them, managed by the same Ansible playbooks used across the rest of your-iac-repo.

TLS termination and routing are handled by NPM, not a Cloudflare Tunnel. One proxy host rule in the NPM UI maps `iris.example.com` → `iris:8080`. The Watchfire container joins the existing `nginx-proxy-manager_default` Docker network so NPM can reach it by service name.

Compose shape (rendered by Ansible from a Jinja2 template in your-iac-repo):

```yaml
services:
  iris:
    image: ghcr.io/your-org/watchfire:{{ iris_image_tag }}
    restart: unless-stopped
    volumes:
      - iris-data:/var/lib/iris                                  # SQLite + transcripts
      - /etc/iris/secrets/iris.env:/etc/iris/secrets/iris.env:ro
    env_file: /etc/iris/secrets/iris.env
    networks:
      - default
      - nginx-proxy-manager_default
    expose:
      - "8080"

networks:
  nginx-proxy-manager_default:
    external: true

volumes:
  iris-data:
```

No `cloudflared` sidecar. No Cloudflare account.

**DNS**: one CNAME record `iris.example.com` → `ops-host.example.com`, managed by Terraform via the shared `modules/azure/cname_record` module in your-iac-repo. The DNS zone itself already exists in `shared-app-plan-RG`.

**Migration to another host**: export the `iris-data` volume, copy `/etc/iris/`, point the Ansible inventory at the new host, repoint the NPM proxy rule. One evening of work.

## Publishing & deployment

**Two-repo model:**

| Repo        | Home                                 | Owns                                                       |
| ----------- | ------------------------------------ | ---------------------------------------------------------- |
| **Watchfire**    | GitHub (`your-org/Watchfire`, private)    | Source, tests, Dockerfile, `apps/agent/config/tenants.yaml` + `apps/agent/config/resources.yaml`, CI workflow (image build + push) |
| **your-iac-repo** | Azure DevOps (`your-org/your-iac-repo`)    | `solutions/iris/{terraform,ansible,deploy.sh}` — infra + ansible-vault secrets, local `deploy.sh` |

**Image flow:**

1. Push / merge to Watchfire `main` → GitHub Actions runs `npm ci && lint && typecheck && test && docker build` → pushes `ghcr.io/your-org/watchfire:sha-<git-sha>` + `:latest`. The image job `needs: test`, so nothing reaches ghcr unless lint, typecheck, and the full suite pass.
2. Tag a release (`v0.1.0`) in Watchfire → CI additionally pushes `:0.1.0`.
3. **Code-only changes deploy themselves.** A systemd timer on ops-host (`iris-autoupdate.timer`) polls ghcr, and when the tag named by `iris_image` resolves to a new digest it runs `docker compose pull && up -d` and health-checks the result. Merge to `main` → live within one poll interval.
4. **Config / secret changes stay manual.** The operator runs `./deploy.sh ansible`, which re-renders the env file from ansible-vault and restarts. Only this path can change secrets.

GitHub Actions scope is intentionally narrow: **image build + push only**. No Azure auth, no Terraform apply, no SSH, no deploy trigger. The only secret used is the default `GITHUB_TOKEN` (automatic, scoped per-run, used for `ghcr.io` push). Everything else lives with the operator.

**Why pull, not push.** Auto-deploy is deliberately pull-based. For GitHub Actions to deploy directly it would need an SSH key to ops-host or the ansible-vault password, which would make a GitHub compromise a path to root on ops-host and to every Watchfire secret (Anthropic key, Telegram token, OpenObserve credentials). Polling from ops-host gets the same convenience with no inbound access and no credential in GitHub. The split in steps 3–4 is what makes this safe: the automatic path only ever swaps a container image, and never touches secrets.

**Pinning disables auto-update, for free.** Set `iris_image` to an immutable `sha-<git-sha>` tag and the timer's pull becomes a permanent no-op — the tag never moves. No separate "disable" switch to remember.

Workflow sketch (`.github/workflows/build.yml`):

```yaml
on:
  push:
    branches: [main]
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: npm run lint && npm run typecheck && npm run test
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          push: true
          tags: |
            ghcr.io/${{ github.repository_owner }}/watchfire:${{ github.sha }}
            ghcr.io/${{ github.repository_owner }}/watchfire:latest
```

Operator deploy loop — needed only for config, secret, or compose changes; code ships itself:

```bash
cd your-iac-repo/solutions/iris
./deploy.sh            # terraform + ansible
./deploy.sh terraform  # just the DNS CNAME
./deploy.sh ansible    # just the playbook against ops-host
```

The script follows the same convention as `solutions/bugsink/deploy.sh` — `.env` for non-sensitive toggles, ansible-vault for secrets, `terraform.tfvars` for any TF overrides.

**Auto-update timer** (installed by the playbook, on ops-host):

```bash
systemctl status iris-autoupdate.timer     # is it armed, when does it next fire
journalctl -u iris-autoupdate -n 50        # what did the last runs do
systemctl start iris-autoupdate.service    # force a check right now
systemctl disable --now iris-autoupdate.timer   # stop auto-updating
```

**Rollback**: set `iris_image` in `group_vars/all.yml` to an older `sha-<git-sha>` and re-run `./deploy.sh ansible`. Under a minute — and because that tag is immutable, it also pins the deployment until you move it back to `:latest`.

## Secret management (ansible-vault)

Secrets live in **`solutions/iris/ansible/group_vars/secrets.yml`**, encrypted with `ansible-vault`. Matches every other your-iac-repo solution; no per-solution tooling drift.

**Files:**

```
solutions/iris/ansible/group_vars/
  all.yml                 # non-sensitive: image tag, install dir, domain
  secrets.yml             # ansible-vault encrypted; gitignored locally if needed
  secrets.yml.example     # committed template with placeholder values
```

**Plaintext shape** (`secrets.yml.example`, before encryption):

```yaml
---
# Watchfire secrets — copy to secrets.yml, fill in, and:
#   ansible-vault encrypt group_vars/secrets.yml

anthropic_api_key: "sk-ant-..."
telegram_bot_token: "123456:AAF..."
telegram_chat_id: "8293216013"
openobserve_url: "https://openobserve.example.com"
openobserve_user: "iris@example.com"
openobserve_password: "..."

# SSH password for ops-host (reused across your-iac-repo solutions)
vault_netcup_root_password: "..."
```

**Rotation** matches the bugsink / housefinder pattern:

```bash
cd your-iac-repo/solutions/iris/ansible
./edit-secrets.sh        # ansible-vault edit, opens $EDITOR
cd ..
./deploy.sh ansible      # re-deploy with rotated secret
```

**Delivery to the container:**

1. Ansible decrypts `secrets.yml` at deploy time.
2. Renders `templates/iris.env.j2` → `/etc/iris/secrets/iris.env` on ops-host (mode 600, root-owned).
3. docker-compose references `/etc/iris/secrets/iris.env` via `env_file`.
4. Container reads env at startup. Secrets stay in process memory — no disk echo beyond the env file itself.

The `/etc/iris/secrets/` path is covered by the safety hook's secret-read hard-block (spec 08), so the agent can't `cat` its own env.

**What we no longer need** (deviation from spec-0):

- Azure Key Vault — dropped. ansible-vault covers the at-rest problem and matches your-iac-repo.
- SOPS — dropped.
- GitHub OIDC federation to Azure — dropped. GitHub Actions only pushes images.
- `iris-bootstrap` SP + `iris-github-oidc` SP — dropped.
- `iris-reader-main` / `iris-reader-initech` SPs — deferred until the Azure adapter lands; then they become entries in `all.yml` + `secrets.yml` following the established pattern.
- `/etc/iris/bootstrap.env` — dropped. Container reads its env directly.

## Alerting (dead-man switch)

Watchfire emits an OpenTelemetry heartbeat metric at the end of each successful nightly (`iris.nightly.completed`, tagged `status=success|truncated`, `run_id`). SigNoz — which already runs on ops-host — is configured with one alert: if no heartbeat is seen in 25 hours, it emails the operator.

Replaces the previous design of an external `healthchecks.io` dead-man switch. One less external service; one alerting surface already under our control.

**Known gap**: SigNoz runs on the same host as Watchfire. If ops-host goes fully dark, SigNoz dies with it and the dead-man never fires. Acceptable for v1 (single-operator, report-only); an external ping (healthchecks.io free tier or equivalent) can be added later if the risk materializes. See spec 09 §Known limitations.

Wiring (Otel exporter endpoint + alert rule) lives in `docs/operations.md §Alerting`.

## Bootstrap (one-time, ~15 min)

Prerequisites on the operator laptop: `az login` (TC sub), `terraform`, `ansible`, SSH access to ops-host.

Steps:

1. Create the Watchfire repo on GitHub (`your-org/Watchfire`, private) and push.
2. GitHub Actions runs → builds and pushes `ghcr.io/your-org/watchfire:latest` automatically.
3. In `your-iac-repo`:

   ```bash
   cd solutions/iris
   cp .env.example .env                                     # fill AZURE_SUBSCRIPTION_ID=TC, etc.
   cp ansible/inventory.yml.example ansible/inventory.yml   # fill ops-host SSH info
   cp ansible/group_vars/secrets.yml.example ansible/group_vars/secrets.yml
   # fill secrets.yml with real values
   ansible-vault encrypt ansible/group_vars/secrets.yml
   export ANSIBLE_VAULT_PASSWORD=...
   ./deploy.sh
   ```

4. In NPM UI on ops-host: add a proxy host `iris.example.com` → `iris:8080` (HTTPS, "Force SSL", "Cache Assets").
5. Verify: `https://iris.example.com/health` returns `{"ok":true}`; first 🌙 lands in Telegram after the catch-up nightly fires.

After step 4, the operator touches the system only through `./deploy.sh` and the NPM UI.

## Known limitations

- **Co-located on ops-host with OpenObserve, SigNoz, and NPM.** If the Netcup VPS dies, Watchfire can't tell you OpenObserve died — and the SigNoz-based dead-man check lives on the same host, so it can't either. Acceptable for v1; add an external ping (healthchecks.io free tier or similar) if this gap starts mattering.
- **Single point of failure.** No redundancy. Acceptable for report-only at this scale.
- **No realtime for Azure-native signals yet.** Until Azure Monitor action groups are wired to `/webhook/generic`, those only surface in the nightly digest.
- **Haiku reasoning ceiling.** If Haiku can't correlate cross-tenant issues well enough, specific sub-tasks escalate to Sonnet 4.6 (3× cost). Upgrading the default model to Sonnet would blow the €5 budget; decision point if quality is insufficient after 2 weeks.

## Open questions

- Whether the nightly prompt should be one big sweep or N per-tenant sub-agents that report up to a synthesizer. Per-tenant sub-agents give cleaner isolation but use more tokens. Default plan: one sweep, revisit if digest quality suffers.
- Transcript retention: forever (cheap, audit-friendly) or rotate after 90 days. Default: keep forever, revisit when disk hurts.
