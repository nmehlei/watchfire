# Watchfire — Telegram Control

## Purpose

The operator's two-way control surface. Watchfire already speaks *out* via Telegram (digests, pages — see 07). This spec adds the *in* direction: a small command surface so the operator can mute noisy findings, list active mutes, and unmute, all from the phone, without SSH'ing into the host or editing config.

Originating motivation: brute-force-against-public-IP findings repeat every nightly and will keep doing so. The operator wants a one-tap silence mechanism without redeploying. Bonus property: the same channel that delivers findings carries the controls — symmetry the operator asked for explicitly.

This spec owns:

- Webhook setup (Telegram-side `setWebhook` call + secret token)
- Command surface and parsing
- Short-ID resolution rules
- Mute lifecycle (interaction with the `mutes` table from 06)
- Confirmation / error responses
- Bot module layout

This spec does **not** own: webhook intake auth (05 — the secret-token validation lives there alongside the OpenObserve verifier), the `mutes` table schema (06), digest-side mute filtering (07).

## Webhook setup

Watchfire registers itself with Telegram on every boot via `setWebhook`. Idempotent — Telegram silently overwrites the existing URL. Calling on every boot covers the case where the URL changes (DNS, port, redeploy with a new domain).

Payload:

```json
{
  "url": "https://watchfire.ops-host.example.com/webhook/telegram",
  "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
  "allowed_updates": ["message"],
  "drop_pending_updates": false,
  "max_connections": 4
}
```

- `secret_token` — random 32-byte hex string, generated once and stored in `secrets.yml`. Telegram echoes it back in the `X-Telegram-Bot-Api-Secret-Token` header on every webhook delivery.
- `allowed_updates: ["message"]` — we only handle text messages; ignore reactions, edits, callback queries, channel posts, etc. Anything else is filtered server-side by Telegram and never hits us.
- `drop_pending_updates: false` — preserve queued updates across Watchfire restarts. If the operator typed `/mute abc123` while Watchfire was being deployed, we want to honour it once we're back up.
- `max_connections: 4` — single-operator load; default of 40 is wasteful.

The setup call lives in `apps/agent/src/bot/setup.ts::registerWebhook()`. Failure to register is logged but does NOT crash the process — running without bot input is degraded but not broken (digests still send; the operator can ssh in to mute manually). Retried at the next boot.

## Authorization model

Two layers, both enforced at the HTTP intake layer (05):

1. **Secret token** (forgery prevention): `X-Telegram-Bot-Api-Secret-Token` header must match `TELEGRAM_WEBHOOK_SECRET` exactly. Mismatch → 401.
2. **Chat allowlist** (least privilege): `update.message.chat.id` must appear in `TELEGRAM_ALLOWED_CHAT_IDS` (single value in v1: the operator's chat). Mismatch → 200 OK, no reply, no DB write. We do not engage with unauthorized senders even to say "no" — silent rejection avoids confirming the bot's existence to attackers who got past layer 1.

Both layers must pass for any command to dispatch. Logging:

- Layer-1 failure → ERROR log: `telegram: secret-token mismatch from <ip>`
- Layer-2 failure → WARN log: `telegram: unauthorized chat_id=<id> user=<username>` (no reply sent)

Mutes are operator-only by design. There is no admin / readonly / role split because there is exactly one operator.

## Command surface

All commands begin with `/`. Input is `update.message.text`. Whitespace-tokenized; no shell parsing. Unknown commands → reply with the help text.

### `/mute <id> [duration] [-- reason]`

Suppress a finding from future digests and pages.

- `<id>` — short ID (6 hex chars) OR full 64-char fingerprint OR a unique prefix of the fingerprint of length ≥4. See "Short-ID resolution" below.
- `[duration]` — optional. One of: `1d`, `7d`, `30d`, `forever` (default: `7d`). Short, opinionated set; no free-form parsing to keep error surface narrow.
- `[-- reason]` — optional. Free text after a literal `--`. Stored in `mutes.reason`. Useful for future-self ("public IP, brute force, cannot fix").

Examples:

```
/mute 9b9896
/mute 9b9896 30d
/mute 9b9896 forever -- public IP, brute force noise
/mute 9b9896 -- temporary while migrating
```

Behavior:

1. Resolve `<id>` to a fingerprint via `findings` lookup (06 query patterns). If ambiguous or absent, reply with an error (see below) and stop.
2. Compute `expires_at`: `null` for `forever`; otherwise `datetime('now', '+{N} days')`.
3. Insert row into `mutes` (06): `fingerprint`, `reason`, `created_at=now`, `expires_at`, `source='telegram'`.
4. Reply: `🤫 Muted <code>9b9896</code> until 2026-04-27 (Disk at 94% on sql.acme.internal).` — show the matched finding's title to confirm the operator muted what they meant. If `forever`, say `... muted indefinitely`.

Multiple `/mute` calls for the same fingerprint stack as separate rows. The "is muted now?" check (06) returns true if any active row exists. Stacking lets the operator extend a mute by adding another `/mute 9b9896 30d` without needing an `/extend` command. Expired rows are pruned by the retention sweep (06).

### `/unmute <id>`

Cancel all active mutes for a fingerprint.

```
/unmute 9b9896
```

Behavior:

1. Resolve `<id>` to fingerprint as in `/mute`.
2. `DELETE FROM mutes WHERE fingerprint = ?` (deletes both active and expired rows for that fingerprint — clean slate).
3. Reply: `🔔 Unmuted <code>9b9896</code> (Disk at 94% on sql.acme.internal). Will reappear in tonight's digest.` If no rows existed, reply: `<code>9b9896</code> wasn't muted. Nothing to do.`

### `/mutes`

List all active mutes.

```
/mutes
```

Behavior: run the "list active mutes" query from 06, render as one HTML message:

```html
🤫 <b>Active mutes</b> (3)

<code>9b9896</code> · Disk at 94% on sql.acme.internal
   until <code>2026-04-27</code> · public IP, brute force noise

<code>a1b2c3</code> · Error-rate spike on api.initech.io
   <b>indefinite</b>

<code>4d2e1f</code> · Cert expires in 14 days for mail.acme.example
   until <code>2026-05-15</code>
```

If empty: `🔔 No active mutes.`

Shows up to 50; if more, append `… and N more — see /var/lib/watchfire/watchfire.db`. (Realistically we'll never hit this; one operator, four tenants.)

### `/help`

Reply with a static help block:

```html
🤖 <b>Watchfire bot commands</b>

<code>/mute &lt;id&gt; [1d|7d|30d|forever] [-- reason]</code>
   Suppress a finding. Default duration 7d.

<code>/unmute &lt;id&gt;</code>
   Re-enable a previously muted finding.

<code>/mutes</code>
   List active mutes.

<code>/help</code>
   Show this message.

IDs are the 6-char codes shown next to each finding in digests and pages.
```

### `/start`

Telegram-standard. Reply once with `/help`'s body. Useful first-time but otherwise treated as `/help`.

## Short-ID resolution

The operator types `<code>9b9896</code>` as displayed in a digest. Resolution rules:

1. Normalize: lowercase, strip whitespace and any leading `<code>` markup if accidentally pasted.
2. Validate: must be `^[0-9a-f]{4,64}$`. Otherwise reply: `❌ <code>{input}</code> doesn't look like a finding ID. Use the 6-char code shown next to each finding.`
3. Match against `findings.fingerprint` with `LIKE ? || '%'` (06 query). Compute `count(*)`.
4. **Zero matches** → `❌ No finding matches <code>{input}</code>. It may have been pruned (90-day window) or the ID is mistyped.`
5. **One match** → proceed.
6. **Multiple matches** (collision in the prefix) → `❌ <code>{input}</code> matches multiple findings. Try a longer prefix:` followed by up to 5 candidates rendered as `<code>{first 8 chars}</code> · {title}`. The operator retypes with more characters.

Why allow shorter than 6? The operator might paste from a place that truncated the ID, or memorize a 4-char prefix for a recurring finding. Cheap to support (length floor of 4 still catches typos), big UX win.

Why allow longer than 6? They might paste the full fingerprint from `watchfire.db`. No reason to reject.

## Mute semantics

Defined in 06 (table) and 07 (digest filtering). Pinned here for clarity:

- **Scope**: filters both digest rendering AND watch-time pages. A muted finding can still be emitted by the agent (memory upserts proceed, `last_seen_at` advances) but produces no operator-visible signal until unmuted or the mute expires.
- **Granularity**: by fingerprint. Two findings with different `(resource_id, issue_class)` combos are independently muted.
- **Resolution sweep**: muted findings still go through the resolution sweep at the end of nightly (06). A muted finding that resolves naturally still becomes `state='resolved'` in the DB, just doesn't appear in the digest's Cleared section.
- **Severity escalation**: muted findings stay muted even if their severity escalates `warn → critical`. Open question — is this what we want, or should escalation auto-unmute? For v1: stay muted. The operator can `/unmute` if needed. Escalation override is more code and edge cases (what if it de-escalates back?) and the operator preferred simplicity.

## Error handling

| Condition                              | Reply                                                          |
| -------------------------------------- | -------------------------------------------------------------- |
| Unknown command (`/foo`)               | Help text, prefixed: `❓ Unknown command. Try:`                |
| `/mute` with no args                   | `❌ Usage: /mute <id> [1d\|7d\|30d\|forever] [-- reason]`     |
| Unparseable duration                   | `❌ Duration must be 1d, 7d, 30d, or forever (got <code>{x}</code>).` |
| ID resolution error                    | (See "Short-ID resolution".)                                   |
| DB error (rare; SQLite is local)       | `⚠️ Internal error. Try again or check the host.` + ERROR log |

Never include exception messages or stack traces in replies — those leak implementation detail and are useless to the operator anyway.

## Idempotency

Telegram retries non-2xx responses with the same `update.update_id`. The webhook handler (05) deduplicates by `update_id` before dispatch, so command handlers see each update at most once.

Beyond Telegram retries: a duplicate `/mute 9b9896` from the operator (different `update_id`) creates a second mute row. That's fine — the active-mute query union-treats them, and pruning cleans up expired ones. No special "already muted" path is needed.

## Module layout

```
apps/agent/src/bot/
  setup.ts               # registerWebhook() — boot-time setWebhook call
  router.ts              # dispatch(message) — command parsing, routing
  reply.ts               # send a reply via Telegram (delegates to reporting/telegram.ts)
  shortid.ts             # resolveFingerprint(input) — prefix matching
  duration.ts            # parseDuration(input) — '7d' → ISO timestamp
  commands/
    mute.ts              # /mute handler
    unmute.ts            # /unmute handler
    mutes.ts             # /mutes handler
    help.ts              # /help, /start handler
```

Pure functions for parsing and resolution; DB writes via 06's repository helpers; HTTP send via 07's `telegram.ts::send` (same retry logic, same error handling).

## Testing

- Command parser: golden tests for valid `/mute` variants (with/without duration, with/without reason, mixed order); error tests for invalid duration, missing id, unknown command.
- Short-ID resolver: zero/one/many match cases; case insensitivity; leading-whitespace tolerance; `<code>` markup stripping.
- Duration parser: `1d` / `7d` / `30d` / `forever`; rejects `5d`, `1week`, empty, etc.
- Mute round-trip: `/mute` then `/mutes` then `/unmute`, verifying the mute appears and disappears in `findings.isMuted`.
- Auth: layer-1 mismatch → 401; layer-2 mismatch → 200 silent. Both via the watch intake tests (05).
- HTML escape: a finding with `<` in its title still renders correctly in `/mutes` output.

## Observability

- Every command dispatched logs `bot.command_dispatched` with `command`, `chat_id` (only the allowed one will appear), and `outcome` (`ok` / `error`).
- Mute insertions/deletions log at INFO with the fingerprint and (if available) the matched finding's title — gives a paper trail for "why didn't I see X tonight" questions.

## Open questions

- **Auto-unmute on severity escalation.** v1 keeps mutes sticky across severity changes. If a `warn → critical` jump happens on a muted brute-force finding, the operator currently misses it. Alternative: auto-unmute on any escalation, with a one-line "🔔 auto-unmuted due to severity bump" header on the next digest. More code, more edge cases (de-escalations? prev_severity reset?). Defer until we see a real escalation get swallowed.
- **Wildcards / class-level mutes.** v1 mutes by exact fingerprint. A "mute every brute-force finding across all tenants" pattern (issue_class wildcard) could be useful but isn't urgent — the four tenants generate few enough fingerprints that one-by-one is tolerable. Defer.
- **Audit log of mutes.** Currently the `mutes` table itself is the audit (rows with `created_at`, `source`). If someone wants "who muted what when", that's already there. No separate log for v1.
- **Two-way edits.** Telegram supports edited messages; we ignore them (`allowed_updates: ["message"]` only includes new messages). Editing `/mute 9b9896` to `/mute 9b9896 30d` does nothing. Acceptable — the operator can just send a follow-up `/mute 9b9896 30d` to extend.
- **Bot username collision.** If the operator runs Watchfire in a group chat, the bot needs `/mute@watchfire_bot` syntax. v1 assumes a private chat. If group-chat support is needed later, the parser strips `@<bot-name>` before dispatch — small change, just not implemented.
- **Inline keyboards.** Telegram supports tap-able buttons attached to messages. A "[Mute 7d] [Mute forever] [Unmute]" row under each finding in digests would be a UX upgrade but adds non-trivial state (callback queries, button id → fingerprint mapping). v1 ships with text commands only; inline buttons are a future polish.
