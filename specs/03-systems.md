# Watchfire — Systems

> **Status: partial.** The Azure Resource Manager, Hetzner Cloud (API and SSH)
> and Kubernetes adapters are specified here but not yet built, and the
> OpenObserve `obs-metrics` / `obs-alerts` wrappers are stubs. See
> [`README.md`](README.md) for the per-adapter table.

## Purpose

Defines how Watchfire talks to each category of system. Every adapter is exposed to the agent as a CLI wrapper in `apps/agent/bin/`, kept simple enough to drive via the Agent SDK's `Bash` tool. Complex adapters may later migrate to custom SDK tools if token overhead becomes a problem — this is a pure implementation change.

## Design rules

- **CLI-shaped interface.** Every adapter is `apps/agent/bin/<name>` with flags. The agent reads `--help` output, not source code.
- **`--tenant <id>` flag is universal.** Adapters resolve credentials from the tenant registry, never from ambient env.
- **Text output, not JSON blobs.** Human-readable summaries; the agent parses prose faster and cheaper than deep JSON.
- **Pagination + truncation built in.** No adapter returns more than ~200 lines by default; use `--limit` or `--since`/`--until` to drill in.
- **Read-only verbs only.** Each adapter internally refuses mutation, independent of the safety hook. Defense in depth.
- **Observations via stdout trailer.** Adapters that measure something numeric emit machine-readable trailer lines; the runner parses them and persists. See below.

## Observation emission

Adapters run as subprocesses invoked through the `Bash` tool. They hold no
database handle and never learn the `run_id`, so they cannot write to
`observations` themselves — nor should they, since that would make every
adapter side-effecting.

Instead an adapter appends one trailer line per measurement to stdout:

```
___WATCHFIRE_OBS: tenant=<id> source=<adapter> subject=<string> metric=<string> value=<number>
```

The runner watches Bash tool results in the SDK message stream, parses any
trailer lines, and calls `appendObservation` with the `run_id` it already
holds. Properties of this arrangement:

- **Adapters stay pure.** They print; they do not persist. Side effects stay at the edge, in the runner.
- **The agent needs no cooperation.** It does not call a tool, pass a `run_id`, or know observations exist. Nothing is lost when the model is busy or the run truncates mid-sweep.
- **One convention.** `___WATCHFIRE_USAGE:` (04, `correlate-deep`) uses the same trailer shape. Parsers share a module.

Rules:

- Trailers go **last**, after human-readable output, so prose stays readable if a trailer is ever shown verbatim.
- `tenant` is mandatory and comes from the adapter's own `--tenant` flag — the runner does not infer it from the command line.
- `source` is mandatory and is the adapter's own name. The runner sees tool *results*, which do not carry the command that produced them; correlating back to the `tool_use` and parsing a command line would be fragile and would break the moment an adapter is invoked through a shell pipeline. The adapter naming itself is authoritative and costs one field.
- A malformed trailer is **dropped with a log line, never fatal**. Telemetry must not be able to fail a run.
- Values are `REAL`. Booleans are emitted as `0`/`1` (e.g. `chain_valid`).

**Adapters that emit** (as of 2026-07-20):

| Adapter      | subject       | metrics                                        |
| ------------ | ------------- | ---------------------------------------------- |
| `check-ssl`  | hostname      | `days_until_expiry`, `chain_valid`             |
| `check-http` | endpoint name | `response_ms`, `status_code`, `body_bytes`     |

`obs-search`, `obs-streams`, `obs-metrics` and `obs-alerts` emit nothing: they
query a telemetry system that already keeps its own history, and re-recording
counts from it would be storing a measurement of a measurement. They are
declared `emitsObservations: false` so the dashboard renders them as
"no telemetry" rather than as a stale adapter (see 11).

## Adapter: Observability (pluggable)

**Backends**: `openobserve` (current), `signoz` (future). Selected per-tenant in `tenants.yaml`.

Exposed wrappers:

```
apps/agent/bin/obs-search   --tenant <id> --query "<query>" --since <dur> [--limit N]
apps/agent/bin/obs-metrics  --tenant <id> --metric <name> [--resource <id>] --since <dur>
apps/agent/bin/obs-streams  --tenant <id>                       # list available streams
apps/agent/bin/obs-alerts   --tenant <id> --since <dur>         # threshold alerts fired
```

Output: compact summary. For `obs-search`: top-N matching log lines with timestamps, level, service. For `obs-metrics`: min/max/avg/p95 + sparkline characters.

Implementation: `watchfire-core/adapters/observability/{openobserve,signoz}.ts` implement `ObservabilityAdapter` interface:

```ts
interface ObservabilityAdapter {
  search(q: SearchQuery): Promise<LogSummary>;
  metrics(q: MetricsQuery): Promise<MetricsSummary>;
  streams(): Promise<string[]>;
  alerts(since: Duration): Promise<Alert[]>;
}
```

Swap by changing one config line; no prompt/agent changes needed.

## Adapter: Azure Resource Manager

**Credentials**: two SPs (`AZ_SP_ACME`, `AZ_SP_INITECH`), both `Reader`. Each name expands to three env vars: `_TENANT_ID`, `_CLIENT_ID`, `_CLIENT_SECRET`.

No custom wrapper needed — `az` CLI is already the right shape. The agent calls it directly. Tenant selection via a wrapper:

```
apps/agent/bin/az-as  --tenant <id>  <az args...>
```

`az-as` resolves the tenant from the registry, logs in with the correct SP, sets the correct subscription, exports `WATCHFIRE_NAME_PREFIX` and `WATCHFIRE_SIBLING_PREFIXES` (see below), then execs `az`. Examples:

```
apps/agent/bin/az-as --tenant initech  monitor activity-log list --offset 24h
apps/agent/bin/az-as --tenant globex resource list --query "[?starts_with(name, 'Globex')]"
apps/agent/bin/az-as --tenant acme      resource list --query "[?!starts_with(name, 'Globex') && !starts_with(name, 'Umbrella')]"
```

### Shared subscriptions and `name_prefix` (attribution, not isolation)

Where multiple tenants share one Azure subscription (currently acme, globex, umbrella all live in the acme sub), the SP credential sees the entire subscription. The `name_prefix:` field in `tenants.yaml` (see 02) is used to *attribute* resources to the right tenant, not to constrain what the SP can read. The report-only invariant comes from `Reader` RBAC; the prefix filter is a labeling convenience.

`apps/agent/bin/az-as` surfaces this to the agent via two env vars set before `exec`:

- `WATCHFIRE_NAME_PREFIX` — the active tenant's prefix (e.g. `Globex`), or empty for a catch-all tenant.
- `WATCHFIRE_SIBLING_PREFIXES` — space-separated list of *other* tenants' prefixes that share this sub (e.g. `Globex Umbrella` when the active tenant is acme). Empty when the active tenant owns its sub outright (e.g. initech).

The agent's prompt instructs it to:
- For a tenant with a non-empty prefix: filter list-style queries with `[?starts_with(name, '$WATCHFIRE_NAME_PREFIX')]`.
- For a catch-all tenant: filter list-style queries to exclude every sibling prefix.
- For a sub-owner tenant (no siblings): no filtering needed.

This is implemented in the prompt because not every `az` call returns objects with a `name` field, and a wrapper-side filter can't know when filtering is meaningful. The agent is the right place to apply it on a per-call basis.

Read-only enforcement (unchanged by `name_prefix`):
- SP has only `Reader` role (primary boundary; covers the entire shared sub).
- Safety hook regex blocks `az` subcommands outside `show|list|get|query|monitor (metrics|activity-log|log-analytics)` (secondary).
- The `name_prefix` filter is **not** a security boundary; no code anywhere in Watchfire should treat it as one.

## Adapter: Hetzner Cloud

**Credentials**: read-only API token per Hetzner account + SSH key for `watchfire` user on boxes.

### API path

Uses `hcloud` CLI with `HCLOUD_TOKEN` set from tenant config:

```
apps/agent/bin/hcloud-as --tenant <id>  <hcloud args...>

apps/agent/bin/hcloud-as --tenant acme    server list
apps/agent/bin/hcloud-as --tenant initech load-balancer describe lb-prod
```

### SSH path

For things the API doesn't show (disk usage, process state, log tails):

```
apps/agent/bin/ssh-as --tenant <id> --host <host>  <command>

apps/agent/bin/ssh-as --tenant acme --host sql.acme.internal  "df -h /data"
apps/agent/bin/ssh-as --tenant initech --host k8s-01  "systemctl status kubelet"
```

Restricted via:
- Dedicated `watchfire` user on each box.
- `authorized_keys` entry with `command="/usr/local/bin/watchfire-shell"` forced-command, limiting to an allowlist of read-only binaries (`df`, `free`, `uptime`, `journalctl --since`, `tail`, `ps`, `ss`, `systemctl status`, `cat` on whitelisted paths).
- No TTY, no port forwarding (`no-pty,no-port-forwarding,no-X11-forwarding`).

`watchfire-shell` is a ~50-line bash script vetted once and checked into the repo.

## Adapter: Kubernetes (initech)

**Credentials**: kubeconfig with a read-only `ServiceAccount` bound to the built-in `view` ClusterRole, plus a narrow custom ClusterRole that grants `get nodes` (not in `view`) but **explicitly no `secrets`**.

```
apps/agent/bin/kubectl-as --tenant <id>  <kubectl args...>

apps/agent/bin/kubectl-as --tenant initech get pods -A --field-selector=status.phase!=Running
apps/agent/bin/kubectl-as --tenant initech top nodes
apps/agent/bin/kubectl-as --tenant initech describe pod -n api api-7f9c
apps/agent/bin/kubectl-as --tenant initech logs -n api api-7f9c --tail 100
```

Read-only enforcement: RBAC ServiceAccount (primary); safety hook blocks `apply|delete|edit|patch|scale|rollout|drain|cordon|exec` (secondary).

## Adapter: SSL/TLS certificates

No credentials needed — pure outbound network probe.

```
apps/agent/bin/check-ssl --tenant <id> [--host <host>]
```

Default: iterates all `ssl.hosts` for the tenant. Per host, reports:
- Issuer + subject
- Not-before / not-after
- Days until expiry (⚠ if < 14, 🔴 if < 3)
- Chain validity
- SNI / hostname mismatch

Implementation: single `openssl s_client -connect host:443 -servername host </dev/null | openssl x509 -noout -dates -subject -issuer` call per host, parsed into one-line summaries.

## Adapter: HTTP health

No credentials needed unless an endpoint requires auth (then bearer token from tenant config).

```
apps/agent/bin/check-http --tenant <id> [--endpoint <name>]
```

Per endpoint, reports:
- Status code
- Response time (ms)
- Body size
- Optional: body contains/matches expected marker (configurable per endpoint)
- Comparison vs. last nightly run for anomaly detection ("usually 120ms, now 2100ms")

Stored baselines in the memory SQLite DB so "unusually slow" can be flagged.

## Adapter: Azure DevOps

Per-tenant ADO org + read-only PAT (scopes: Build Read + Code Read). No Azure
RBAC involved — auth is a PAT, separate from `az-as`.

```
apps/agent/bin/check-ado --tenant <id> [--project <name>]
```

For the tenant's project: lists pipeline/build definitions, and for each fetches
the latest completed run on its default branch. Reports:
- 🔴 pipelines whose latest default-branch run `result = failed` — with build
  number, finish time, triggering commit, and the canonical `resource_id`
  (`ado.<tenant>.<project>.<pipeline-slug>`) for the agent to emit as a
  `build-red` warn finding.
- All other pipelines (`succeeded`, `canceled`, `partiallySucceeded`, or no
  runs) as one-line info notes — **not** findings.

Read-only ADO Build REST API. Emits no observations: "is the build red" is a
finding, not a time series. The "red for N days" signal comes from the finding
lifecycle, not from the adapter — it is stateless and reports only today's
state, and Watchfire's memory ages the finding until the build goes green.

## Summary: what the agent sees

At prompt time, only the `bin/` directory is on PATH. The agent's system prompt lists the wrappers and one-line usage for each (kept short for cache efficiency). Native CLIs like `az`, `hcloud`, `kubectl` are only available via their `*-as` wrappers; direct invocation without a tenant flag fails closed.

```
/usr/local/bin/
  obs-search     obs-metrics   obs-streams  obs-alerts
  az-as          hcloud-as     kubectl-as   ssh-as
  check-ssl      check-http    check-ado
```

## Adding a new adapter

1. Decide: does it need pluggable backends (like observability) or is it a single-backend wrapper (like Azure)?
2. Add adapter module under `watchfire-core/adapters/<name>/`.
3. Add `apps/agent/bin/<name>` wrapper with `--tenant` flag.
4. Extend `tenants.yaml` schema for its per-tenant config.
5. Add deny patterns to the safety hook in the agent runner.
6. Document here in a new `## Adapter:` section.
7. Mention in the nightly prompt (`04-nightly.md`) so the agent knows to use it.
