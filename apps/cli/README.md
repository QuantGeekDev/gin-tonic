# jihn

Simple TypeScript agent/tool runtime with strict typing, runtime input validation, and explicit architecture boundaries.

## Architecture

```text
src/index.ts (startup / bootstrap)
  -> src/infrastructure/register-tools.ts (tool wiring)
    -> src/tools/registry.ts (register, validate, execute)
      -> src/custom_tools/*.ts (tool implementations)
  -> src/tools/executor.ts (execution application service)
  -> @jihn/agent-core (shared agent orchestration + message types + defaults)

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

1. Create a file in `src/custom_tools/`.
2. Define metadata once with `createToolDefinition(...)`.
3. Implement `parseInput` for runtime validation.
4. Implement `handler` with typed input.
5. Build tool with `createToolFromDefinition(...)`.
6. Register it in `src/infrastructure/register-tools.ts`.
7. Add tests for success and failure modes.

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
- `npm run test:watch`: run Jest in watch mode.
- `npm run lint`: run ESLint (flat config + type-aware rules).
- `npm run lint:fix`: apply lint fixes.
- `npm start`: run compiled app.

## Terminal UI

Jihn now runs as an Ink-powered terminal UI:

- Menu mode:
  - `↑`/`↓` to navigate
  - `Enter` to select
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
- `/tools` switch to tools view
- `/clear` reset transcript/tokens and rotate to a new session ID
- `/menu` return to menu

## Anthropic SDK

- SDK: `@anthropic-ai/sdk`
- Typed model catalog lives in `src/providers/anthropic/config.ts`.
- Default model is `claude-sonnet-4-5-20250929`.
- REPL prints token stats per turn:
  - `est_in`: estimate from `messages.countTokens(...)`
  - `in`/`out`: actual usage from `messages.create(...).usage`

### Env setup

`.env` contains sample values:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
SYSTEM_PROMPT=You are Jihn. Be concise, pragmatic, and use tools whenever they improve accuracy.
AGENT_MAX_TURNS=20
AGENT_MAX_TOKENS=1024
ANTHROPIC_IMAGE_PATH=./assets/example.png
ANTHROPIC_IMAGE_MEDIA_TYPE=image/png
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
