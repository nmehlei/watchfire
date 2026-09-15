# Watchfire — Overview

A fire kept burning through the night, so that someone sees what is wrong.

An autonomous SRE agent that keeps an eye on all systems across a small portfolio of tenants on behalf of a single operator. Produces a combined nightly digest and pages on critical realtime signals. Report-only — never touches production.

## Goals

- Catch warnings, errors, and anomalies across all tenants before the operator does.
- Correlate signals across layers (logs, metrics, traces, cloud resources, app health) to suggest likely root causes.
- Respect cross-tenant resource sharing: one finding, correctly tagged with all affected tenants.
- Surface new issues prominently while keeping ongoing ones visible so they aren't forgotten.
- Stay under **€5/month total** (infra + API tokens).
- Stay pluggable at the observability layer — today OpenObserve, tomorrow maybe SigNoz.

## Non-goals

- **Not a replacement for the observability stack.** OpenObserve/SigNoz still do storage, dashboards, and threshold alerting. Watchfire reads from them.
- **Not sub-second paging.** Watch reacts in seconds-to-minutes, not milliseconds. Use native alert routing for true emergencies.
- **Not a remediator.** No writes, no restarts, no deploys. Ever. (See `08-safety.md`.)
- **Not multi-user.** One operator, one Telegram chat, one pair of eyes.
- **Not a chatbot.** Watchfire speaks when she has something to say.

## Principles

- **Read-only by construction.** Credentials are scoped to reader roles; a command filter blocks mutating verbs as belt-and-suspenders.
- **Tenant-tagged, not tenant-siloed.** Single codebase, single agent run, findings tagged with the tenants they touch.
- **Pluggable data sources.** The agent never talks to OpenObserve directly — only to an `obs-*` CLI that hides the backend.
- **Stateful but lean.** Watchfire tracks finding lifecycle (new / ongoing / resolved) so ongoing issues stay visible without re-alarming. Old issues that escalate surface back to the top.
- **Cheap model by default.** Haiku 4.5 + prompt caching + bounded turn count. Escalate to Sonnet only for specific hard sub-tasks.
- **Living spec.** These docs are the source of truth for Watchfire's behavior. Prompts reference them; changes to behavior start here.
- **Cheap to kill, cheap to rebuild.** Stateless except for one SQLite file + transcripts; full redeploy is `git pull && docker compose up -d --build`.

## Success criteria

After two weeks of running:

1. Watchfire produced a digest every night, on time, for every tenant.
2. At least one finding caught by Watchfire would have been missed or delayed otherwise.
3. No false-positive pages that woke the operator for nothing.
4. Zero mutating actions attempted (verified via transcript audit).
5. Total monthly cost (infra + API) under €5.

## Prior art

**HolmesGPT** (CNCF sandbox, Apache 2.0) is the closest existing tool to Watchfire. It's a production-grade read-only SRE agent with broad toolset support, operator mode for scheduled checks, and multi-LLM flexibility. Before starting Watchfire, evaluate HolmesGPT for your use case.

Watchfire is being built anyway because:
- **Non-Kubernetes hosting.** HolmesGPT's operator mode (scheduled checks) runs in Kubernetes. Our infra is Docker-on-VPS; running k3s just to host the watcher is overhead.
- **Tight cost target.** HolmesGPT's default prompts + Sonnet-tier models run €20–50/month. Watchfire targets €4/month by defaulting to Haiku, aggressive caching, and tight turn budgets.
- **Cross-tenant resource graph.** Our `affects` expansion for shared resources (e.g. MSSQL on acme used by globex and initech) is specific enough that bolting it onto HolmesGPT's toolset model is awkward.
- **Telegram-first, single-operator ergonomics.** HolmesGPT targets Slack and PagerDuty; our surface is one person, one Telegram channel.

We will, however, steal shamelessly from HolmesGPT's design where it makes sense:
- Structured tool result format (not free-form text) for better agent reasoning and cheaper transcripts.
- Server-side filtering and output transformers to keep big payloads out of context windows.
- YAML-based toolset definitions for cheap extensibility.

## Future open-sourcing

Design the core to be clean and adapter-driven (we already are), but keep Watchfire single-repo and private for v1. After 2–3 months of real operation, if the core seems genuinely useful beyond our setup, extracting it is a weekend of work. Designing for hypothetical external users on day 1 is effort without payoff.

## Tenants (see `02-tenants.md` for detail)

| Tenant   | Role                                    |
| -------- | --------------------------------------- |
| acme      | Personal base / platform for others     |
| globex | Own app, runs partly on acme infra       |
| initech  | Startup involvement, uses acme resources |
| umbrella   | Client, standalone                      |

acme acts as a shared substrate for globex and initech. Findings on acme resources propagate to dependent tenants via the `affects` list on each resource.

## Budget breakdown

| Item                          | Monthly cost  |
| ----------------------------- | ------------- |
| Netcup VPS                    | €0 (existing) |
| Cloudflare Tunnel             | €0            |
| GitHub (private repo)         | €0            |
| Telegram bot                  | €0            |
| healthchecks.io               | €0            |
| Anthropic API (Haiku + cache) | ~€3–4         |
| **Total**                     | **~€4**       |
