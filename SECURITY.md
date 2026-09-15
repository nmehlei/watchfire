# Security

## Reporting a vulnerability

Report privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability**. Please do not open a public issue for anything that
could be exploited.

Include what you found, how to reproduce it, and what an attacker could achieve.
Watchfire is maintained by a small team; expect an acknowledgement within a week, and a
clear statement of whether and when a fix will ship.

Only the `main` branch is supported.

## What is worth attacking

Watchfire holds **read credentials for other people's infrastructure** — observability
stores, cloud subscriptions, CI systems, and SSH access to hosts. Two things follow:

1. **Credential exposure is the primary risk.** A leaked key reads everything that
   key can read. Secrets must never appear in logs, errors, transcripts, the
   repository, or the tenant registry (which holds only variable *names*).
2. **The read-only guarantee is a security property, not a style choice.** An
   operator points Watchfire at production because it cannot change anything.

## The read-only guarantee

It is enforced in three independent layers, so that no single failure lets Watchfire
act on the systems it watches:

| Layer | Where |
|---|---|
| Reader-scoped credentials | Issued per system with read-only rights (see `docs/integrations/`) |
| A command allowlist | `apps/agent/src/agent/safety.ts` |
| A forced-command shell on SSH targets | `infra/ssh/watchfire-shell.sh` |

**Any way to make Watchfire write, mutate, deploy or delete on a monitored system is a
vulnerability** — including through prompt injection via log lines, HTTP bodies or
other tool output. Report it as one, not as a feature request.

The only writes Watchfire makes are to its own state: its database, its transcripts, and
mutes an operator sets.

## Known and documented

These are known properties of the current design, documented in
[`docs/operations.md`](docs/operations.md), and not in scope as new reports:

- OpenObserve webhooks are accepted **unverified** when `OPENOBSERVE_WEBHOOK_SECRET`
  is not set. Operators are told to set it.
- The REST and MCP surfaces use a single shared bearer token (`WATCHFIRE_API_TOKEN`)
  rather than per-user credentials.
- Transcripts record tool output verbatim and are kept indefinitely by default; they
  should be treated as sensitive.

A way to bypass any of these *beyond* what is documented is in scope.
