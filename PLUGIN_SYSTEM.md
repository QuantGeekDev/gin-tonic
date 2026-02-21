# Jihn Plugin System

This document explains the plugin platform that is implemented in this repository: what was built, why those choices were made, and how to use it in practice.

## Core Problem

Jihn needed a plugin model that is:

1. Safe enough for production (permissions, failure isolation behavior, observability).
1. Shared across channels (CLI, web, adapters) so behavior is consistent.
1. Easy for developers to extend without touching core runtime internals.

Without this, extension logic becomes ad hoc, regressions become likely, and operational debugging becomes expensive.

## What Was Implemented

The plugin system was implemented in `packages/agent-core/src/plugins/` and surfaced to CLI/web.

Main components:

1. `types.ts`: canonical plugin contracts (manifest, hooks, lifecycle, events, status, permissions, context).
1. `manifest.ts`: Zod manifest validation and workspace discovery.
1. `runtime.ts`: loading, compatibility checks, hook/tool execution, lifecycle, circuit breaker, permission checks, dependency topological sort, SDK manifest cross-validation, worker thread integration.
1. `permissions.ts`: reusable typed permission checks (`PluginPermissionError`).
1. `context.ts`: per-plugin `PluginContext` with permission-gated resource accessors (memory, session, filesystem, network).
1. `events.ts`: in-memory structured plugin event sink.
1. `status-store.ts`: in-memory per-plugin status snapshots.
1. `persistent-event-sink.ts`: file-backed plugin event sink that persists beyond process lifetime.
1. `persistent-status-store.ts`: file-backed plugin status store that persists beyond process lifetime.
1. `isolation/worker-host.ts`: manages worker threads for isolated plugin execution from the main thread.
1. `isolation/worker-runtime.ts`: runs inside a worker thread, loads plugin modules, handles serialized hook/tool/lifecycle calls.
1. `isolation/protocol.ts`: typed message protocol between worker host and worker runtime.

Channel/runtime integration:

1. CLI plugin commands in `apps/cli/src/index.ts`.
1. Web plugin debug endpoint in `apps/web/app/api/plugins/route.ts`.
1. Web plugin dashboard panel in `apps/web/app/page.tsx`.
1. Shared plugin runtime/debug wiring in `apps/web/app/api/shared-runtime.ts`.
1. Process shutdown handlers in both CLI and web that call `PluginRuntime.shutdown()` on SIGTERM/SIGINT.

SDK for plugin authors:

1. `packages/plugin-sdk/src/index.ts` with `definePlugin(...)`.

## Architecture Choices and Rationale

### 1) Versioned contracts

Choice:

1. `apiVersion` is explicit in manifests.
1. Loader accepts a host-configurable set of supported versions.

Why:

1. Lets us evolve runtime behavior without silently breaking old plugins.
1. Makes compatibility failures explicit and debuggable.

### 2) Two-layer control model: capability + permission with enforcement

Choice:

1. Capabilities gate broad plugin surfaces (`tools`, `prompt`, `turn`, `tool_intercept`).
1. Permissions gate resource-level actions (`memory.*`, `session.*`, `filesystem.*`, `network.http`).
1. Resource access is enforced at runtime through `PluginContext` gated proxies.

Why:

1. Capabilities keep plugin intent clear.
1. Permissions provide finer policy enforced at every resource boundary.
1. A plugin missing `memory.write` cannot write to memory even if it has access to the context object; the proxy throws `PluginPermissionError` before reaching the service.

### 3) PluginContext: permission-gated resource access

Choice:

1. Each plugin receives a `PluginContext` created from its manifest at runtime construction.
1. The context provides `memory`, `session`, `filesystem`, and `network` accessors.
1. Every accessor method checks the manifest permission list before delegating to host services.
1. Context is passed as the second argument to `tool.execute(input, context)`.

Why:

1. Prevents plugins from bypassing declared permissions.
1. Centralizes all permission enforcement into one boundary.
1. Host services are never exposed directly to plugin code.

### 4) Plugin dependency declarations

Choice:

1. Optional `dependencies?: string[]` field in the manifest.
1. Loader validates dependencies exist and performs topological sort.
1. Missing dependencies and cycles are reported as structured load issues.

Why:

1. Plugins that compose on each other (e.g., auth before network) can declare ordering.
1. Cycles are detected at load time, not at runtime.

### 5) SDK manifest cross-validation

Choice:

1. When a plugin module exports a `PluginDefinition` (from `definePlugin()`), the loader cross-validates the embedded SDK manifest against the file manifest.
1. Divergences on `id`, `apiVersion`, `capabilities`, `permissions` produce structured warnings.

Why:

1. Prevents drift between the manifest file (source of truth for the loader) and the code-embedded manifest (source of truth for the developer).

### 6) Lifecycle hooks

Choice:

1. Added `onInstall`, `onEnable`, `onDisable`, `onUnload`, `onHealthCheck`.

Why:

1. Enables deterministic startup/shutdown behavior.
1. Supports operational checks and future platform automation.

### 7) Circuit breaker

Choice:

1. Runtime tracks repeated plugin failures per time window.
1. Plugin moves to `open_circuit` when threshold is exceeded, then recovers after cooldown.

Why:

1. Prevents one unstable plugin from repeatedly degrading requests.
1. Keeps runtime resilient under failure.

### 8) Worker thread isolation

Choice:

1. Manifest declares `executionMode: "in_process" | "worker_thread"`.
1. `worker_thread` plugins are loaded in a dedicated `Worker` thread via `PluginWorkerHost`.
1. All hook/tool/lifecycle calls are serialized through a typed message protocol.
1. The worker runtime loads the plugin module inside the worker, handles messages, and returns results.
1. The main thread interacts with a proxy `JihnPlugin` object that routes all calls through the worker.

Why:

1. Crash isolation: a `worker_thread` plugin cannot crash the host process.
1. Global state isolation: plugin code cannot monkey-patch shared prototypes.
1. Serialization boundary enforces clean data contracts between host and plugin.

### 9) Structured event model

Choice:

1. Runtime emits typed plugin events (`plugin.loaded`, `plugin.hook.completed`, etc.).

Why:

1. Gives deterministic debug history.
1. Enables UI inspection and future telemetry export.

### 10) Persistent event and status storage

Choice:

1. `FilePluginEventSink` and `FilePluginStatusStore` persist to JSON files in a configurable directory.
1. They implement the same `PluginEventSink` and `PluginStatusStore` interfaces as the in-memory stores.
1. Writes are async and non-blocking (fire-and-forget with `mkdir` + `writeFile`).

Why:

1. Plugin status and event history survive process restarts.
1. Enables post-mortem debugging.
1. Same interfaces mean zero changes to the runtime.

### 11) Shared runtime, not channel-specific plugin logic

Choice:

1. Plugin runtime lives in `agent-core` and is consumed by CLI/web/adapters.

Why:

1. Guarantees cross-channel behavior parity.
1. Avoids drift and duplicate implementations.

### 12) Process lifecycle shutdown

Choice:

1. CLI and web both register `SIGTERM`/`SIGINT` handlers that call `PluginRuntime.shutdown()`.
1. `shutdown()` calls `onUnload` lifecycle hooks and terminates worker threads.

Why:

1. Ensures plugins can clean up resources on graceful shutdown.
1. Worker threads are terminated to avoid orphaned processes.

### 13) Race-safe singleton initialization

Choice:

1. Web shared-runtime uses a promise-based lock for plugin runtime initialization.
1. Concurrent requests await the same initialization promise.

Why:

1. Prevents duplicate `loadWorkspacePlugins()` calls when multiple requests arrive during startup.

## Runtime Flow

Load flow (`loadWorkspacePlugins`):

1. Discover manifests under `plugins/*/jihn.plugin.json`.
1. Validate manifest via Zod.
1. Check `apiVersion` support.
1. Check host compatibility (`minHostVersion` / `maxHostVersion`).
1. For `worker_thread` plugins: start a `PluginWorkerHost`, load module in worker, create proxy plugin.
1. For `in_process` plugins: import plugin module and normalize export. Cross-validate SDK manifest if present.
1. Validate capability-to-hook/tool consistency.
1. Run lifecycle install/enable hooks.
1. Validate dependencies (missing, cycles) via topological sort.
1. Return loaded plugins + structured issues + worker hosts.

Execution flow (`PluginRuntime`):

1. Create per-plugin `PluginContext` with permission-gated resource proxies.
1. Register plugin tools with namespacing `<pluginId>.<toolName>`.
1. Execute hooks with timeout/error policy.
1. Pass `PluginContext` to tool execution as second argument.
1. Emit events for hook start/complete/failure/timeout.
1. Track status and failure counters.
1. Open circuit when failure threshold is reached.

## Files and Responsibilities

1. `packages/agent-core/src/plugins/types.ts`
Defines contracts used by all plugin modules, including `PluginContext` and resource accessor interfaces.

1. `packages/agent-core/src/plugins/manifest.ts`
Manifest schema, parsing, and discovery. Includes `dependencies` field.

1. `packages/agent-core/src/plugins/runtime.ts`
Core orchestration: loading, topological sort, SDK cross-validation, hook/tool execution, circuit breaker, worker host integration.

1. `packages/agent-core/src/plugins/context.ts`
Creates per-plugin `PluginContext` with permission-gated proxies for memory, session, filesystem, network.

1. `packages/agent-core/src/plugins/permissions.ts`
Permission helper and typed permission errors.

1. `packages/agent-core/src/plugins/events.ts`
In-memory event sink with bounded retention.

1. `packages/agent-core/src/plugins/status-store.ts`
In-memory plugin status persistence for runtime process.

1. `packages/agent-core/src/plugins/persistent-event-sink.ts`
File-backed event sink that persists across process restarts.

1. `packages/agent-core/src/plugins/persistent-status-store.ts`
File-backed status store that persists across process restarts.

1. `packages/agent-core/src/plugins/isolation/protocol.ts`
Typed message protocol for worker thread communication.

1. `packages/agent-core/src/plugins/isolation/worker-host.ts`
Main-thread manager for worker threads. Creates proxy `JihnPlugin` objects.

1. `packages/agent-core/src/plugins/isolation/worker-runtime.ts`
Worker-thread side: loads plugin module, handles serialized requests.

1. `packages/plugin-sdk/src/index.ts`
Authoring helper APIs for plugin developers.

## How To Use the Plugin System

### 1) Create plugin directory

Create:

1. `plugins/<pluginId>/jihn.plugin.json`
1. `plugins/<pluginId>/index.mjs` (or your configured entry file)

Or scaffold from CLI:

```bash
npm run build --workspace=apps/cli
npm run start --workspace=apps/cli -- plugin create --id my-plugin --name "My Plugin"
```

### 2) Write manifest

Example `plugins/my-plugin/jihn.plugin.json`:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "index.mjs",
  "enabled": true,
  "priority": 10,
  "capabilities": ["tools", "turn"],
  "permissions": ["memory.read"],
  "executionMode": "in_process",
  "dependencies": [],
  "compatibility": {
    "minHostVersion": "1.0.0"
  },
  "healthcheck": {
    "timeoutMs": 2000
  }
}
```

Use `"executionMode": "worker_thread"` for isolated execution.

### 3) Write plugin module

Example `plugins/my-plugin/index.mjs`:

```js
export default {
  tools: [
    {
      name: "echo",
      description: "Echo input text",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"]
      },
      async execute(input, context) {
        // context.hasPermission("memory.read") -> true
        // context.memory.read("query") -> works
        // context.memory.write("text") -> throws PluginPermissionError (not declared)
        return String(input.text ?? "");
      }
    }
  ],
  hooks: {
    beforeTurn(event) {
      return { text: event.text.trim() };
    }
  },
  lifecycle: {
    async onEnable(ctx) {
      console.log("enabled", ctx.pluginId);
    },
    async onHealthCheck() {
      return { healthy: true };
    }
  }
};
```

### 4) Validate and inspect

```bash
npm run start --workspace=apps/cli -- plugin validate
npm run start --workspace=apps/cli -- plugin inspect --id my-plugin
npm run start --workspace=apps/cli -- plugin list
```

### 5) Enable/disable

```bash
npm run start --workspace=apps/cli -- plugin disable --id my-plugin
npm run start --workspace=apps/cli -- plugin enable --id my-plugin
```

## Writing Plugins with the SDK

The SDK package is at `packages/plugin-sdk`.

Example:

```ts
import { definePlugin, type PluginContext } from "@jihn/plugin-sdk";

export default definePlugin(
  {
    id: "acme.demo",
    name: "Acme Demo",
    version: "1.0.0",
    apiVersion: 1,
    capabilities: ["tools"],
    permissions: ["memory.read"],
    dependencies: [],
  },
  () => ({
    tools: [
      {
        name: "ping",
        description: "Ping tool",
        inputSchema: { type: "object", properties: {} },
        async execute(input, context) {
          if (context?.hasPermission("memory.read")) {
            const results = await context.memory.read("recent");
            return `pong (${results.length} memories)`;
          }
          return "pong";
        }
      }
    ]
  }),
);
```

The loader cross-validates the SDK manifest against the file manifest. If `id`, `apiVersion`, `capabilities`, or `permissions` diverge, structured warnings are emitted as load issues.

## Debugging and Observability

### Web dashboard

The dashboard includes a `Plugin Runtime` panel showing:

1. Loaded plugin manifests.
1. Status per plugin (`enabled`, `disabled`, `open_circuit`).
1. Health-check results.
1. Recent plugin runtime events.

### API

Endpoint:

1. `GET /api/plugins`

Returns:

1. `plugins`
1. `statuses`
1. `events`
1. `health`

### Event types

Current emitted events:

1. `plugin.loaded`
1. `plugin.failed`
1. `plugin.disabled`
1. `plugin.hook.started`
1. `plugin.hook.completed`
1. `plugin.hook.timed_out`
1. `plugin.tool.executed`
1. `plugin.permission.denied`

## Security and Reliability Model

1. Manifest-level capability declarations are mandatory.
1. Permission checks are enforced at runtime through `PluginContext` gated proxies. A plugin cannot access memory, sessions, filesystem, or network without the corresponding permission declared in its manifest.
1. Hook execution is bounded by timeouts.
1. Error mode is policy-driven (`continue` or `fail`).
1. Circuit breaker protects runtime from repeated plugin failures.
1. Plugin load issues are surfaced instead of failing the whole workspace.
1. `worker_thread` execution mode isolates plugin code in a separate V8 thread with a serialization boundary.
1. `onUnload` lifecycle hooks are called on process shutdown via SIGTERM/SIGINT handlers.

## Operational Notes

1. `executionMode: "worker_thread"` loads and runs the plugin in a dedicated `Worker` thread. All hook/tool calls are serialized through structured messages.
1. `executionMode: "in_process"` (default) runs the plugin in the same V8 isolate as the host.
1. Circuit breaker defaults can be tuned through `PluginRuntime` options.
1. Plugin events/status can use in-memory stores (default) or file-backed persistent stores (`FilePluginEventSink`, `FilePluginStatusStore`).
1. `dependencies` in the manifest triggers topological sort during loading. Cycles and missing dependencies are reported as structured load issues.

## Testing and Validation in This Repo

Primary tests:

1. `packages/agent-core/tests/plugins-runtime.test.js`

Covers:

1. Deterministic hook priority ordering.
1. Hook timeout fail-open/fail-closed behavior.
1. Tool exposure and execution.
1. Permission denial and typed permission errors.
1. Circuit breaker transitions.
1. API version compatibility rejection.
1. Lifecycle hook execution during load.
1. Dependency topological sort (ordering, cycle detection, missing deps).
1. Plugin context permission enforcement (memory, session, filesystem, network).
1. Context passed to tool execute.
1. Event sink `list()` interface compliance.
1. File-backed persistent status store (write + reload).
1. File-backed persistent event sink (write + reload).
1. Shutdown lifecycle hooks (`onUnload`).
1. Missing dependency detection during workspace loading.

Run:

```bash
npm run test --workspace=packages/agent-core
```

## Why This Is Enterprise-Grade (Current Level)

1. Explicit contracts with strong runtime validation (Zod + TypeScript types).
1. Controlled extension points with policy-enforced behavior.
1. Failure containment (timeouts + circuit breaker).
1. Permission enforcement at resource boundaries via `PluginContext` proxies.
1. Worker thread isolation for untrusted or crash-prone plugins.
1. Plugin dependency ordering with cycle detection.
1. SDK manifest cross-validation preventing code/file drift.
1. Persistent event/status storage for post-mortem debugging.
1. Graceful shutdown with lifecycle hook invocation.
1. Race-safe singleton initialization in web runtime.
1. Cross-channel consistency via shared `agent-core` runtime.
1. Operational visibility via structured plugin event/status surfaces.

## Known Next Steps

1. Add signed plugin packages and integrity verification.
1. Add policy-controlled runtime enable/disable actions in web UI.
1. Add `configSchema` validation for plugin-specific configuration.
1. Add structured logging integration (Pino) for plugin runtime events.
1. Add plugin marketplace/registry support.
