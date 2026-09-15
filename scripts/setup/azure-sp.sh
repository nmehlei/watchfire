#!/usr/bin/env bash
# Create or refresh an Azure Service Principal with Reader on N subscriptions.
# Idempotent: reuses an existing SP with the same display name; resets credential.
# Emits an .env fragment to stdout. Progress to stderr.
#
# Usage: azure-sp.sh <sp-name> [<sub-id> ...]
#   With no sub IDs, auto-discovers all *enabled* subscriptions in the current
#   AAD tenant. Pass explicit sub IDs to override.
#
#   e.g. azure-sp.sh iris-reader-main                        # all subs in tenant
#        azure-sp.sh iris-reader-main 11111... 22222...      # only the listed
#        azure-sp.sh iris-reader-initech                     # all initech subs

set -euo pipefail

log() { printf '>> %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

if [ $# -lt 1 ]; then
  cat >&2 <<EOF
Usage: $0 <sp-name> [<sub-id> ...]
  Convention: <sp-name> ∈ { iris-reader-main, iris-reader-initech }.
  Switch AAD tenant first with: az login --tenant <aad-tenant-id>
  With no sub IDs, all enabled subs in the current tenant are used.
EOF
  exit 64
fi

command -v az >/dev/null || die "az CLI not found"
command -v jq >/dev/null || die "jq not found"

NAME="$1"; shift
SUBSCRIPTIONS=("$@")

# Sanity: are we logged in?
ACCOUNT_JSON=$(az account show -o json 2>/dev/null) || die "not logged in (run: az login --tenant <aad-tenant-id>)"
TENANT_ID=$(echo "$ACCOUNT_JSON" | jq -r '.tenantId')
log "AAD tenant: $TENANT_ID"

# Auto-discover subs in this tenant if none were given
if [ ${#SUBSCRIPTIONS[@]} -eq 0 ]; then
  log "no sub IDs given — discovering enabled subs in tenant $TENANT_ID"
  DISCOVERED=$(az account list --all -o json \
    | jq -r --arg t "$TENANT_ID" '.[] | select(.tenantId == $t and .state == "Enabled") | "\(.id)\t\(.name)"')
  if [ -z "$DISCOVERED" ]; then
    die "no enabled subscriptions found in tenant $TENANT_ID"
  fi
  log "discovered subscriptions:"
  while IFS=$'\t' read -r id name; do
    log "  - $id  ($name)"
    SUBSCRIPTIONS+=("$id")
  done <<<"$DISCOVERED"
fi

# Look for an existing SP with this display name
EXISTING_APP_ID=$(az ad sp list --display-name "$NAME" --query '[0].appId' -o tsv 2>/dev/null || true)

if [ -n "$EXISTING_APP_ID" ]; then
  log "reusing existing SP \"$NAME\" (appId $EXISTING_APP_ID) — resetting credential"
  CRED=$(az ad sp credential reset --id "$EXISTING_APP_ID" --display-name "rotated-$(date -u +%Y%m%dT%H%M%SZ)" -o json)
else
  log "creating SP \"$NAME\""
  SCOPE_ARGS=()
  for s in "${SUBSCRIPTIONS[@]}"; do SCOPE_ARGS+=("/subscriptions/$s"); done
  CRED=$(az ad sp create-for-rbac \
    --name "$NAME" \
    --role Reader \
    --scopes "${SCOPE_ARGS[@]}" \
    -o json)
fi

APP_ID=$(echo "$CRED" | jq -r '.appId')
SECRET=$(echo "$CRED" | jq -r '.password')
SP_TENANT=$(echo "$CRED" | jq -r '.tenant')

# Idempotently ensure each subscription has a Reader role assignment
for s in "${SUBSCRIPTIONS[@]}"; do
  if az role assignment list \
       --assignee "$APP_ID" \
       --scope "/subscriptions/$s" \
       --role Reader -o tsv 2>/dev/null | grep -q .; then
    log "Reader already present on /subscriptions/$s"
  else
    log "granting Reader on /subscriptions/$s"
    az role assignment create \
      --assignee "$APP_ID" \
      --role Reader \
      --scope "/subscriptions/$s" \
      -o none
  fi
done

# Derive env-var prefix from the SP name: iris-reader-main -> AZ_SP_MAIN
SUFFIX="${NAME#iris-reader-}"
PREFIX="AZ_SP_$(echo "$SUFFIX" | tr 'a-z-' 'A-Z_')"

cat <<EOF
# --- $NAME ---
${PREFIX}_TENANT_ID=$SP_TENANT
${PREFIX}_CLIENT_ID=$APP_ID
${PREFIX}_CLIENT_SECRET=$SECRET
EOF

log "done. Append the block above to your .env (or paste into ansible-vault)."
