# Kubernetes (initech)

## Purpose

Read-only access to the initech production cluster: `view` ClusterRole + a narrow custom role granting `get nodes`, **explicitly excluding `secrets`**. Spec refs: [`02-tenants.md` §Credential scopes](../../specs/02-tenants.md), [`03-systems.md` §Kubernetes](../../specs/03-systems.md).

## Env vars

| Name | Description |
|---|---|
| `KUBECONFIG_INITECH` | Base64-encoded kubeconfig YAML. The adapter decodes at startup; no file on disk inside the container. |

> Naming: spec uses `kubeconfig_env: KUBECONFIG_INITECH` as the handle. Concrete shape (base64 YAML) is an inferred decision — see [`README.md` §Conventions](README.md).

## Prerequisites

- `kubectl` configured with cluster-admin credentials on the initech cluster.
- Active context is `initech-prod` (or the script's `--context` flag points at the right one).

## One-time setup

```bash
# With cluster-admin context active:
./scripts/setup/kubeconfig.sh --context <kube-context>
```

The script (idempotent) will:

1. Apply a `ServiceAccount` `watchfire-reader` in `kube-system`.
2. Bind it to the built-in `view` ClusterRole.
3. Apply a custom `watchfire-extra-read` ClusterRole (just `get/list/watch nodes`) and bind it.
4. Mint a 720h (30-day) bound token via `kubectl create token`.
5. Assemble a kubeconfig pointing at the cluster API with that token.
6. Emit `KUBECONFIG_INITECH_B64=...` to **stdout**.

Append to `.env`:

```bash
./scripts/setup/kubeconfig.sh --context <kube-context> >> .env
```

> ⚠ **Token TTL**: bound service account tokens are time-limited. The script issues a 30-day token to keep a rotation cadence. To use longer-lived tokens, generate a Secret of type `kubernetes.io/service-account-token` instead — at the cost of a long-lived bearer token sitting in etcd. Default is the safer short-lived option; rotate monthly via the same script.

## Verify

```bash
# Decode the kubeconfig and try a few read calls
echo "$KUBECONFIG_INITECH_B64" | base64 -d > /tmp/kc.yaml
KUBECONFIG=/tmp/kc.yaml kubectl get nodes
KUBECONFIG=/tmp/kc.yaml kubectl get pods -A | head

# Read-only checks — these MUST fail
KUBECONFIG=/tmp/kc.yaml kubectl get secrets -A
# → Forbidden (good)
KUBECONFIG=/tmp/kc.yaml kubectl create configmap test --from-literal=k=v
# → Forbidden (good)

rm /tmp/kc.yaml
```

## Rotation

[`docs/operations.md` §Rotation](../operations.md). Re-running the setup script issues a fresh token — bound service-account tokens auto-expire, so old tokens go invalid on TTL even if you forget to revoke. Add a calendar reminder for monthly rotation, or move the call into a cron job alongside Hetzner verification.
