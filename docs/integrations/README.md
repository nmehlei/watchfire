# Integrations

Setup guides for each external system Watchfire talks to. Authoritative spec for *what* each credential is for: [`specs/02-tenants.md`](../../specs/02-tenants.md) and [`specs/03-systems.md`](../../specs/03-systems.md). Authoritative spec for *how* secrets get to the running container: [`docs/operations.md` §Rotation](../operations.md).

The docs in this folder are operator-facing: how to *mint* the credential at the issuer and verify it works locally. Distribution to the production container is a separate concern, handled via `ansible-vault` per spec 09.

## Status

| Integration | Required env vars | Setup script | Status |
|---|---|---|---|
| [Anthropic](anthropic.md) | `ANTHROPIC_API_KEY` | manual | ✅ in `.env` |
| [Telegram](telegram.md) | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | manual | ✅ in `.env` |
| [OpenObserve](openobserve.md) | `OPENOBSERVE_URL`, `OPENOBSERVE_USER`, `OPENOBSERVE_PASSWORD` | [verify](../../scripts/setup/openobserve-verify.sh) | ✅ in `.env` (single shared credential — see doc, contradicts spec 02) |
| [Azure](azure.md) | `AZ_SP_ACME_*` (3), `AZ_SP_INITECH_*` (3) | [`azure-sp.sh`](../../scripts/setup/azure-sp.sh) | 🟡 acme SP minted; initech pending |
| [Hetzner](hetzner.md) | `HCLOUD_TOKEN_ACME`, `HCLOUD_TOKEN_INITECH` | [verify](../../scripts/setup/hetzner-verify.sh) | ❌ missing |
| [Kubernetes](kubernetes.md) | `KUBECONFIG_<TENANT>` | [`kubeconfig.sh`](../../scripts/setup/kubeconfig.sh) | ❌ missing |
| [SSH (iris user)](ssh.md) | `IRIS_SSH_PRIVATE_KEY_B64` | [`ssh-keygen-iris.sh`](../../scripts/setup/ssh-keygen-iris.sh) | ❌ missing |

> ⚠ `GITHUB_SAFE_AI_PAT` is set in `.env` but not referenced by any spec. Either drop it or open a spec issue describing what it's for.

## How to use

Each doc follows the same shape:

1. **Purpose** — what subsystem and why.
2. **Env vars** — the exact names Watchfire expects.
3. **One-time setup** — manual UI/CLI steps.
4. **Script** — the idempotent helper, if there is one.
5. **Verify** — a command + expected output.
6. **Rotation** — pointer to spec 09.

Scripts emit env-var fragments to **stdout only**. Other output goes to **stderr**. So you can route a fragment safely:

```bash
./scripts/setup/azure-sp.sh iris-reader-main <sub-id-1> <sub-id-2> >> .env
```

…or paste the stdout block into ansible-vault for production.

## Conventions (inferred — please review)

These weren't fully pinned in the specs; I picked sensible defaults. Flag in a spec PR if you want to change them:

- **Azure SP env shape**: `AZ_SP_<NAME>_TENANT_ID`, `_CLIENT_ID`, `_CLIENT_SECRET` (three vars per SP, not a JSON blob). Adapter `apps/agent/bin/az-as` will read these. Concrete names: `AZ_SP_ACME` (was `AZ_SP_MAIN` in spec — renamed since the AAD tenant *is* acme) and `AZ_SP_INITECH`.
- **Kubeconfig env shape**: `KUBECONFIG_INITECH` holds the *base64-encoded YAML* of the kubeconfig (not a path). The adapter decodes at startup. Avoids leaking a file on disk in the container.
- **SSH key env shape**: `IRIS_SSH_PRIVATE_KEY_B64` (base64-encoded ed25519 private key). Single key reused across all Hetzner accounts (one key, many forced-command authorized_keys entries).
- **OpenObserve**: single shared credential (`OPENOBSERVE_USER` / `OPENOBSERVE_PASSWORD`), not per-tenant tokens. All tenants currently live in the `default` org; tenant data is identified by stream name (`acme`, `globex`, `initech`, `umbrella` and prefixed variants). ⚠ Contradicts spec 02 — see [openobserve.md §Spec drift](openobserve.md). A spec PR should retire `OBS_TOKEN_*` and add an `org:` field per tenant.

## See also

- [`scripts/setup/`](../../scripts/setup/) — the scripts themselves.
- [`specs/02-tenants.md` §Credential scopes](../../specs/02-tenants.md) — required role/scope of each credential.
- [`docs/operations.md` §Rotation](../operations.md) — rotation procedure for production.
