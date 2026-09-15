# OpenObserve

## Purpose

The primary observability backend — logs, metrics, traces, alerts. Spec refs: [`02-tenants.md`](../../specs/02-tenants.md), [`03-systems.md` §Observability](../../specs/03-systems.md), [`05-watch.md`](../../specs/05-watch.md).

## Env vars

| Name | Description |
|---|---|
| `OPENOBSERVE_URL` | Base URL, e.g. `https://openobserve.ops-host.example.com`. |
| `OPENOBSERVE_USER` | Email of the Watchfire user. |
| `OPENOBSERVE_PASSWORD` | Password for that user. |

A single shared credential serves all tenants. See "Layout" below for how tenant separation actually works.

## Layout (current reality)

Reality on the operator's instance, as of 2026-04-27:

- One org in active use: `default`. (Two empty custom orgs `Initech` / `Umbrella` exist — aspirational; ignore.)
- Each tenant has at least one stream named after itself: `acme`, `globex`, `initech`, `umbrella`.
- Tenants additionally emit prefix-named streams (`umbrella_logs`, `globex_notes_created`, …) plus generic infra streams (`apiserver_*`, `aspnetcore_*`, `azure_app_service_*`, …) that aren't tenant-scoped.

Implication for the Watchfire observability adapter:

- The OO API path is `/api/default/<stream>/...` for **all** tenants.
- A "give me logs for tenant X" query targets either the canonical `<tenant>` stream, or a `<tenant>_*` prefix, or filters by an attribute inside a generic stream. The adapter picks per query — the registry only stores the canonical stream name.

## Spec drift

> ⚠ This contradicts [`specs/02-tenants.md` §Credential scopes](../../specs/02-tenants.md) in two places:
>
> 1. Spec lists per-tenant `OBS_TOKEN_*` tokens. Reality: one shared `OPENOBSERVE_USER`/`OPENOBSERVE_PASSWORD`.
> 2. Spec models `stream: <tenant>` as the only OO-related field per tenant. Reality needs an `org:` field too (default value `default`).
>
> A spec PR should retire `OBS_TOKEN_*` and add `org:` to the OO block. Until then, this doc is authoritative for ops.

## One-time setup

The credential is already set up — `watchfire@<your-domain>` (or whichever account is in `.env`). For a clean install on a new operator instance:

1. Log in to `$OPENOBSERVE_URL` as admin.
2. **IAM → Users → Add User**:
   - Email: `watchfire@<your-domain>`.
   - Strong password (`openssl rand -hex 24`).
   - Role: read-only at the org level (`Viewer`) for the `default` org.
3. Drop email + password into `.env` as `OPENOBSERVE_USER` / `OPENOBSERVE_PASSWORD`.

(Splitting tenants into separate orgs is a future hardening step — not blocking.)

## Script

[`scripts/setup/openobserve-verify.sh`](../../scripts/setup/openobserve-verify.sh) — probes the credential and confirms the four canonical tenant streams (`acme`, `globex`, `initech`, `umbrella`) exist in the `default` org. Pass `--org <id>` to check a different org.

## Verify

```bash
./scripts/setup/openobserve-verify.sh
```

Expected:

```
credential OK
:: GET https://.../api/default/streams

checking tenant streams in org=default:

  acme        OK (stream "acme" present, type=logs)
  globex   OK (stream "globex" present, type=logs,traces)
  initech    OK (stream "initech" present, type=traces,logs)
  umbrella     OK (stream "umbrella" present, type=logs,traces)
```

## Rotation

[`docs/operations.md` §Rotation](../operations.md). Change the password in the OO UI, update `OPENOBSERVE_PASSWORD` in vault, redeploy. Strict cutover (no co-existence on a single user account).
