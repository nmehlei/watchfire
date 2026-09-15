# Telegram

## Purpose

Outbound channel for digests (🌙) and pages (🚨). Spec ref: [`07-reporting.md`](../../specs/07-reporting.md).

## Env vars

| Name | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather. |
| `TELEGRAM_CHAT_ID` | The numeric chat ID where messages land (you, or a private group). |

## One-time setup

1. Open Telegram, message **@BotFather**.
2. `/newbot` → choose name (e.g. `Watchfire Watcher`) and username (must end in `bot`, e.g. `iris_acme_bot`).
3. Copy the token. → `TELEGRAM_BOT_TOKEN`.
4. Start a chat with the bot (search by username, send `/start`). Without this the bot cannot DM you.
5. Get your chat ID:

   ```bash
   curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getUpdates" | jq '.result[-1].message.chat.id'
   ```

   → `TELEGRAM_CHAT_ID`.

## Script

None — manual flow is fastest.

## Verify

```bash
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -d "chat_id=$TELEGRAM_CHAT_ID" \
  -d "text=Watchfire connectivity check ✓"
```

Expect a message in the chat and `"ok":true` in the response.

## Rotation

[`docs/operations.md` §Rotation](../operations.md). BotFather: `/revoke` rotates the token (no co-existence — strict cutover). Chat ID is stable; only changes if you move to a different chat.
