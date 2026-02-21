# Plugin System v1 Specification

Status: proposed  
Scope: `packages/agent-core/src/plugins/*` and host integrations (`apps/cli`, `apps/web`, channel adapters)

## 1. Goals

1. Provide a stable, versioned plugin platform.
1. Keep plugin development simple, testable, and debuggable.
1. Enforce enterprise controls: permissions, isolation, lifecycle, and observability.
1. Preserve current functionality while defining a clean path to v1 hardening.

## 2. Non-Goals (v1)

1. Public marketplace.
1. Multi-language plugin runtime (JS/TS only in v1).
1. Full VM/container sandboxing (process/worker isolation is enough for v1).

## 3. Current Baseline

Existing foundation already present:
1. Manifest discovery and Zod validation: `packages/agent-core/src/plugins/manifest.ts`
1. Runtime loading and hook execution with timeouts/error policy: `packages/agent-core/src/plugins/runtime.ts`
1. Typed plugin contracts and hooks: `packages/agent-core/src/plugins/types.ts`

v1 formalizes and extends this baseline.

## 4. Versioned Contract

### 4.1 API Versioning

1. Keep integer API version (`apiVersion`) in manifest.
1. Host exposes `supportedApiVersions` (start with `[1]`).
1. Loader behavior:
1. Reject plugins with unsupported `apiVersion`.
1. Emit structured load issue with actionable reason.
1. Continue loading other plugins.

### 4.2 Compatibility Rules

1. v1 patch/minor host updates must not break valid v1 plugins.
1. Breaking changes require new API version.
1. Deprecated fields require one release cycle warning before removal.

## 5. Plugin Manifest v1

File: `jihn.plugin.json`

Required fields:
1. `id` (stable identifier)
1. `name`
1. `version` (plugin package version)
1. `apiVersion` (currently `1`)
1. `entry`
1. `enabled`
1. `priority`
1. `capabilities` (non-empty)

Recommended additions for v1 hardening:
1. `minHostVersion?: string`
1. `maxHostVersion?: string`
1. `configSchema?: object` (JSON schema shape for plugin config validation)
1. `permissions?: string[]` (capability-scoped permissions)
1. `healthcheck?: { timeoutMs?: number }`

Validation source of truth remains Zod in `manifest.ts`.

## 6. Capability + Permission Model

Capabilities remain coarse feature gates:
1. `tools`
1. `prompt`
1. `turn`
1. `tool_intercept`

Add fine-grained permissions (new) checked by host policy:
1. `memory.read`
1. `memory.write`
1. `session.read`
1. `session.write`
1. `channel.send`
1. `channel.receive`
1. `network.http`
1. `filesystem.read`
1. `filesystem.write`

Rules:
1. Capability enables plugin surface.
1. Permission enables resource action.
1. Missing permission returns typed denial error and audit log entry.

## 7. Lifecycle Model

Lifecycle hooks (new in v1):
1. `onInstall(context)`
1. `onEnable(context)`
1. `onDisable(context)`
1. `onUnload(context)`
1. `onHealthCheck(context)`

Runtime behavior:
1. Hook timeout enforced by policy (default 2s, configurable).
1. Error handling follows per-hook `onError` (`continue` or `fail`).
1. Repeated failures trigger auto-disable threshold (configurable).

## 8. Runtime Execution Model

### 8.1 Load Pipeline

1. Discover manifests.
1. Validate manifest.
1. Check API compatibility.
1. Load module export (`default` or `plugin`).
1. Validate capabilities against declared hooks/tools.
1. Register plugin and emit load telemetry.

### 8.2 Isolation

v1 requirement:
1. Support `executionMode`:
1. `in_process` (default for dev)
1. `worker_thread` (recommended production default)

Future:
1. `process_isolated` mode for strict deployments.

### 8.3 Circuit Breaker

Per plugin:
1. Track consecutive failures.
1. Open circuit after threshold (example: 5 failures/5 min).
1. Cooldown then half-open probe.
1. Auto recovery or stay open.

## 9. Event Bus Contract

Define typed events emitted by host/runtime:
1. `plugin.loaded`
1. `plugin.failed`
1. `plugin.disabled`
1. `plugin.hook.started`
1. `plugin.hook.completed`
1. `plugin.hook.timed_out`
1. `plugin.tool.executed`
1. `plugin.permission.denied`

All events include:
1. `timestamp`
1. `pluginId`
1. `sessionKey?`
1. `requestId?`
1. `channelId?`
1. `details`

## 10. SDK for Developer Experience

Create package: `packages/plugin-sdk` (new)

Exports:
1. `definePlugin(manifest, factory)` helper
1. Typed hook context interfaces
1. Zod helpers for tool input/output and config schemas
1. Logger adapter with required metadata fields
1. Test harness helpers for local plugin contract tests

DX targets:
1. Minimum boilerplate to create plugin.
1. Strong type inference for hooks and tool schemas.
1. Fast local validation before runtime load.

## 11. CLI + Web Tooling

### 11.1 CLI Commands (new)

1. `jihn plugin create`
1. `jihn plugin validate`
1. `jihn plugin test`
1. `jihn plugin list`
1. `jihn plugin enable <id>`
1. `jihn plugin disable <id>`
1. `jihn plugin inspect <id>`

### 11.2 Web Dashboard

Add plugin control/debug panel:
1. Installed plugins and status.
1. Capabilities and permissions.
1. Hook latency, error rate, last error.
1. Enable/disable action (policy gated).
1. Live event feed and per-plugin logs.

## 12. Observability + Logging

Use structured logs (Pino already in system direction) for plugin runtime:
1. Log keys:
1. `component: "plugin-runtime"`
1. `pluginId`
1. `hook`
1. `durationMs`
1. `outcome`
1. `requestId`
1. `sessionKey`

Metrics:
1. Hook latency histogram.
1. Hook error counter.
1. Tool execution latency/error counters.
1. Permission denial counter.

## 13. Security Controls

1. Default-deny permissions.
1. Explicit policy file for allow/review/deny per plugin permission.
1. Secret redaction in plugin logs.
1. Plugin config schema validation before activation.
1. Optional signature/integrity checks for packaged plugins.

## 14. Test Matrix (Definition of Done)

### 14.1 Unit

1. Manifest schema validation.
1. API version compatibility decisions.
1. Capability-permission checks.
1. Hook timeout/error mode behavior.
1. Circuit breaker transitions.

### 14.2 Integration

1. Plugin load/unload/enable/disable lifecycle.
1. Cross-channel behavior parity (CLI/web/telegram).
1. Permission denial observable in both CLI and web.
1. Event emission consistency.

### 14.3 Contract tests (per plugin)

1. Manifest valid.
1. Hooks return valid types.
1. Tool schemas validate inputs/outputs.
1. No unhandled promise rejection under failure injection.

### 14.4 Regression

1. Existing plugin fixtures continue to run in v1 host.
1. Disabled plugin has zero hook/tool effects.

## 15. Migration Plan from Current State

Phase 1 (safe, low risk):
1. Add API compatibility check to loader.
1. Add structured runtime events/logs around hooks and tools.
1. Add permission skeleton with deny logs (non-breaking defaults).

Phase 2:
1. Introduce lifecycle hooks and plugin status store.
1. Add CLI inspect/validate/list commands.
1. Add dashboard plugin panel.

Phase 3:
1. Add worker-thread execution mode and circuit breaker.
1. Tighten permission enforcement to default-deny for new plugins.
1. Add package integrity checks.

## 16. Proposed File Layout Changes

Inside `packages/agent-core/src/plugins/`:
1. `types.ts` (existing, extended with lifecycle/permissions)
1. `manifest.ts` (existing, schema updates)
1. `runtime.ts` (existing, execution + policies)
1. `permissions.ts` (new)
1. `events.ts` (new)
1. `status-store.ts` (new)
1. `isolation/worker-host.ts` (new)
1. `isolation/worker-runtime.ts` (new)

## 17. Example Plugin v1 Skeleton

```ts
import { definePlugin } from "@jihn/plugin-sdk";

export default definePlugin(
  {
    id: "acme.example",
    name: "Acme Example",
    version: "1.0.0",
    apiVersion: 1,
    capabilities: ["tools", "turn"],
    permissions: ["memory.read"],
  },
  () => ({
    tools: [
      {
        name: "echo",
        description: "Echoes input",
        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
        async execute(input) {
          return String(input.text ?? "");
        },
      },
    ],
    hooks: {
      async beforeTurn(event) {
        return { text: event.text.trim() };
      },
    },
  }),
);
```

## 18. Acceptance Criteria for Plugin Platform v1

1. New plugin can be scaffolded, validated, and tested in under 5 minutes.
1. Host rejects incompatible/unsafe plugins with actionable diagnostics.
1. Plugin failures do not compromise host stability.
1. Permissions and denials are visible in CLI and web debug surfaces.
1. Behavior is deterministic across channels for same session key and inputs.
