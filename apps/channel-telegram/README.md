# Jihn Telegram Channel Adapter

Production-oriented Telegram channel service for Jihn using `grammy` (polling or webhook).

## Features

- Long-running Telegram bot process (`grammy` polling mode)
- Webhook transport mode for production ingress
- Routes inbound Telegram messages to `@jihn/agent-core` `handleMessage`
- Uses shared session/memory/policy/MCP/plugin runtime from core
- Reply-to-message behavior using Telegram `reply_parameters`
- Topic-thread aware replies (`message_thread_id`)
- Idempotency by Telegram `update_id`
- Outbound queue with retry backoff
- File-backed debug snapshot for dashboard inspection

## Environment

Required:

- `JIHN_TELEGRAM_BOT_TOKEN`

Optional:

- `JIHN_TELEGRAM_AGENT_ID=main`
- `JIHN_TELEGRAM_SCOPE=channel-peer`
- `JIHN_TELEGRAM_MAX_TURNS=20`
- `JIHN_TELEGRAM_MAX_TOKENS=1024`
- `JIHN_TELEGRAM_REPLY_TO_INCOMING=true`
- `JIHN_TELEGRAM_TYPING_ENABLED=true|false` (default `true`)
- `JIHN_TELEGRAM_TYPING_INTERVAL_MS=4000` (1,000-10,000)
- `JIHN_TELEGRAM_ALLOWED_CHAT_IDS=123456,-987654`
- `JIHN_TELEGRAM_TRANSPORT=polling|webhook` (default `polling`)
- `JIHN_TELEGRAM_WEBHOOK_PUBLIC_BASE_URL=https://bot.example.com` (required for webhook)
- `JIHN_TELEGRAM_WEBHOOK_PATH=/telegram/webhook`
- `JIHN_TELEGRAM_WEBHOOK_SECRET=...` (recommended)
- `JIHN_TELEGRAM_WEBHOOK_HOST=0.0.0.0`
- `JIHN_TELEGRAM_WEBHOOK_PORT=8787`
- `JIHN_TELEGRAM_OUTBOUND_MAX_ATTEMPTS=4`
- `JIHN_TELEGRAM_OUTBOUND_BASE_DELAY_MS=250`
- `JIHN_TELEGRAM_OUTBOX_BACKEND=memory|postgres` (default `memory`)
- `JIHN_TELEGRAM_METRICS_ENABLED=true|false` (default `false`)
- `JIHN_TELEGRAM_METRICS_HOST=127.0.0.1`
- `JIHN_TELEGRAM_METRICS_PORT=18792`
- `JIHN_TELEGRAM_METRICS_PATH=/metrics`
- `JIHN_TELEGRAM_DEBUG_FILE=.jihn/telegram-debug.json`
- `JIHN_TELEGRAM_DEBUG_MAX_EVENTS=120`
- `JIHN_CHANNEL_AUTH_MODE=off|open|pairing` (default `off`)
- `JIHN_CHANNEL_AUTH_STORE_FILE=.jihn/channel-auth.json`
- `JIHN_CHANNEL_AUTH_SECRET=...` (recommended)
- `JIHN_CHANNEL_AUTH_CODE_LENGTH=6`
- `JIHN_CHANNEL_AUTH_CODE_TTL_MS=300000`
- `JIHN_CHANNEL_AUTH_MAX_ATTEMPTS=5`

Pairing auth commands:

- `/verify <code>`
- `/verify new` to rotate challenge

Common shared runtime envs also apply (LLM, MCP, storage, policy, compaction, plugins).

If `JIHN_TELEGRAM_OUTBOX_BACKEND=postgres`, set `DATABASE_URL` (or `JIHN_DATABASE_URL`) so
outbound delivery is durable across adapter restarts.

## Run

```bash
npm run dev --workspace=apps/channel-telegram
```

Build + start:

```bash
npm run build --workspace=apps/channel-telegram
npm run start --workspace=apps/channel-telegram
```
