#!/usr/bin/env bash
# Provision a read-only ServiceAccount in a Kubernetes cluster and emit a
# base64-encoded kubeconfig as KUBECONFIG_<TENANT>_B64=...
#
# Idempotent: kubectl apply is replay-safe; tokens are minted fresh each run.
#
# Prereq: kubectl with a cluster-admin context on the target cluster.
#
# Usage: kubeconfig.sh --context <kube-context> [--namespace kube-system]

set -euo pipefail

log() { printf '>> %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

CONTEXT=""
NAMESPACE=kube-system
SA=watchfire-reader
TOKEN_DURATION=720h   # 30 days

while [ $# -gt 0 ]; do
  case "$1" in
    --context) CONTEXT="$2"; shift 2 ;;
    --namespace) NAMESPACE="$2"; shift 2 ;;
    -h|--help) sed -n 's/^# \?//p' "$0" | head -20; exit 0 ;;
    *) die "unknown flag: $1" ;;
  esac
done

[ -n "$CONTEXT" ] || die "--context is required (the kube-context of the target cluster)"

command -v kubectl >/dev/null || die "kubectl not found"

# Sanity: context exists
kubectl config get-contexts "$CONTEXT" >/dev/null 2>&1 \
  || die "context \"$CONTEXT\" not found in kubeconfig"

log "applying RBAC (context=$CONTEXT, namespace=$NAMESPACE, sa=$SA)"
kubectl --context "$CONTEXT" apply -f - >&2 <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: $SA
  namespace: $NAMESPACE
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: watchfire-extra-read
rules:
  - apiGroups: [""]
    resources: [nodes]
    verbs: [get, list, watch]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: watchfire-view
subjects:
  - kind: ServiceAccount
    name: $SA
    namespace: $NAMESPACE
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: view
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: watchfire-extra
subjects:
  - kind: ServiceAccount
    name: $SA
    namespace: $NAMESPACE
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: watchfire-extra-read
EOF

log "minting bound token (duration=$TOKEN_DURATION)"
TOKEN=$(kubectl --context "$CONTEXT" create token "$SA" \
  -n "$NAMESPACE" --duration="$TOKEN_DURATION")

SERVER=$(kubectl --context "$CONTEXT" config view --minify -o jsonpath='{.clusters[0].cluster.server}')
CA=$(kubectl --context "$CONTEXT" config view --raw --minify \
  -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')

if [ -z "$CA" ]; then
  die "cluster CA not found as inline data; the kubeconfig may use a CA file path. Inline first."
fi

KUBECONFIG_YAML=$(cat <<EOF
apiVersion: v1
kind: Config
clusters:
  - name: initech
    cluster:
      server: $SERVER
      certificate-authority-data: $CA
contexts:
  - name: initech-prod
    context:
      cluster: initech
      user: watchfire
current-context: initech-prod
users:
  - name: watchfire
    user:
      token: $TOKEN
EOF
)

# Single-line base64 (portable across macOS/Linux)
B64=$(printf '%s' "$KUBECONFIG_YAML" | base64 | tr -d '\n')

cat <<EOF
# --- KUBECONFIG_INITECH ---
KUBECONFIG_INITECH=$B64
EOF

log "done. Token TTL: $TOKEN_DURATION — re-run this script to rotate."
