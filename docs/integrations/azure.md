# Azure

## Purpose

Read-only access to Azure Resource Manager. Two AAD tenants:

- **acme AAD** — single subscription hosting acme, globex, **and** umbrella. Discriminator: **PascalCase resource-name prefix**. `Globex*` → globex, `Umbrella*` → umbrella, anything else → acme. The agent's `az` adapter will need to filter `az resource list` output by this prefix when scoping a query to one of the sub-tenants.
- **initech AAD** — separate AAD tenant, single subscription dedicated to initech.

Spec refs: [`02-tenants.md` §Credential scopes](../../specs/02-tenants.md), [`03-systems.md` §Azure Resource Manager](../../specs/03-systems.md).

> ⚠ **Spec drift** (open follow-up PR scope):
> 1. Spec 02 models three distinct sub IDs for acme/globex/umbrella → reality is one shared sub. Collapse to a single `subscription_id` value for those three.
> 2. Add a `name_prefix:` field per tenant to encode the PascalCase discriminator (`Globex`, `Umbrella`, empty/null = default catch-all for acme).
> 3. The `az` adapter must apply the prefix filter to results from the shared sub. Pure ARM `Reader` cannot enforce this — it's a *post-filter*, not a permission boundary. The credential still sees everything in the sub; the adapter just hides what doesn't match. Acceptable because the report-only invariant comes from RBAC, not from the prefix filter — the prefix is for *attribution* (which finding belongs to which tenant), not for isolation.

## Env vars

| Name | Description |
|---|---|
| `AZ_SP_ACME_TENANT_ID` | AAD tenant for acme/globex/umbrella. |
| `AZ_SP_ACME_CLIENT_ID` | App ID of `iris-reader-acme`. |
| `AZ_SP_ACME_CLIENT_SECRET` | Service Principal secret. |
| `AZ_SP_INITECH_TENANT_ID` | AAD tenant for initech. |
| `AZ_SP_INITECH_CLIENT_ID` | App ID of `iris-reader-initech`. |
| `AZ_SP_INITECH_CLIENT_SECRET` | Service Principal secret. |

> Naming: spec uses `sp_env: AZ_SP_MAIN` as the *handle*; reality renamed to `AZ_SP_ACME` since the AAD tenant *is* acme. The three concrete env vars use `AZ_SP_ACME_*` as a prefix. (Inferred decision — see [`docs/integrations/README.md` §Conventions](README.md).)

## Prerequisites

- `az` CLI logged in to the target AAD tenant.
- The user running this is **Owner** (not just Contributor) on each subscription, since the script creates role assignments.
- Optional: subscription IDs handy if you want to scope narrower than "all subs in this tenant" (`az account list -o table`).

## One-time setup

The script does the work. One invocation per AAD tenant. By default it grants `Reader` on **every enabled subscription** in the currently-logged-in tenant — which is what you want when all your tenants live under the main AAD.

### ACME AAD (acme + globex + umbrella)

```bash
az login --tenant <acme-aad-tenant-id>

./scripts/setup/azure-sp.sh iris-reader-acme
# auto-discovers the (single) acme sub and grants Reader on it
```

If you want to override discovery (e.g. multiple subs in this AAD some day):

```bash
./scripts/setup/azure-sp.sh iris-reader-acme <acme-sub-id>
```

### INITECH tenant

```bash
az login --tenant <initech-aad-tenant-id>

./scripts/setup/azure-sp.sh iris-reader-initech
# auto-discovers initech's subs (typically just one)
```

The script:

- Creates the SP if absent, or reuses it (and resets credential) if present → idempotent.
- Ensures `Reader` role assignment on each subscription scope.
- Emits an `.env` fragment to **stdout**.

> ⚠ **Auto-discovery includes any sub in the tenant** — including personal/MSDN sandboxes if the logged-in user has them in the same AAD. The script prints discovered subs to stderr before acting; eyeball the list. If anything's wrong, Ctrl-C and re-run with explicit sub IDs.

Append to your local `.env`:

```bash
./scripts/setup/azure-sp.sh iris-reader-main <subs...> >> .env
```

Or copy/paste the block into `ansible/group_vars/secrets.yml` (after `ansible-vault decrypt`) for production.

## Verify

```bash
# Local sanity check via az login as the SP
az login --service-principal \
  -u "$AZ_SP_ACME_CLIENT_ID" \
  -p "$AZ_SP_ACME_CLIENT_SECRET" \
  --tenant "$AZ_SP_ACME_TENANT_ID"

az account list -o table          # shows the granted subs
az resource list --query 'length(@)'   # any non-error result confirms Reader

# Read-only check: this MUST fail
az group create -n iris-test-fail -l westeurope
# → AuthorizationFailed (good)
```

## Rotation

[`docs/operations.md` §Rotation](../operations.md). For SP secrets:

```bash
# Re-running the setup script is the rotation:
./scripts/setup/azure-sp.sh iris-reader-acme
```

It detects the existing SP and runs `az ad sp credential reset`. The old secret is invalidated. Two secrets can co-exist briefly if you skip `--end-date` cleanup, but `credential reset` defaults to invalidating the old one — apply the new env to the container immediately after.
