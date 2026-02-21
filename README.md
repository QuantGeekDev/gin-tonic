# Jihn Monorepo

Jihn has two channel adapters over one shared runtime:

- `apps/cli`: Ink terminal app
- `apps/web`: Next.js dashboard + API
- `apps/channel-telegram`: Telegram adapter (grammy)
- `packages/agent-core`: shared gateway, routing, compaction, memory, tool policy, MCP, and provider adapters

## Prerequisites

- Node.js 22+
- npm 10+ (or pnpm if preferred)

## Install

```bash
npm install
```

Configuration templates:

- `.env` (local defaults for gateway + telegram + queue)
- `.env.example` (full reference with placeholders)

## Launch

### Web dashboard

```bash
npm run dev:web
```

Open `http://localhost:3000`.

### CLI app

```bash
npm run dev:cli
```

### Run both

```bash
npm run dev:all
```

### Telegram channel adapter

```bash
npm run dev:telegram
```

`apps/channel-telegram` docs: `apps/channel-telegram/README.md`.

More detailed launch instructions are in `LAUNCHING.md`.

## LLM provider configuration

`agent-core` supports multiple providers through one interface.

### Anthropic (default)

```env
JIHN_LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
```

### OpenAI

```env
JIHN_LLM_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1
```

You can also override model via `JIHN_LLM_MODEL` for either provider.

## API auth, observability, and memory indexing

Optional API security guard (web API):

```env
JIHN_API_AUTH_ENABLED=1
JIHN_API_ALLOWED_ORIGINS=http://localhost:3000
# format: token|scope1;scope2|tenant
JIHN_API_TOKENS=dev-token|agent:read;agent:write;mcp:read;mcp:write;memory:read;memory:write|global
JIHN_API_RATE_LIMIT_WINDOW_MS=60000
JIHN_API_RATE_LIMIT_MAX_REQUESTS=120
```

Structured gateway logs:

```env
JIHN_LOG_LEVEL=info
```

Embedding-backed hybrid memory (OpenAI):

```env
JIHN_MEMORY_EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=...
JIHN_MEMORY_EMBEDDING_MODEL=text-embedding-3-small
```

Memory embedding backfill can be triggered from the web API:

- `POST /api/memory` with `{ "action": "reindex_embeddings", "limit": 200 }`

## Text-to-speech (dashboard + Telegram)

Shared TTS provider config:

```env
JIHN_TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=...
JIHN_TTS_VOICE_ID=...
JIHN_TTS_MODEL_ID=eleven_multilingual_v2
JIHN_TTS_OUTPUT_FORMAT=mp3_44100_128
JIHN_TTS_MODE=off
JIHN_TTS_MAX_CHARS=1200
```

Telegram reply voice mode:

```env
JIHN_TELEGRAM_TTS_MODE=off # off | text_and_voice | voice_only
JIHN_TELEGRAM_TTS_OUTPUT_FORMAT=opus_48000_64
JIHN_TELEGRAM_TTS_MAX_CHARS=800
```

Channel-specific overrides follow `JIHN_<CHANNEL>_TTS_*` naming (example: `JIHN_TELEGRAM_TTS_MODE`).

## Persistence backend

Default: file-backed storage (`~/.jihn` + workspace `.jihn` files).

Postgres mode:

```env
JIHN_STORAGE_BACKEND=postgres
DATABASE_URL=postgres://jihn:jihn@localhost:5433/jihn
```

Start local Postgres:

```bash
docker compose up -d postgres
```

## Plugin platform (workspace)

Jihn now supports formal workspace plugins loaded by `agent-core`.

- Plugin root: `plugins/<pluginId>/`
- Manifest file: `plugins/<pluginId>/jihn.plugin.json`
- Entry module: `entry` in manifest (default `index.js`/`index.mjs`)

Tool names are namespaced automatically as `<pluginId>.<toolName>` to avoid collisions.

Example manifest:

```json
{
  "id": "echo",
  "name": "Echo Plugin",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "index.mjs",
  "enabled": true,
  "priority": 10,
  "capabilities": ["tools", "prompt", "turn", "tool_intercept"]
}
```

Supported capabilities:

- `tools`: add executable tools
- `prompt`: mutate composed system prompt
- `turn`: intercept before/after a gateway turn
- `tool_intercept`: intercept before/after tool execution

Supported permissions:

- `memory.read`, `memory.write`
- `session.read`, `session.write`
- `channel.send`, `channel.receive`
- `network.http`
- `filesystem.read`, `filesystem.write`

Optional manifest hardening fields:

- `compatibility.minHostVersion`
- `compatibility.maxHostVersion`
- `executionMode` (`in_process` or `worker_thread`)
- `healthcheck.timeoutMs`

Hook policy controls are manifest-driven:

- `hookPolicy`: default timeout/error behavior
- `hookPolicies.<hookName>`: per-hook overrides
- `onError`: `continue` (fail-open) or `fail` (fail-closed)

Lifecycle hooks:

- `onInstall`
- `onEnable`
- `onDisable`
- `onUnload`
- `onHealthCheck`

Circuit breaker:

- Plugin runtime tracks repeated failures per plugin.
- When threshold is exceeded in a time window, plugin moves to `open_circuit`.
- After cooldown, plugin is eligible again.

Plugin CLI commands:

```bash
npm run dev:cli -- plugin list
npm run dev:cli -- plugin validate
npm run dev:cli -- plugin inspect --id <pluginId>
npm run dev:cli -- plugin enable --id <pluginId>
npm run dev:cli -- plugin disable --id <pluginId>
npm run dev:cli -- plugin create --id <pluginId> --name "My Plugin"
```

Web debug:

- `GET /api/plugins` returns loaded manifests, status snapshots, lifecycle health, and runtime events.
- Dashboard `Plugin Runtime` panel displays this data.
- Dashboard `Runtime Settings` panel lets you view/update allowlisted runtime keys through gateway control-plane.
- Runtime settings precedence can be controlled with `JIHN_SETTINGS_PRECEDENCE`:
  - `runtime_over_env` (default): persisted runtime settings override env for allowlisted keys.
  - `env_over_runtime`: env values are treated as locked and cannot be overridden from runtime settings.

Detailed platform contract: `PLUGIN_SYSTEM_V1.md`.
Implementation and usage guide: `PLUGIN_SYSTEM.md`.

## Common commands

```bash
npm run build
npm run test
npm run lint
```

## Fast verification commands

### CLI behavior suite (focused)

```bash
npm run test:cli:behaviors
```

This runs targeted CLI behavior tests (agent loop + tools + registry) for fast feedback.

### Full CLI tests

```bash
npm run test --workspace=apps/cli
```

### Shared runtime tests

```bash
npm run test --workspace=packages/agent-core
```

This now includes:

- request policy/auth scope tests
- cross-channel parity integration tests
- memory embedding + indexing tests

## Notes

- Web and CLI share session/memory/tool behavior via `@jihn/agent-core`.
- MCP tools are layered with local tools and exposed as `mcp__<serverId>__<toolName>`.
- Prompt composition is file-driven via `AGENTS.md`, `SOUL.md`, `TOOLS.md` and optional `agents/<agentId>/...` files.
