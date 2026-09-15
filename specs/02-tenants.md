# Watchfire — Tenants

## Purpose

Defines which tenants Watchfire watches, which systems belong to each, how credentials are scoped, and how cross-tenant resource dependencies are modeled.

## Schema

Two files drive tenant config:

```
apps/agent/config/
  tenants.yaml     # one entry per tenant, lists systems + credential refs
  resources.yaml   # only shared/cross-tenant resources, for affects expansion
```

Secrets never live in these files — only env var *names* pointing into `.env` (loaded by Docker Compose, which in turn reads from `/etc/iris/secrets` on the host).

### Field semantics

- **`observability.org`** — OpenObserve organization the tenant's data lives in. Currently `default` for all tenants; reserved as a per-tenant field so individual tenants can be moved into dedicated orgs later without a schema change.
- **`observability.stream`** — Canonical stream name for tenant-scoped queries. The adapter may also query streams matching `<stream>_*` and certain generic streams; this field is the *anchor*, not an exhaustive list.
- **`azure.name_prefix`** — Optional. PascalCase resource-name prefix used to attribute Azure resources to a tenant when multiple tenants share one subscription. Empty / null means "catch-all" (everything not matching another tenant's prefix). **Attribution-only — not a security boundary.** The SP credential sees the entire subscription; this filter merely tags findings with the right tenant. The report-only invariant comes from `Reader` RBAC, never from the prefix.
- **`azure_devops.org_url`** — Full Azure DevOps org URL, e.g. `https://dev.azure.com/<org>`. Each tenant has its own ADO org.
- **`azure_devops.project`** — ADO project name within the org.
- **`azure_devops.pat_env`** — Name of the env var holding the tenant's read-only PAT (scopes: Build Read + Code Read). The value never lives in `tenants.yaml`. ADO auth is a PAT, entirely separate from the Azure `Reader` SP used by `az-as`; the report-only invariant comes from the PAT's read-only scope.

### `tenants.yaml` shape

```yaml
tenants:
  - id: <slug>
    display_name: <string>
    systems:                            # which adapters apply (see 03-systems.md)
      - observability: { org: ..., stream: ... }
      - azure:        { subscription_id: ..., tenant_id: ..., sp_env: ..., name_prefix: ... }
      - azure_devops: { org_url: ..., project: ..., pat_env: ... }
      - hetzner:      { account: ..., token_env: ..., ssh_hosts: [...] }
      - kubernetes:   { kubeconfig_env: ..., context: ... }
      - http_health:  { endpoints: [ { name, url } ] }
      - ssl:          { hosts: [...] }
```

## Tenants

### acme — personal base, shared platform

```yaml
- id: acme
  display_name: ACME
  systems:
    - observability:
        org: default
        stream: acme
    - azure:
        subscription_id: <acme-sub-id>     # shared with globex + umbrella
        tenant_id: <acme-aad-tenant>
        sp_env: AZ_SP_ACME                 # shared SP, see below
        # name_prefix omitted → acme is the catch-all in the shared sub
    - hetzner:
        account: acme
        token_env: HCLOUD_TOKEN_ACME
        ssh_hosts: [sql.acme.internal, web.acme.internal, ...]
    - ssl:
        hosts: [acme.example, mail.acme.example, ...]
    - http_health:
        endpoints:
          - { name: public-site, url: https://acme.example }
```

acme owns the MSSQL server that globex (and occasionally initech) use. acme also hosts the Azure resources for globex and umbrella inside its own subscription — those tenants distinguish themselves via `name_prefix`.

### globex — own app

```yaml
- id: globex
  display_name: Globex
  systems:
    - observability:
        org: default
        stream: globex
    - azure:
        subscription_id: <acme-sub-id>     # shares the acme subscription
        tenant_id: <acme-aad-tenant>
        sp_env: AZ_SP_ACME                 # same SP as acme
        name_prefix: Globex             # PascalCase resource-name prefix
    - ssl:
        hosts: [globex.app, api.globex.app]
    - http_health:
        endpoints:
          - { name: api,   url: https://api.globex.app/health }
          - { name: web,   url: https://globex.app }
```

No dedicated Hetzner; MSSQL dependency on acme is declared in `resources.yaml`. Azure resources live inside the acme sub, identified by the `Globex` prefix on resource names.

### umbrella — client

```yaml
- id: umbrella
  display_name: Umbrella
  systems:
    - observability:
        org: default
        stream: umbrella
    - azure:
        subscription_id: <acme-sub-id>     # shares the acme subscription
        tenant_id: <acme-aad-tenant>
        sp_env: AZ_SP_ACME
        name_prefix: Umbrella               # PascalCase resource-name prefix
    - ssl:
        hosts: [umbrella.example, ...]
    - http_health:
        endpoints:
          - { name: main, url: https://umbrella.example }
```

Standalone client engagement, no cross-tenant data dependencies. Azure resources live inside the acme sub, identified by the `Umbrella` prefix on resource names.

### initech — startup, separate Azure tenant

```yaml
- id: initech
  display_name: Initech
  systems:
    - observability:
        org: default                       # may move to dedicated org later
        stream: initech
    - azure:
        subscription_id: <initech-sub-id>
        tenant_id: <initech-aad-tenant>    # ← different AAD tenant
        sp_env: AZ_SP_INITECH              # ← separate SP
        # name_prefix omitted → initech owns its sub entirely; no intra-sub filtering needed
    - hetzner:
        account: initech
        token_env: HCLOUD_TOKEN_INITECH
        ssh_hosts: [k8s-01.initech, k8s-02.initech, ...]
    - kubernetes:
        kubeconfig_env: KUBECONFIG_INITECH
        context: initech-prod
    - ssl:
        hosts: [initech.io, api.initech.io]
    - http_health:
        endpoints:
          - { name: api, url: https://api.initech.io/health }
          - { name: web, url: https://initech.io }
```

## Credential scopes

| Credential                 | Principal                                | Role / scope                                                                  |
| -------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| `AZ_SP_ACME_*`              | SP `iris-reader-acme` in acme AAD tenant   | `Reader` on the single acme subscription (which also hosts globex + umbrella) |
| `AZ_SP_INITECH_*`          | SP `iris-reader-initech` in initech AAD  | `Reader` on the initech subscription                                          |
| `HCLOUD_TOKEN_*`           | Hetzner API token, per account           | Read-only (Hetzner's token-level setting)                                     |
| `KUBECONFIG_INITECH`       | Kubeconfig with SA token                 | `view` ClusterRole + `get nodes` (no `get secrets`)                           |
| SSH keys                   | One key per Hetzner account              | Dedicated user `iris`, `iris-shell` forced-command; no sudo, no TTY           |
| `OPENOBSERVE_USER` / `OPENOBSERVE_PASSWORD` | Single shared user across all tenants   | Read-only at the org level. Tenant separation is by stream name within `default` org, not by credential |

Each Azure SP env name expands to three concrete vars: `_TENANT_ID`, `_CLIENT_ID`, `_CLIENT_SECRET`. All secrets stored as docker-compose env vars, sourced from `/etc/iris/secrets/*.env` (mode 600, root-owned on the VPS). `.env` files are gitignored.

## Resource graph (cross-tenant deps)

Only resources shared across tenants need listing — single-tenant resources default to `affects: [owner]` automatically.

```yaml
# apps/agent/config/resources.yaml
resources:
  - id: sql.acme.internal
    type: mssql-server
    owner: acme
    affects: [acme, globex, initech]     # globex DBs + some initech tools
    notes: "Physical MSSQL box on acme Hetzner; hosts globex prod DB + initech staging"

  - id: mail.acme.example
    type: smtp-relay
    owner: acme
    affects: [acme, globex, initech, umbrella]
    notes: "All outbound transactional mail routes through here"

  # Add more as discovered. Agent flags candidates in transcripts.
```

When the agent reports a finding referencing a resource in this file, the post-processor expands `affects` into the tenant-tag list shown in the digest. Resources not listed default to single-tenant impact.

## Adding a new tenant

1. Add entry to `tenants.yaml`.
2. Create Azure SP (if new Az tenant) or grant `Reader` on new sub (if existing).
3. Generate Hetzner / kubeconfig / OO tokens as needed.
4. Drop secrets into `/etc/iris/secrets/`.
5. `git pull && docker compose up -d --build` on the VPS.
6. Run `docker compose run --rm iris nightly --tenant <new>` once manually to verify.
