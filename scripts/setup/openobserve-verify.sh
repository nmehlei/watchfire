#!/usr/bin/env bash
# Verify the shared OpenObserve credential and check that the four
# canonical tenant streams exist in the configured org.
#
# Reads OPENOBSERVE_URL / OPENOBSERVE_USER / OPENOBSERVE_PASSWORD from env or .env.
#
# Usage: openobserve-verify.sh [--org default] [tenant ...]

set -euo pipefail

log() { printf '%s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

if [ -f .env ] && [ -z "${OPENOBSERVE_URL:-}" ]; then
  set -a; . ./.env; set +a
fi

: "${OPENOBSERVE_URL:?OPENOBSERVE_URL not set}"
: "${OPENOBSERVE_USER:?OPENOBSERVE_USER not set}"
: "${OPENOBSERVE_PASSWORD:?OPENOBSERVE_PASSWORD not set}"

command -v jq >/dev/null || die "jq not found"

ORG="default"
while [ $# -gt 0 ]; do
  case "$1" in
    --org) ORG="$2"; shift 2 ;;
    -h|--help) sed -n 's/^# \?//p' "$0" | head -10; exit 0 ;;
    --) shift; break ;;
    -*) die "unknown flag: $1" ;;
    *) break ;;
  esac
done

TENANTS=("$@")
if [ ${#TENANTS[@]} -eq 0 ]; then
  TENANTS=(acme globex initech umbrella)
fi

AUTH=$(printf '%s:%s' "$OPENOBSERVE_USER" "$OPENOBSERVE_PASSWORD" | base64 | tr -d '\n')
BASE="${OPENOBSERVE_URL%/}"

# Step 1: credential probe (list orgs)
status=$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "Authorization: Basic $AUTH" "$BASE/api/organizations" || echo "000")
case "$status" in
  200) log "credential OK" ;;
  401|403) die "credential rejected (HTTP $status)" ;;
  000) die "no response from $BASE" ;;
  *) die "unexpected response (HTTP $status)" ;;
esac

# Step 2: fetch the org's stream list once and check each tenant
log ":: GET $BASE/api/$ORG/streams"
STREAMS_JSON=$(curl -sS -H "Authorization: Basic $AUTH" "$BASE/api/${ORG}/streams") \
  || die "failed to list streams in org $ORG"

if ! echo "$STREAMS_JSON" | jq -e '.list' >/dev/null 2>&1; then
  echo "$STREAMS_JSON" >&2
  die "org \"$ORG\" not visible or unexpected response shape"
fi

log ""
log "checking tenant streams in org=$ORG:"
log ""

fail=0
for t in "${TENANTS[@]}"; do
  if echo "$STREAMS_JSON" | jq -e --arg t "$t" '.list[] | select(.name == $t)' >/dev/null; then
    type=$(echo "$STREAMS_JSON" | jq -r --arg t "$t" '.list[] | select(.name == $t) | .stream_type' | paste -sd,/ -)
    printf '  %-10s OK (stream "%s" present, type=%s)\n' "$t" "$t" "$type" >&2
  else
    printf '  %-10s FAIL (no stream named "%s" in org "%s")\n' "$t" "$t" "$ORG" >&2
    fail=1
  fi
done

exit $fail
