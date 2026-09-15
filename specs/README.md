# Specifications

These documents are the source of truth for how Watchfire behaves. Changes start
here: edit the spec, get it reviewed, then change the code — in separate commits.

Status reflects what is implemented today, not what is designed.

| Spec | Subject | Status |
|---|---|---|
| [`00-overview.md`](00-overview.md) | Goals, principles, budget | reference |
| [`01-architecture.md`](01-architecture.md) | Components, run loop, deployment | implemented |
| [`02-tenants.md`](02-tenants.md) | Tenant registry, resource graph | implemented |
| [`03-systems.md`](03-systems.md) | Adapter contracts per system type | **partial** |
| [`04-nightly.md`](04-nightly.md) | Nightly sweep, prompt, finding extraction | implemented |
| [`05-watch.md`](05-watch.md) | Webhook intake, triage, verdicts | implemented |
| [`06-memory.md`](06-memory.md) | SQLite schema, lifecycle, retention | implemented |
| [`07-reporting.md`](07-reporting.md) | Finding rendering, digests, pages | implemented |
| [`08-safety.md`](08-safety.md) | Safety hook, forced-command shell, audit | implemented |
| [`10-telegram-control.md`](10-telegram-control.md) | Telegram command surface | implemented |
| [`11-mcp.md`](11-mcp.md) | MCP and REST read surfaces | implemented |
| [`12-dashboard.md`](12-dashboard.md) | Next.js dashboard | implemented |

`09-ops.md` became [`docs/operations.md`](../docs/operations.md): it is an
operator guide, not a specification.

## What "partial" means

`03-systems.md` specifies more adapters than are built.

| Adapter | Status |
|---|---|
| OpenObserve — `obs-search`, `obs-streams` | shipped |
| OpenObserve — `obs-metrics`, `obs-alerts` | stubbed |
| SSL/TLS certificates — `check-ssl` | shipped |
| HTTP health — `check-http` | shipped |
| Azure DevOps — `check-ado` | shipped |
| Azure Resource Manager | specified, not built |
| Hetzner Cloud (API and SSH) | specified, not built |
| Kubernetes | specified, not built |

The specs run ahead of the code on purpose: an adapter is designed before it is
built. This table is what keeps that honest.
