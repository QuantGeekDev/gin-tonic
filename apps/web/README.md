# Jihn Web

Next.js dashboard for the shared Jihn runtime.

## Run

From repo root:

```bash
npm run dev:web
```

Then open `http://localhost:3000`.

## Provider configuration

Set in root `.env`:

### Anthropic

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

Optional shared override:

```env
JIHN_LLM_MODEL=...
```

## Persistence backend

Default backend is file-based (`~/.jihn` + `.jihn` paths).

To use Postgres-backed shared persistence:

```env
JIHN_STORAGE_BACKEND=postgres
DATABASE_URL=postgres://jihn:jihn@localhost:5432/jihn
```

## UI stack

- shadcn/ui primitives in `components/ui`
- utility helper in `lib/utils.ts`
- `next-themes` provider in `components/theme-provider.tsx`
- dark mode is default (`defaultTheme=\"dark\"`)
- header theme switcher supports `dark`, `light`, and `system`

## Useful endpoints

- `GET /api/agent`: runtime metadata (provider/model/tools)
- `POST /api/agent`: run a turn (supports debug compaction simulation)
- `POST /api/tts`: synthesize speech for dashboard playback
- `GET /api/mcp`: MCP registry snapshot
- `GET/POST /api/settings`: runtime settings snapshot/update (admin scope)
- `GET/POST /api/memory`: memory debug/search/write
- `POST /api/memory` + `{ "action": "reindex_embeddings", "limit": 200 }`: backfill memory embeddings

## Optional API auth

```env
JIHN_API_AUTH_ENABLED=1
JIHN_API_ALLOWED_ORIGINS=http://localhost:3000
JIHN_API_TOKENS=dev-token|agent:read;agent:write;mcp:read;mcp:write;memory:read;memory:write|global
JIHN_API_RATE_LIMIT_WINDOW_MS=60000
JIHN_API_RATE_LIMIT_MAX_REQUESTS=120
```

Send `Authorization: Bearer <token>` for protected API routes when enabled.

## Dashboard TTS mode

To enable Voice Output in the dashboard:

```env
JIHN_TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=...
JIHN_TTS_VOICE_ID=...
JIHN_TTS_MODEL_ID=eleven_multilingual_v2
JIHN_TTS_OUTPUT_FORMAT=mp3_44100_128
JIHN_TTS_MODE=text_and_voice
JIHN_TTS_MAX_CHARS=1200
```

Then use the `Voice Output` card in the UI to toggle TTS and auto-play.

## Plugin visibility

The dashboard has a `Plugin Runtime` panel that shows loaded plugins, status, health, and recent plugin events.

## Runtime settings UI

The dashboard includes a `Runtime Settings` panel (Debug Mode) backed by gateway control-plane methods:

- `settings.snapshot`
- `settings.update`

Only allowlisted keys can be updated. Each key shows apply mode:

- `hot`: applied immediately
- `restart_required`: persisted, applied on next process start

Precedence for env vs persisted runtime settings is controlled by:

```env
JIHN_SETTINGS_PRECEDENCE=runtime_over_env # or env_over_runtime
```

## Build and lint

```bash
npm run build --workspace=apps/web
npm run lint --workspace=apps/web
```
