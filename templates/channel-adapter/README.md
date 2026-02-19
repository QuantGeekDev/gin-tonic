# Channel Adapter Template (Service)

Use this template pattern when adding a production channel now.

## Why service adapter (current state)

Jihn plugin runtime currently supports:
- tools
- prompt hooks
- turn hooks
- tool intercept hooks

It does **not** yet provide long-lived channel lifecycle (`onStart`/`onStop`) primitives, so channels should run as dedicated apps/services.

## Required modules

1. `src/config.ts`
- zod-validated env contract
- allowlist/tenant/channel policy inputs

2. `src/bridge.ts`
- normalize inbound channel payload to:
  - `text`
  - `routing` (`agentId`, `scope`, `channelId`, `peerId`)
  - `idempotencyKey`

3. `src/reply.ts`
- channel-specific reply/thread rules
- chunking for channel size limits

4. `src/runtime.ts`
- shared `agent-core` runtime wiring
- MCP + local tools + plugins
- policy + compaction + session/idempotency locking

5. `src/index.ts`
- process lifecycle, signals, graceful shutdown

## Acceptance checklist

- Inbound updates are idempotent.
- Session key strategy is deterministic and documented.
- Replies preserve thread/reply context when channel supports it.
- Adapter logs use structured logger with redaction.
- Startup fails fast on config errors.
- Unit tests cover config + bridge + reply rules.
