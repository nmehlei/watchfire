# SSH (watchfire user)

## Purpose

For things the Hetzner API can't show (disk usage, process state, log tails). One ed25519 keypair, deployed to a dedicated `watchfire` user on each target box. Restricted via `watchfire-shell` forced-command (allowlist of read-only binaries). Spec refs: [`02-tenants.md` §Credential scopes](../../specs/02-tenants.md), [`03-systems.md` §Hetzner Cloud / SSH path](../../specs/03-systems.md), [`08-safety.md`](../../specs/08-safety.md), [`docs/operations.md` §Add a new target host](../operations.md).

## Env vars

| Name | Description |
|---|---|
| `WATCHFIRE_SSH_PRIVATE_KEY_B64` | Base64-encoded ed25519 private key. The adapter decodes at startup. |

> Naming: spec doesn't pin an env var name for the SSH key. Inferred — see [`README.md` §Conventions](README.md).

## One-time setup (laptop side: keypair)

```bash
./scripts/setup/ssh-keygen-watchfire.sh
```

Idempotent: creates `infra/ssh/watchfire_ed25519{,.pub}` if absent; reuses if present. Emits the **public key** (for authorized_keys) and `WATCHFIRE_SSH_PRIVATE_KEY_B64=...` (for `.env`) to **stdout**.

```bash
./scripts/setup/ssh-keygen-watchfire.sh >> .env   # captures the env line; pubkey goes to stderr by default for eyeballing
```

## Per-host setup (target box side)

For each Hetzner box that should be in scope, follow [`docs/operations.md` §Add a new target host](../operations.md). Summary:

1. SSH into the host as root.
2. Create the user + install `watchfire-shell`:

   ```bash
   useradd -m -s /bin/bash watchfire
   install -m 0755 -o root -g root infra/ssh/watchfire-shell.sh /usr/local/bin/watchfire-shell
   mkdir -p /etc/watchfire
   # Edit /etc/watchfire/paths.allow with the log/config paths this host should expose
   ```

3. Append the watchfire pubkey to `/home/watchfire/.ssh/authorized_keys` with the forced-command and SSH option restrictions:

   ```
   command="/usr/local/bin/watchfire-shell",no-pty,no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-user-rc <PASTE PUBKEY>
   ```

4. Add the host to the tenant's `ssh_hosts` list in `apps/agent/config/tenants.yaml`.

> 🔴 The `watchfire-shell` forced-command is the **primary** read-only boundary on the SSH path. Without it, the watchfire user can run anything. Don't skip step 3.

## Verify

From the box where you'll run Watchfire (or your laptop, with the watchfire private key):

```bash
# Read should work
ssh -i infra/ssh/watchfire_ed25519 watchfire@<host> "df -h"

# Write must fail
ssh -i infra/ssh/watchfire_ed25519 watchfire@<host> "touch /tmp/watchfire-write-probe"
# → exit 2, stderr "watchfire-shell: command not permitted: touch"

ssh -i infra/ssh/watchfire_ed25519 watchfire@<host> "rm -rf /"
# → exit 2, stderr "watchfire-shell: command not permitted: rm"
```

## Rotation

Spec 09 doesn't yet have an SSH-key entry in the rotation table — note this as a follow-up. Practical procedure:

1. `./scripts/setup/ssh-keygen-watchfire.sh` with the old key moved aside (`mv infra/ssh/watchfire_ed25519{,.old}`).
2. Append the new pubkey to each host's `/home/watchfire/.ssh/authorized_keys` (don't replace yet — co-existence period).
3. Update `WATCHFIRE_SSH_PRIVATE_KEY_B64` in vault and deploy.
4. After verifying Watchfire still reaches all hosts on the next nightly, remove the old pubkey from each authorized_keys.

Better path long-term: drive both keygen and per-host install via Ansible. Out of scope here.
