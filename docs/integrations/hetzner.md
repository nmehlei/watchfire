# Hetzner Cloud

## Purpose

Read-only API access to Hetzner Cloud projects for `acme` and `initech`. Plus SSH access to individual boxes (covered in [`ssh.md`](ssh.md)). Spec refs: [`02-tenants.md` §Credential scopes](../../specs/02-tenants.md), [`03-systems.md` §Hetzner Cloud](../../specs/03-systems.md).

## Env vars

| Name | Description |
|---|---|
| `HCLOUD_TOKEN_ACME` | Read-only API token for the `acme` Hetzner project. |
| `HCLOUD_TOKEN_INITECH` | Read-only API token for the `initech` Hetzner project. |

## One-time setup

🐞 **Read-only is set at creation time and not queryable via API afterwards.** Choose carefully; rotate if you slip.

For each Hetzner project:

1. Log in to <https://console.hetzner.cloud/>.
2. Switch to the target project (top-left dropdown).
3. **Security → API tokens → Generate API Token**.
4. Description: `watchfire-reader` (so you recognize it later).
5. Permissions: **Read** (not Read & Write).
6. Generate. Copy the token. **You cannot view it again** — store immediately in your password manager and `.env`.

Repeat for each Hetzner project (`acme`, `initech`).

## Script

Hetzner Cloud does not expose a token-creation API, so the creation step is manual. Verification is scripted.

[`scripts/setup/hetzner-verify.sh`](../../scripts/setup/hetzner-verify.sh) — for each `HCLOUD_TOKEN_*`, hits `GET /v1/servers` and confirms 200.

> The script does **not** verify read-only. The Hetzner API doesn't expose token metadata, so there's no way short of attempting writes (which would pollute your account on a read-write token). Trust the UI checkbox; rotate if you accidentally granted write.

## Verify

```bash
./scripts/setup/hetzner-verify.sh
```

Expected:

```
acme: OK
initech: OK
```

Manual one-off:

```bash
curl -s -H "Authorization: Bearer $HCLOUD_TOKEN_ACME" \
  https://api.hetzner.cloud/v1/servers | jq '.servers | length'
```

## Rotation

[`docs/operations.md` §Rotation](../operations.md). Hetzner supports multiple active tokens per project → mint new, deploy, then revoke old in the UI. No script — UI-only.
