#!/usr/bin/env bash
# Generate (or reuse) the watchfire ed25519 keypair under infra/ssh/.
# Emits the public key (for authorized_keys) and WATCHFIRE_SSH_PRIVATE_KEY_B64=... to stdout.
# Idempotent: reuses existing key file if present.
#
# Usage: ssh-keygen-watchfire.sh [--dir infra/ssh]

set -euo pipefail

log() { printf '>> %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

DIR="infra/ssh"
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    -h|--help) sed -n 's/^# \?//p' "$0" | head -10; exit 0 ;;
    *) die "unknown flag: $1" ;;
  esac
done

KEY="$DIR/watchfire_ed25519"
mkdir -p "$DIR"

if [ -f "$KEY" ]; then
  log "key exists at $KEY (reusing)"
else
  log "generating ed25519 keypair at $KEY"
  ssh-keygen -t ed25519 -N '' -C "watchfire@$(hostname -s)" -f "$KEY" >&2
  chmod 600 "$KEY"
fi

# Single-line base64 (portable across macOS/Linux)
B64=$(base64 < "$KEY" | tr -d '\n')

cat <<EOF
# --- Watchfire SSH key ---
# Public key (paste into each target host's /home/watchfire/.ssh/authorized_keys
# with: command="/usr/local/bin/watchfire-shell",no-pty,no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-user-rc <PUBKEY>):
# $(cat "$KEY.pub")

WATCHFIRE_SSH_PRIVATE_KEY_B64=$B64
EOF

log "done. Pubkey echoed as a comment above; private key emitted as WATCHFIRE_SSH_PRIVATE_KEY_B64."
