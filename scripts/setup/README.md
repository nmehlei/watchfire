# Setup scripts

Idempotent helpers for provisioning Watchfire credentials. Each script:

- Logs progress to **stderr**.
- Emits the final env-var fragment to **stdout** (so you can `>> .env` safely).
- Detects existing state and reuses where possible.

See [`docs/integrations/`](../../docs/integrations/README.md) for the per-integration setup guide each script accompanies.

## Scripts

| Script | Purpose | Manual prereqs |
|---|---|---|
| `azure-sp.sh` | Create or refresh an Azure SP with `Reader` on N subscriptions, emit env vars. | `az login` to the right AAD tenant; you must be Owner on each sub. |
| `openobserve-verify.sh` | Probe the OO credential against each tenant's org. | `OPENOBSERVE_*` set in env. |
| `hetzner-verify.sh` | Probe each `HCLOUD_TOKEN_*` with a benign read call. | `HCLOUD_TOKEN_*` set in env. |
| `kubeconfig.sh` | Create a read-only SA in a cluster, mint a token, emit a base64 kubeconfig. | `kubectl` cluster-admin on the target context. |
| `ssh-keygen-iris.sh` | Generate (or reuse) `infra/ssh/iris_ed25519`, emit pubkey + base64 private key. | None. |

## Pattern

```bash
# Append env to local .env
./scripts/setup/azure-sp.sh iris-reader-main <sub-id> >> .env

# Or pipe to clipboard for ansible-vault paste
./scripts/setup/kubeconfig.sh --context <kube-context> | pbcopy
```

`stderr` is for humans: progress, warnings, idempotency notices. Redirect to `/dev/null` if you only want the env fragment.
