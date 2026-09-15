# Anthropic API

## Purpose

The agent backend. Default model is Haiku; nightly may escalate to Sonnet via `correlate-deep` (max 2/run). Spec ref: [`01-architecture.md`](../../specs/01-architecture.md), [`04-nightly.md`](../../specs/04-nightly.md).

## Env vars

| Name | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Single key, full org access. No scoping available. |

## One-time setup

1. <https://console.anthropic.com/> → **Settings → API Keys → Create Key**.
2. Name it `watchfire-prod` (or `watchfire-dev` for local).
3. Set a workspace-level spend limit matching your budget (target €5/month per spec 00). Anthropic shows USD; convert.
4. Copy the key (`sk-ant-api03-…`).

## Script

None. Anthropic does not expose key creation via API.

## Verify

```bash
curl -s https://api.anthropic.com/v1/models \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" | jq '.data[].id' | head
```

Expect a list of model IDs. HTTP 401 → bad key.

## Rotation

[`docs/operations.md` §Rotation](../operations.md). Anthropic supports two active keys at once → mint new, deploy, then revoke old.
