# Watchfire — Reporting

## Purpose

Defines how findings and run outcomes become messages in Telegram. Owns rendering (finding layout, ordering, emoji), digest and page structure, special headers (error / truncated / suppressed), cross-tenant `affects` expansion at display time, length handling, and the Telegram send path.

Does not own: finding data (06), page-vs-defer decisions (05), turn budget semantics (04), safety-hook behavior (08), bot provisioning (09).

## Surfaces

Two output surfaces, one Telegram channel (one bot, one chat — settled in 01):

- **🌙 Digest** — produced by `runNightly()` after the resolution sweep. Always sent when a nightly reaches the reporting step (including `status='truncated'`, `status='error'`, and empty-finding runs).
- **🚨 Page** — produced by `runWatch()` when `verdict='page'` and the rate-limit check allows the send (see 05 + 06).

Both render using the same finding renderer; the surrounding frame differs.

## Formatting conventions

- **HTML + Unicode emoji.** Telegram `parse_mode: HTML` over a single message. Rationale: a wall of plain text was hard to scan; the operator wants visual hierarchy without splitting into multiple messages (one Telegram message = one notification).
- Allowed HTML subset (Bot API): `<b>`, `<i>`, `<u>`, `<s>`, `<code>`, `<pre>`, `<a href="…">`, `<blockquote>`, `<tg-spoiler>`. No `<table>` (Telegram has no native table support).
- **Escape rule.** Every dynamic string (title, evidence, likely_cause, resource_id, alert summaries, error reasons) flows through an HTML-escape helper before insertion. Only `<`, `>`, `&` need escaping; `'` and `"` are not interpreted in Telegram HTML. This is mandatory because evidence often contains log content (`<error>`, `&` in URLs, etc.) that would otherwise corrupt the document.
- **Short ID** for each finding: first 6 hex chars of `findings.fingerprint`. Rendered as `<code>9b9896</code>` next to the title so the operator can `/mute 9b9896` without copying long strings. See `specs/10-telegram-control.md` for prefix resolution rules.
- **Timestamps**: `YYYY-MM-DD HH:MM`, Europe/Berlin (consistent with the cron).
- **Section dividers**: `━ <name> (<count>) ━` on its own line. Empty sections omitted (no `━ New (0) ━`).
- **One message per digest, one message per page.** Phone vibration discipline: spreading findings across multiple Telegram messages causes one notification per message. The operator explicitly chose density-in-one over per-finding cards.

## State and severity emoji

State:

| State       | Emoji |
| ----------- | ----- |
| New         | 🆕    |
| Escalating  | ⚠️    |
| Ongoing     | 🔁    |
| Resolved    | ✅    |

Severity (uses the same rank order defined in 06):

| Severity  | Emoji |
| --------- | ----- |
| Critical  | 🔴    |
| Warn      | 🟡    |
| Info      | 🟢    |

"Escalating" is computed at render time from `state='ongoing' AND severity_rank(severity) > severity_rank(prev_severity)` — see 06.

## Finding renderer

One finding → one HTML block separated from neighbours by a blank line. Layout (all dynamic strings HTML-escaped):

```
<state-emoji> <severity-emoji> [<tenants>] <b>{title}</b>
   <code>{short_id}</code> · <code>{resource_id}</code>{footer-suffix}
   <blockquote>{evidence}</blockquote>
   <i>{likely_cause}</i>            (omitted if null)
```

`{short_id}` is the first 6 hex chars of `fingerprint`. `{footer-suffix}` is empty for `new`; for other states see below.

State-specific suffixes (appended on the `<code>resource</code>` line):

| State        | Suffix                                                                   |
| ------------ | ------------------------------------------------------------------------ |
| `new`        | (none)                                                                   |
| `escalating` | ` · severity ` + emoji-prev + ` → ` + emoji-curr + ` · age <code>{age}</code>` |
| `ongoing`    | ` · <code>{run_count}</code> night(s) in a row · age <code>{age}</code>` |
| `resolved`   | one-liner only (no resource line, no blockquote): `✅ [<tenants>] <b>{title}</b> — cleared {YYYY-MM-DD}` |

Age format: `Xd` for ≥1 day, `Xh` otherwise.

### Examples

```html
🆕 🔴 [acme, globex, initech] <b>Disk at 94% on sql.acme.internal</b>
   <code>9b9896</code> · <code>sql.acme.internal</code>
   <blockquote>/data at 94% used (was 88% last night). Growth ~0.3%/h.</blockquote>
   <i>globex audit-log rotation disabled since deploy on 04-18.</i>

⚠️ 🔴 [initech] <b>Error-rate spike on api.initech.io</b>
   <code>a1b2c3</code> · <code>api.initech.io</code> · severity 🟡 warn → 🔴 critical · age <code>3d</code>
   <blockquote>5xx at 4.2% (was 1.1% yesterday). Window: 02:00–02:10.</blockquote>
   <i>upstream MSSQL timeouts during the window.</i>

🔁 🟡 [acme] <b>Cert expires in 14 days for mail.acme.example</b>
   <code>4d2e1f</code> · <code>mail.acme.example</code> · <code>4</code> nights in a row · age <code>4d</code>
   <blockquote>Expires 2026-05-04. Let's Encrypt renew hook last ran 30d ago.</blockquote>

✅ [globex] <b>HTTP down — globex.app</b> — cleared 2026-04-18
```

## Ordering within a section

Within each section, findings sort by:

1. Severity DESC (critical → warn → info).
2. `last_seen_at` DESC.

For resolved findings, sort by `resolved_at` DESC (most recently cleared first).

## Cross-tenant `affects` expansion

The `[<tenants>]` prefix is derived at render time — never stored on the finding.

Expansion rules, in order:

1. Look up `resource_id` in `apps/agent/config/resources.yaml`. If found, use its `affects` list.
2. If not found, derive owner from the resource-id naming convention (e.g. `sql.acme.internal` → `acme`). Use `[<owner>]`.
3. If owner can't be derived (e.g. `tenant:<id>` or `global`), use the run's tenant context for watch, or all tenants the finding's `resource_id` appears under for nightly. If nothing derives, use `[?]` — a visible signal that the resource graph is incomplete.

Tenant list is sorted alphabetically, comma-separated, inside square brackets: `[initech, globex, acme]`.

## Digest structure (🌙)

```
🌙 <b>Nightly digest</b> — <YYYY-MM-DD HH:MM>
<optional: error header>
<optional: truncated header>
<optional: suppressed-pages header>

━ New ━ (N)
<new findings, full detail>

━ Escalating ━ (N)
<escalating findings, full detail + severity delta>

━ Ongoing ━ (N)
<ongoing findings, condensed (title + resource + evidence), age shown>

━ Cleared (last 7 days) ━ (N)
<resolved findings, one-liner each>

━ Run ━
<N> findings (A new, B escalating, C ongoing, D cleared) · <turns> turns · €<cost> · cache <hit%>
🤫 <M> muted · reply <code>/mute &lt;id&gt;</code> to suppress     (only if M>0 OR digest non-empty)
```

Empty sections are omitted. The Run footer is always present (it's the heartbeat — see "Empty digests" below).

**Muted findings filter.** Before rendering, every candidate finding is checked against the active mutes table (06: `isMuted(fingerprint)` returns true iff a row exists with `expires_at IS NULL OR expires_at > now`). Muted findings are excluded from all four sections. The Run footer's muted line shows the count that *would* have rendered without the mute filter — visible accountability that mutes are doing work. If `M=0`, omit the muted line entirely (no "🤫 0 muted" noise).

### Section display rules

- **New**: full detail.
- **Escalating**: full detail + severity delta in footer. Surfaced BEFORE Ongoing because escalation is a priority signal.
- **Ongoing**: condensed — title, resource, one-line evidence, age footer. No `Likely cause` (already shown when it was new).
- **Cleared (last 7 days)**: one-liner only. Resolved findings are pruned from this section after 7 days (query: `resolved_at > datetime('now', '-7 days')`; see 06). Rows remain in the DB up to 90 days for audit (06), just not rendered.

### Empty digests

If a nightly produced zero findings and nothing recently resolved, the digest still sends:

```html
🌙 <b>Nightly digest</b> — 2026-04-20 02:37
All quiet — nothing to report.

━ Run ━
0 findings · 14 turns · €0.11 · cache 87%
```

The Run footer doubles as a heartbeat: "Watchfire is alive, ran tonight, cost was reasonable." Never omit. The 🤫 muted line is omitted in this case (mute count is informational; the digest itself already says "all quiet").

## Page structure (🚨)

```html
🚨 [<tenants>] <b>{title}</b>
<code>{short_id}</code> · <code>{resource_id}</code>
Severity: <emoji> <b>{level}</b>
Triggered by: <i>{alert source}</i> — {alert summary}
<blockquote>{evidence}</blockquote>
<i>{likely_cause}</i>                       (omitted if null)
Reason: {watch-verdict reason}
→ Next nightly: <code>{HH:MM}</code>
```

One page = one Telegram message. If the watch agent emitted multiple findings, the page body renders the **primary** one (highest severity; tiebreak: first-emitted) in full. Additional findings append as one-liners:

```html
Also seen:
🟡 [initech] <b>{second finding title}</b> — <code>{short_id}</code> · <code>{resource}</code>
🟡 [initech] <b>{third finding title}</b> — <code>{short_id}</code> · <code>{resource}</code>
```

The `Triggered by` line surfaces the originating alert: OpenObserve alert name + one-line alert description from the webhook payload.

The `→ Next nightly` line states when the operator can expect follow-up context without acting immediately. If it's already past today's cron time, show tomorrow's.

## Headers (digest only)

When present, headers stack directly under the `🌙 Nightly digest — …` line in this order: **Error → Truncated → Suppressed**.

### Error header

If `runs.status = 'error'`:

```html
⚠️ <b>Last nightly terminated on error</b>: <short-reason>
Digest below reflects findings emitted before termination. Resolution sweep was <b>SKIPPED</b>.
```

Exception: if `runs.error` starts with `safety:` (hard-block from 08), upgrade severity:

```html
🚨 <b>SAFETY VIOLATION</b>: Last nightly was terminated.
Reason: <code>{truncated command from runs.error}</code>
Digest reflects only findings emitted before termination. Resolution sweep <b>SKIPPED</b>.
```

### Truncated header

If `runs.status = 'truncated'`:

```html
⚠️ <b>Nightly hit its 20-turn budget</b> before the agent concluded. Findings emitted are final; agent may not have visited every tenant. Resolution sweep ran.
```

### Suppressed-pages header

If the suppressed-pages-window query (06) returns `count > 0`:

```html
⚠️ <b>{N} pages were suppressed</b> between {window-start HH:MM} and {window-end HH:MM} (rate limit: 6/h). Their findings are included in the Ongoing/New sections below.
```

## Length handling

Telegram message limit: 4096 chars per message (HTML tags count toward the limit).

The operator's stated preference is **one message per digest** — phone vibration discipline. Splitting is the fallback only when a single message physically can't fit.

Digest strategy:

1. Compose the full digest.
2. If it fits (≤ 4096 chars), one message. Done.
3. If not, prefer compression first: drop `<i>{likely_cause}</i>` lines from Ongoing-section findings (already lowest-priority). Recompose. If now fits, send.
4. Still oversize → split at section dividers. The first message always contains the header block (`🌙 Nightly digest …` + any error/truncated/suppressed headers). Subsequent messages start with `🌙 <i>(cont. part N/M)</i>`.
5. If a single section exceeds 4096, split at finding boundaries within the section. Continuation markers: `━ <section-name> (cont., part N/M) ━`.
6. Individual findings exceeding 4096 chars on their own: truncate `{evidence}` with `… [truncated; full text in transcript]`. Never truncate `{title}` or `{resource_id}`.

**HTML integrity when splitting.** A split must never leave an unclosed tag. Practical rule: split between top-level finding blocks, not inside one. Each finding is fully self-contained (open and close all its own tags). Sections themselves contribute only the divider line, no enclosing tags. If a single finding is too large and `{evidence}` truncation is needed, truncate the *text* inside `<blockquote>`, never break the tag. The renderer's escape helper guarantees that user content cannot inject stray opening tags.

Pages are single-finding and essentially always fit. A catastrophic evidence field is truncated the same way.

## Telegram rate limits

Bot API: 30 msg/sec globally, 20 msg/min per chat. Our realistic send volume:

- 1 digest/day (1–4 messages for a normal digest).
- ~0–10 pages/day under realistic operation.

Well under limits. No dedicated rate limiter in v1. On a 429 from Telegram, honor `Retry-After` and attempt one retry; if still failing, log to `runs.error` and raise.

## Send path

`apps/agent/src/reporting/telegram.ts::send(text)` (chat ID is a constant loaded from secrets):

1. `POST https://api.telegram.org/bot<TOKEN>/sendMessage` with JSON body `{ chat_id, text, parse_mode: "HTML", disable_web_page_preview: true }`.
2. On 2xx: done.
3. On 429: honor `Retry-After` (or 5s default), retry once. Still 429 → raise.
4. On 5xx: one retry with 2s backoff. Still failing → raise.
5. On 4xx other than 429: log body, raise. A `400 Bad Request: can't parse entities` indicates a malformed HTML document — the escape helper has a bug or a renderer emitted an unescaped `<` / `>` / `&`. This is a code defect, not a transient error; surface it loudly.

Send is synchronous; composer treats send failure as a run-level error (recorded in `runs.error` as `telegram: <status> <body-snippet>`). The run outcome itself doesn't flip to `error` just because Telegram was flaky — the sweep happened, findings are persisted, transcript is kept. The operator will notice (no message arrived) and can inspect.

## Module layout

```
apps/agent/src/reporting/
  index.ts             # composeDigest(run), composePage(run) — public surface
  digest.ts            # nightly assembly; loads findings + headers
  page.ts              # watch assembly; primary + "Also seen"
  renderers/
    finding.ts         # renderFinding(f, mode: 'full' | 'condensed' | 'resolved-oneliner')
    header.ts          # renderErrorHeader, renderTruncatedHeader, renderSuppressedHeader
    severity.ts        # emoji + severity_rank helpers (shared with 06 logic)
    state.ts           # state emoji + escalating detection
  affects.ts           # resource_id → tenant list
  length.ts            # splitForTelegram(text, limit=4096)
  telegram.ts          # send + retry
```

Pure functions for composition; side effects (HTTP) only in `telegram.ts`.

## Testing

- Finding renderer: golden-file tests per state × per severity × with/without likely_cause × with/without affects expansion.
- HTML escape: round-trip tests for `<`, `>`, `&` in title, evidence, likely_cause, resource_id. Negative test: an evidence string containing `<script>` or `&lt;b&gt;` survives as visible text, never as live markup.
- Mute filtering: digest with mixed muted/unmuted findings drops the muted ones from sections; Run footer shows correct M.
- Header renderer: one test per header type, including the safety-hard-block upgrade.
- Length splitter: tests for under-limit (no split), single split, multi-split, finding-level truncation. Verify no split message ends with an unclosed HTML tag.
- Telegram client: fake HTTP server; tests for 2xx, 429 retry, 5xx retry, 4xx raise. Verify `parse_mode: "HTML"` is in the request body.

## Open questions

- **Tenant grouping in digest.** Flat, state-grouped for v1. If findings grow past ~20/night and the flat list becomes hard to scan, add per-tenant subheadings within each state section. Defer.
- **Per-section finding caps.** No hard cap in v1. A catastrophic incident producing 100 findings in one night would split across many messages. Acceptable — better than silently truncating signal. Revisit if it happens.
- **Digest time-of-send in the header.** Currently rendered from the run's `completed_at`. If a nightly takes 7 minutes, the digest says `02:37` even though the cron fired at `02:30`. Fine — `completed_at` is what the operator actually wants to know. Flag if confusing.
- **Empty-digest policy.** v1 sends a minimal message with the Run footer as a heartbeat. Alternative: skip sending, rely on healthchecks.io for liveness. Heartbeat-in-digest wins for v1 because the operator gets one unambiguous "Watchfire ran" signal per day. Revisit if the quiet-night messages feel noisy after two weeks.
- **Localization.** German is the operator's native language (per global guidance). All message copy is English today; trivially swappable by a translation file. Defer until there's a reason.
