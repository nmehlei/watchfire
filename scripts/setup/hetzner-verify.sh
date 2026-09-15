#!/usr/bin/env bash
# Verify each HCLOUD_TOKEN_* in env reaches the Hetzner Cloud API.
# Does NOT verify read-only — Hetzner does not expose that flag via API.
# Trust the UI checkbox at token-creation time.
#
# Usage: hetzner-verify.sh [tenant ...]
#   default tenants: acme initech

set -euo pipefail

# Source .env if present and tokens not already set
if [ -f .env ] && [ -z "${HCLOUD_TOKEN_ACME:-}${HCLOUD_TOKEN_INITECH:-}" ]; then
  set -a; . .env; set +a
fi

TENANTS=("$@")
if [ ${#TENANTS[@]} -eq 0 ]; then
  TENANTS=(acme initech)
fi

fail=0
for t in "${TENANTS[@]}"; do
  upper=$(echo "$t" | tr 'a-z' 'A-Z')
  var="HCLOUD_TOKEN_${upper}"
  token="${!var:-}"
  if [ -z "$token" ]; then
    printf '  %-10s FAIL (%s not set)\n' "$t" "$var" >&2
    fail=1
    continue
  fi
  status=$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $token" \
    https://api.hetzner.cloud/v1/servers 2>/dev/null || echo "000")
  case "$status" in
    200) printf '  %-10s OK\n' "$t" >&2 ;;
    401) printf '  %-10s FAIL (HTTP 401 — token invalid)\n' "$t" >&2; fail=1 ;;
    *) printf '  %-10s FAIL (HTTP %s)\n' "$t" "$status" >&2; fail=1 ;;
  esac
done

exit $fail
