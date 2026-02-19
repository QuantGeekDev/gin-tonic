# Launching Jihn (CLI + Web)

This document is the operational runbook for starting Jihn locally.

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment

Create `.env` at repo root.

### Option A: Anthropic

```env
JIHN_LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_key
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
```

### Option B: OpenAI

```env
JIHN_LLM_PROVIDER=openai
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-4.1
```

Optional universal override:

```env
JIHN_LLM_MODEL=your_provider_model_name
```

Optional shared runtime knobs:

```env
JIHN_AGENT_ID=main
JIHN_SESSION_SCOPE=channel-peer
JIHN_CONTEXT_TOKEN_BUDGET=8000
JIHN_CONTEXT_TARGET_TOKEN_BUDGET=6400
JIHN_TOOL_POLICY_MODE=allow
JIHN_TOOL_POLICY_TOOLS=
JIHN_MCP_SERVERS=[]
JIHN_MCP_CACHE_TTL_MS=30000
JIHN_MEMORY_DIR=~/.jihn/memory
JIHN_STORAGE_BACKEND=file
```

### Option C: Postgres-backed persistence (recommended for shared runtime)

Start Postgres:

```bash
docker compose up -d postgres
```

Then set:

```env
JIHN_STORAGE_BACKEND=postgres
DATABASE_URL=postgres://jihn:jihn@localhost:5432/jihn
```

Optional migration commands (Drizzle):

```bash
npm run db:generate --workspace=packages/agent-core
npm run db:migrate --workspace=packages/agent-core
```

Note: runtime also auto-creates required tables if missing.

## 3. Start channels

### Web only

```bash
npm run dev:web
```

Open `http://localhost:3000`.

### CLI only

```bash
npm run dev:cli
```

### Both channels together

```bash
npm run dev:all
```

### Telegram channel adapter (grammy)

Set:

```env
JIHN_TELEGRAM_BOT_TOKEN=your_bot_token
JIHN_TELEGRAM_TRANSPORT=polling
```

Then run:

```bash
npm run dev:telegram
```

Webhook mode (production ingress):

```env
JIHN_TELEGRAM_TRANSPORT=webhook
JIHN_TELEGRAM_WEBHOOK_PUBLIC_BASE_URL=https://bot.example.com
JIHN_TELEGRAM_WEBHOOK_PATH=/telegram/webhook
JIHN_TELEGRAM_WEBHOOK_SECRET=your_secret
JIHN_TELEGRAM_WEBHOOK_PORT=8787
JIHN_TELEGRAM_WEBHOOK_HOST=0.0.0.0
```

## 4. Validate system health quickly

### Shared runtime tests

```bash
npm run test --workspace=packages/agent-core
```

### CLI focused behavior tests

```bash
npm run test:cli:behaviors
```

### Full CLI tests

```bash
npm run test --workspace=apps/cli
```

## 5. Manual cross-channel sanity check

1. Start web and CLI with the same provider.
2. Use matching `peerId` + `scope=peer`.
3. Send a message in web, continue in CLI.
4. Confirm session continuity and shared memory visibility.
