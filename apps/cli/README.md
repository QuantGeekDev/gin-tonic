# jihn

Simple TypeScript agent/tool runtime with strict typing, runtime input validation, and explicit architecture boundaries.

## Architecture

```text
src/index.ts (startup / bootstrap)
  -> @jihn/agent-core (shared agent orchestration + tool runtime + MCP overlay)
  -> src/ui/app.tsx (Ink operator UI)

Shared domain contracts/errors:
  - src/domain/tool.ts
  - src/domain/create-tool.ts
  - src/domain/errors.ts
```

## Why this layout

- `domain` keeps core contracts stable and reusable.
- `infrastructure` isolates concrete wiring from business behavior.
- `tools` handles execution concerns in one place.
- `agent` owns orchestration so it can be tested independently.

## Tool authoring DX

Use one of these patterns:

1. `createToolDefinition(...)` + `createToolFromDefinition(...)` for definition-first tools.
2. `createTool(...)` for single-file, all-in-one tools.

Both produce the same runtime `Tool` contract. No base class is required.

## Adding a new tool

Add shared tools in `packages/agent-core/src/runtime/` so both CLI and web get identical behavior.
Use MCP remote tools via `JIHN_MCP_SERVERS` for external integrations without local tool code.
For persistent runtime MCP configuration shared with web, use `JIHN_MCP_SERVERS_FILE` (default: `.jihn/mcp-servers.json`).

### Custom tool template

```ts
import { createToolDefinition, createToolFromDefinition } from "../domain/create-tool.js";

interface EchoInput {
  value: string;
}

const EchoDefinition = createToolDefinition({
  name: "echo",
  description: "Return the input value.",
  inputSchema: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false,
  },
});

export const EchoTool = createToolFromDefinition(EchoDefinition, {
  parseInput(rawInput): EchoInput {
    if (typeof rawInput !== "object" || rawInput === null || Array.isArray(rawInput)) {
      throw new Error("Expected object input.");
    }
    const input = rawInput as Record<string, unknown>;
    if (typeof input.value !== "string") {
      throw new Error("Field 'value' must be a string.");
    }
    return { value: input.value };
  },
  async handler(input) {
    return input.value;
  },
});
```

## Commands

- `npm run dev`: run in watch mode.
- `npm run build`: compile TypeScript.
- `npm run anthropic:sample`: run text + optional image Anthropic SDK samples from `src/examples/anthropic-samples.ts`.
- `npm test`: build and run Jest tests on compiled output.
- `npm run test:behaviors`: run fast CLI behavior verification tests (agent loop + tools + registry).
- `npm run test:watch`: run Jest in watch mode.
- `npm run lint`: run ESLint (flat config + type-aware rules).
- `npm run lint:fix`: apply lint fixes.
- `npm start`: run compiled app.

## Terminal UI

Jihn now runs as an Ink-powered terminal UI:

- Menu mode:
  - `↑`/`↓` to navigate
  - `Enter` to select
  - Includes **Run Diagnostics** for fast runtime checks in terminal
- Chat mode:
  - Type and press `Enter` to send
  - `Esc` to return to menu
  - `Ctrl+C` to quit
  - `PageUp`/`PageDown` to scroll transcript history
- Tools mode:
  - `Esc` or `Enter` to return

The UI includes:
- Dedicated scrollback window (user, assistant, tool logs, errors)
- Operator side panel (mode, status, tools, message count)
- Registered tools view
- Per-turn token metrics (`est_in`, `in`, `out`)
- Persistent keyboard shortcuts help bar

Chat slash commands:
- `/help` show built-in command help in transcript
- `/diagnostics` run quick in-app diagnostics (compaction determinism, routing, session-key checks)
- `/tools` switch to tools view
- `/clear` reset transcript/tokens and rotate to a new session ID
- `/menu` return to menu

## MCP Server Management (CLI)

You can manage remote MCP servers directly from the CLI binary (no env JSON editing required):

- `jihn mcp list`
- `jihn mcp tools`
- `jihn mcp add --id <id> --url <url> [--name <name>] [--auth none|bearer|oauth2] [--token <bearer>] [--scope <scope>] [--client-id <id>] [--client-secret <secret>]`
- `jihn mcp remove --id <id>`
- `jihn mcp oauth begin --id <id>`
- `jihn mcp oauth complete --code <code> --state <state>`

Notes:
- OAuth uses MCP SDK auth flow with discovery/DCR when supported by server.
- Fallback non-DCR is supported by passing `--client-id` and optional `--client-secret`.
- These commands persist server config, so CLI and web can share MCP servers.

## Plugin Management (CLI)

You can manage workspace plugins from the CLI:

- `jihn plugin list`
- `jihn plugin validate [--id <id>]`
- `jihn plugin inspect --id <id>`
- `jihn plugin enable --id <id>`
- `jihn plugin disable --id <id>`
- `jihn plugin create --id <id> [--name <name>]`

Plugin manifests live at `plugins/<pluginId>/jihn.plugin.json`.

## Runtime Settings Management (CLI)

When `JIHN_GATEWAY_URL` is configured, you can manage persisted gateway runtime settings:

- `jihn settings list`
- `jihn settings get --key <SETTING_KEY>`
- `jihn settings set --key <SETTING_KEY> --value <VALUE>`
- `jihn settings model --alias <default|sonnet|haiku>`
- `jihn settings model --id <MODEL_ID>`

Notes:

- Gateway URL is required: `JIHN_GATEWAY_URL=ws://127.0.0.1:18789/ws`
- If gateway auth is enabled, set `JIHN_GATEWAY_TOKEN`.
- The gateway enforces an allowlist, validation, and hot/restart apply modes.
- Model alias switching is hot-applied in gateway runtime; no restart required.

## Shell Completion

Generate completion scripts:

- `jihn completion bash`
- `jihn completion zsh`
- `jihn completion fish`

Settings key completion pulls keys dynamically via:

- `jihn settings keys`

## LLM Providers

CLI uses provider adapters from `@jihn/agent-core`:

- Anthropic adapter (`@anthropic-ai/sdk`)
- OpenAI adapter (`openai`)
- Provider selection via `JIHN_LLM_PROVIDER` (`anthropic` or `openai`)
- REPL prints token stats per turn:
  - `est_in`: estimate from `messages.countTokens(...)`
  - `in`/`out`: actual usage from `messages.create(...).usage`

### Env setup

`.env` contains sample values:

```env
JIHN_LLM_PROVIDER=anthropic
JIHN_LLM_MODEL=
ANTHROPIC_API_KEY=your_anthropic_api_key_here
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4.1
SYSTEM_PROMPT=You are Jihn. Be concise, pragmatic, and use tools whenever they improve accuracy.
AGENT_MAX_TURNS=20
AGENT_MAX_TOKENS=1024
ANTHROPIC_IMAGE_PATH=./assets/example.png
ANTHROPIC_IMAGE_MEDIA_TYPE=image/png
JIHN_TOOL_POLICY_MODE=deny
JIHN_TOOL_POLICY_TOOLS=calculate
JIHN_CONTEXT_TOKEN_BUDGET=8000
JIHN_CONTEXT_TARGET_TOKEN_BUDGET=6400
JIHN_MEMORY_DIR=~/.jihn/memory
JIHN_MCP_SERVERS=[{"id":"docs","url":"https://mcp.example.com/mcp"}]
JIHN_MCP_CACHE_TTL_MS=30000
JIHN_STORAGE_BACKEND=file
DATABASE_URL=postgres://jihn:jihn@localhost:5432/jihn
```

Agent defaults are centralized in `packages/agent-core` and reused by both CLI and web API.

### Vision request sample

The sample script sends an image block + text prompt to Sonnet through
`sendVisionPromptFromFile(...)` in `src/infrastructure/anthropic-client.ts`.

## Test Strategy

- Framework: Jest 30 in ESM mode.
- Scope: tool unit tests (`tests/tools.test.js`) and registry behavior tests (`tests/tool-registry.test.js`).
- Style: table-driven validation tests (`it.each`) for input edge cases and typed error assertions for failure paths.
- Stability: no snapshots for core logic, and deterministic assertions only.
