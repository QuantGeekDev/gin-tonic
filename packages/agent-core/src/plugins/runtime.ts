import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { PluginWorkerHost } from "./isolation/worker-host.js";
import { discoverPluginManifests } from "./manifest.js";
import { InMemoryPluginEventSink } from "./events.js";
import {
  hasPluginPermission,
  PluginPermissionError,
  requirePluginPermission,
} from "./permissions.js";
import { InMemoryPluginStatusStore } from "./status-store.js";
import { createPluginContext, type PluginContextServices } from "./context.js";
import type {
  JihnPlugin,
  JihnPluginModule,
  LoadedPlugin,
  PluginAfterToolCallEvent,
  PluginBeforeToolCallEvent,
  PluginContext,
  PluginEvent,
  PluginEventSink,
  PluginHookErrorMode,
  PluginHookName,
  PluginIsolationPolicy,
  PluginLoadIssue,
  PluginLoadResult,
  PluginManifest,
  PluginPermission,
  PluginPromptComposeContext,
  PluginRoutingContext,
  PluginRuntimeLogger,
  PluginStatusSnapshot,
  PluginStatusStore,
  PluginToolDefinition,
  PluginTurnResult,
} from "./types.js";
import { PLUGIN_CAPABILITIES } from "./types.js";
import {
  resolvePluginExecutionMode,
  DEFAULT_ISOLATION_POLICY,
} from "./isolation/policy.js";
import type { PluginSecretBroker } from "./isolation/secret-broker.js";
import type { ToolDefinition } from "../tools.js";

const DEFAULT_HOOK_TIMEOUT_MS = 2_000;
const DEFAULT_HOOK_ERROR_MODE = "continue" as const;
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 5;
const DEFAULT_GRANT_CLEANUP_INTERVAL_MS = 60_000; // 1 minute
const DEFAULT_CIRCUIT_COOLDOWN_MS = 5 * 60_000;
const DEFAULT_CIRCUIT_TIME_WINDOW_MS = 5 * 60_000;
export const DEFAULT_PLUGIN_HOST_VERSION = "1.0.0";
export const DEFAULT_SUPPORTED_PLUGIN_API_VERSIONS = [1] as const;

const DEFAULT_LOGGER: PluginRuntimeLogger = {
  warn: () => undefined,
  error: () => undefined,
};

interface PluginFailureState {
  timestamps: number[];
}

export interface PluginCircuitBreakerOptions {
  failureThreshold?: number | undefined;
  cooldownMs?: number | undefined;
  timeWindowMs?: number | undefined;
}

export interface PluginRuntimeOptions {
  logger?: PluginRuntimeLogger | undefined;
  eventSink?: PluginEventSink | undefined;
  statusStore?: PluginStatusStore | undefined;
  circuitBreaker?: PluginCircuitBreakerOptions | undefined;
  contextServices?: PluginContextServices | undefined;
  secretBroker?: PluginSecretBroker | undefined;
}

export interface LoadWorkspacePluginsOptions {
  workspaceDir?: string;
  pluginsDirectoryName?: string;
  logger?: PluginRuntimeLogger;
  hostVersion?: string;
  supportedApiVersions?: number[];
  isolationPolicy?: PluginIsolationPolicy;
  eventSink?: PluginEventSink;
}

interface PluginDefinitionShape {
  manifest: PluginManifest;
  create: () => Promise<JihnPlugin> | JihnPlugin;
}

function isPluginDefinition(value: unknown): value is PluginDefinitionShape {
  return (
    typeof value === "object" &&
    value !== null &&
    "manifest" in value &&
    "create" in value &&
    typeof (value as PluginDefinitionShape).manifest === "object" &&
    typeof (value as PluginDefinitionShape).create === "function"
  );
}

function crossValidateManifests(
  fileManifest: PluginManifest,
  embeddedManifest: PluginManifest,
): string[] {
  const warnings: string[] = [];
  if (fileManifest.id !== embeddedManifest.id) {
    warnings.push(`id mismatch: file="${fileManifest.id}" sdk="${embeddedManifest.id}"`);
  }
  if (fileManifest.apiVersion !== embeddedManifest.apiVersion) {
    warnings.push(
      `apiVersion mismatch: file=${fileManifest.apiVersion} sdk=${embeddedManifest.apiVersion}`,
    );
  }
  const fileCaps = [...fileManifest.capabilities].sort().join(",");
  const sdkCaps = [...embeddedManifest.capabilities].sort().join(",");
  if (fileCaps !== sdkCaps) {
    warnings.push(`capabilities mismatch: file=[${fileCaps}] sdk=[${sdkCaps}]`);
  }
  const filePerms = [...(fileManifest.permissions ?? [])].sort().join(",");
  const sdkPerms = [...(embeddedManifest.permissions ?? [])].sort().join(",");
  if (filePerms !== sdkPerms) {
    warnings.push(`permissions mismatch: file=[${filePerms}] sdk=[${sdkPerms}]`);
  }
  return warnings;
}

function normalizePluginExport(moduleValue: JihnPluginModule): JihnPlugin | null {
  const raw = moduleValue.default ?? moduleValue.plugin;
  if (raw === undefined) {
    return null;
  }
  if (isPluginDefinition(raw)) {
    const result = raw.create();
    if (result instanceof Promise) {
      throw new Error("Async plugin factory is not supported in sync path");
    }
    return result;
  }
  if (typeof raw === "function") {
    const result = raw();
    if (result instanceof Promise) {
      throw new Error("Async plugin factory is not supported in sync path");
    }
    return result;
  }
  return raw;
}

async function normalizePluginExportAsync(
  moduleValue: JihnPluginModule,
  fileManifest: PluginManifest,
  issues: PluginLoadIssue[],
): Promise<JihnPlugin | null> {
  const raw = moduleValue.default ?? moduleValue.plugin;
  if (raw === undefined) {
    return null;
  }
  if (isPluginDefinition(raw)) {
    const warnings = crossValidateManifests(fileManifest, raw.manifest);
    for (const warning of warnings) {
      issues.push({
        pluginId: fileManifest.id,
        level: "warn",
        message: `SDK manifest divergence: ${warning}`,
      });
    }
    return await raw.create();
  }
  if (typeof raw === "function") {
    return await raw();
  }
  return raw;
}

function hasCapability(manifest: PluginManifest, capability: (typeof PLUGIN_CAPABILITIES)[number]): boolean {
  return manifest.capabilities.includes(capability);
}

function validateCapabilities(plugin: JihnPlugin, manifest: PluginManifest): void {
  if ((plugin.tools?.length ?? 0) > 0 && !hasCapability(manifest, "tools")) {
    throw new Error(`plugin ${manifest.id} provides tools but missing capability "tools"`);
  }

  const hooks = plugin.hooks;
  if (!hooks) {
    return;
  }
  if ((hooks.beforePromptCompose || hooks.afterPromptCompose) && !hasCapability(manifest, "prompt")) {
    throw new Error(`plugin ${manifest.id} provides prompt hooks but missing capability "prompt"`);
  }
  if ((hooks.beforeTurn || hooks.afterTurn) && !hasCapability(manifest, "turn")) {
    throw new Error(`plugin ${manifest.id} provides turn hooks but missing capability "turn"`);
  }
  if ((hooks.beforeToolCall || hooks.afterToolCall) && !hasCapability(manifest, "tool_intercept")) {
    throw new Error(
      `plugin ${manifest.id} provides tool interception hooks but missing capability "tool_intercept"`,
    );
  }
}

export function topologicalSortPlugins(
  entries: LoadedPlugin[],
): { sorted: LoadedPlugin[]; cycles: string[][]; missingDeps: Array<{ pluginId: string; missing: string }> } {
  const idMap = new Map<string, LoadedPlugin>();
  for (const entry of entries) {
    idMap.set(entry.manifest.id, entry);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const order: LoadedPlugin[] = [];
  const cycles: string[][] = [];
  const missingDeps: Array<{ pluginId: string; missing: string }> = [];

  for (const entry of entries) {
    for (const dep of entry.manifest.dependencies ?? []) {
      if (!idMap.has(dep)) {
        missingDeps.push({ pluginId: entry.manifest.id, missing: dep });
      }
    }
  }

  function visit(id: string, path: string[]): void {
    if (visited.has(id)) {
      return;
    }
    if (inStack.has(id)) {
      const cycleStart = path.indexOf(id);
      cycles.push(path.slice(cycleStart).concat(id));
      return;
    }
    const entry = idMap.get(id);
    if (!entry) {
      return;
    }
    inStack.add(id);
    for (const dep of entry.manifest.dependencies ?? []) {
      visit(dep, [...path, id]);
    }
    inStack.delete(id);
    visited.add(id);
    order.push(entry);
  }

  for (const entry of entries) {
    visit(entry.manifest.id, []);
  }

  return { sorted: order, cycles, missingDeps };
}

function sortPluginsByPriority(entries: LoadedPlugin[]): LoadedPlugin[] {
  return [...entries].sort((a, b) => {
    if (a.manifest.priority !== b.manifest.priority) {
      return b.manifest.priority - a.manifest.priority;
    }
    return a.manifest.id.localeCompare(b.manifest.id);
  });
}

function parseVersion(input: string): number[] | null {
  const normalized = input.trim();
  if (!/^\d+\.\d+\.\d+([-.][a-z0-9.]+)?$/i.test(normalized)) {
    return null;
  }
  const core = normalized.split(/[-+]/, 1)[0];
  if (!core) {
    return null;
  }
  return core.split(".").map((part) => Number(part));
}

function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a === null || b === null) {
    return null;
  }
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function isHostVersionCompatible(manifest: PluginManifest, hostVersion: string): { ok: boolean; reason?: string } {
  if (manifest.compatibility?.minHostVersion) {
    const compared = compareVersions(hostVersion, manifest.compatibility.minHostVersion);
    if (compared === null) {
      return {
        ok: false,
        reason: `invalid minHostVersion "${manifest.compatibility.minHostVersion}"`,
      };
    }
    if (compared < 0) {
      return {
        ok: false,
        reason: `requires host >= ${manifest.compatibility.minHostVersion}, received ${hostVersion}`,
      };
    }
  }

  if (manifest.compatibility?.maxHostVersion) {
    const compared = compareVersions(hostVersion, manifest.compatibility.maxHostVersion);
    if (compared === null) {
      return {
        ok: false,
        reason: `invalid maxHostVersion "${manifest.compatibility.maxHostVersion}"`,
      };
    }
    if (compared > 0) {
      return {
        ok: false,
        reason: `requires host <= ${manifest.compatibility.maxHostVersion}, received ${hostVersion}`,
      };
    }
  }

  return { ok: true };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

export class PluginRuntime {
  private readonly plugins: LoadedPlugin[];
  private readonly logger: PluginRuntimeLogger;
  private readonly toolMap: Map<string, PluginToolDefinition>;
  private readonly toolOwnerMap: Map<string, string>;
  private readonly pluginMap: Map<string, LoadedPlugin>;
  private readonly contextMap: Map<string, PluginContext>;
  private readonly eventSink: PluginEventSink;
  private readonly statusStore: PluginStatusStore;
  private readonly workerHosts = new Map<string, PluginWorkerHost>();
  private readonly failureState = new Map<string, PluginFailureState>();
  private readonly secretBroker: PluginSecretBroker | null = null;
  private grantCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly breakerThreshold: number;
  private readonly breakerCooldownMs: number;
  private readonly breakerWindowMs: number;

  public constructor(entries: LoadedPlugin[], options: PluginRuntimeOptions = {}) {
    this.plugins = sortPluginsByPriority(entries.filter((entry) => entry.manifest.enabled));
    this.logger = options.logger ?? DEFAULT_LOGGER;
    this.eventSink = options.eventSink ?? new InMemoryPluginEventSink();
    this.statusStore = options.statusStore ?? new InMemoryPluginStatusStore();
    this.breakerThreshold =
      options.circuitBreaker?.failureThreshold ?? DEFAULT_CIRCUIT_FAILURE_THRESHOLD;
    this.breakerCooldownMs =
      options.circuitBreaker?.cooldownMs ?? DEFAULT_CIRCUIT_COOLDOWN_MS;
    this.breakerWindowMs =
      options.circuitBreaker?.timeWindowMs ?? DEFAULT_CIRCUIT_TIME_WINDOW_MS;
    this.toolMap = new Map();
    this.toolOwnerMap = new Map();
    this.pluginMap = new Map();
    this.contextMap = new Map();
    // Secret broker lifecycle integration
    if (options.secretBroker) {
      this.secretBroker = options.secretBroker;
      this.grantCleanupTimer = setInterval(() => {
        options.secretBroker!.cleanupExpired();
      }, DEFAULT_GRANT_CLEANUP_INTERVAL_MS);
      this.grantCleanupTimer.unref();
    }
    const contextServices = options.contextServices ?? {};
    // Inject deny callback for audit events from capability enforcement
    const eventSinkRef = this.eventSink;
    if (!contextServices.onDeny) {
      contextServices.onDeny = (event) => {
        eventSinkRef.emit({
          timestamp: nowIso(),
          name: "plugin.permission.denied",
          pluginId: event.pluginId,
          details: {
            permission: event.permission,
            operation: event.operation,
            target: event.target,
            reason: event.reason,
          },
        });
      };
    }

    for (const entry of this.plugins) {
      this.pluginMap.set(entry.manifest.id, entry);
      this.contextMap.set(
        entry.manifest.id,
        createPluginContext(entry.manifest, contextServices),
      );
      this.statusStore.update({
        pluginId: entry.manifest.id,
        state: "enabled",
        consecutiveFailures: 0,
        lastUpdatedAt: nowIso(),
      });
      this.emitEvent({
        name: "plugin.loaded",
        pluginId: entry.manifest.id,
        details: {
          version: entry.manifest.version,
          apiVersion: entry.manifest.apiVersion,
        },
      });
      for (const tool of entry.plugin.tools ?? []) {
        const exposedName = `${entry.manifest.id}.${tool.name}`;
        if (this.toolMap.has(exposedName)) {
          throw new Error(`duplicate plugin tool name: ${exposedName}`);
        }
        this.toolMap.set(exposedName, tool);
        this.toolOwnerMap.set(exposedName, entry.manifest.id);
      }
    }
  }

  public listPlugins(): PluginManifest[] {
    return this.plugins.map((entry) => entry.manifest);
  }

  public getPluginContext(pluginId: string): PluginContext | null {
    return this.contextMap.get(pluginId) ?? null;
  }

  public listStatuses(): PluginStatusSnapshot[] {
    return this.statusStore.list();
  }

  public listEvents(): PluginEvent[] {
    return this.eventSink.list();
  }

  public getToolDefinitions(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const entry of this.plugins) {
      if (!this.isPluginUsable(entry.manifest.id)) {
        continue;
      }
      for (const tool of entry.plugin.tools ?? []) {
        tools.push({
          name: `${entry.manifest.id}.${tool.name}`,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
    }
    return tools;
  }

  public hasTool(toolName: string): boolean {
    const [pluginId] = toolName.split(".", 1);
    if (!pluginId || !this.isPluginUsable(pluginId)) {
      return false;
    }
    return this.toolMap.has(toolName);
  }

  public assertPermission(pluginId: string, permission: PluginPermission): void {
    const entry = this.pluginMap.get(pluginId);
    if (!entry) {
      throw new Error(`unknown plugin: ${pluginId}`);
    }
    try {
      requirePluginPermission(entry.manifest, permission);
    } catch (error) {
      this.emitEvent({
        name: "plugin.permission.denied",
        pluginId,
        details: { permission },
      });
      throw error;
    }
  }

  public hasPermission(pluginId: string, permission: PluginPermission): boolean {
    const entry = this.pluginMap.get(pluginId);
    if (!entry) {
      return false;
    }
    return hasPluginPermission(entry.manifest, permission);
  }

  public async disablePlugin(pluginId: string, reason = "operator_disabled"): Promise<void> {
    const status = this.statusStore.get(pluginId);
    if (status === null) {
      return;
    }
    const entry = this.pluginMap.get(pluginId);
    this.statusStore.update({
      ...status,
      state: "disabled",
      lastError: reason,
      lastUpdatedAt: nowIso(),
    });
    // Revoke all active secret grants for this plugin immediately.
    this.secretBroker?.revokePluginGrants(pluginId);
    if (entry?.plugin.lifecycle?.onDisable) {
      await Promise.resolve(
        entry.plugin.lifecycle.onDisable({
          pluginId: entry.manifest.id,
          nowIso: nowIso(),
        }),
      );
    }
    this.emitEvent({
      name: "plugin.disabled",
      pluginId,
      details: { reason },
    });
  }

  public async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    const [pluginId] = name.split(".", 1);
    if (!pluginId || !this.isPluginUsable(pluginId)) {
      throw new Error(`Plugin unavailable for tool: ${name}`);
    }

    const tool = this.toolMap.get(name);
    if (!tool) {
      throw new Error(`Unknown plugin tool: ${name}`);
    }

    const startedAt = Date.now();
    const context = this.contextMap.get(pluginId);
    try {
      const output = await tool.execute(input, context);
      this.recordSuccess(pluginId);
      this.emitEvent({
        name: "plugin.tool.executed",
        pluginId,
        details: { name, durationMs: Date.now() - startedAt },
      });
      return output;
    } catch (error) {
      this.recordFailure(pluginId, error);
      throw error;
    }
  }

  public async applyPromptHooks(
    prompt: string,
    context: PluginPromptComposeContext,
  ): Promise<string> {
    let current = prompt;

    for (const entry of this.plugins) {
      if (!this.isPluginUsable(entry.manifest.id)) {
        continue;
      }
      const hook = entry.plugin.hooks?.beforePromptCompose;
      if (!hook) {
        continue;
      }
      const value = await this.executeHookWithPolicy(
        entry,
        "before_prompt_compose",
        () => Promise.resolve(hook({ prompt: current, context })),
      );
      if (typeof value === "string" && value.trim().length > 0) {
        current = value;
      }
    }

    for (const entry of this.plugins) {
      if (!this.isPluginUsable(entry.manifest.id)) {
        continue;
      }
      const hook = entry.plugin.hooks?.afterPromptCompose;
      if (!hook) {
        continue;
      }
      const value = await this.executeHookWithPolicy(
        entry,
        "after_prompt_compose",
        () => Promise.resolve(hook({ prompt: current, context })),
      );
      if (typeof value === "string" && value.trim().length > 0) {
        current = value;
      }
    }

    return current;
  }

  public async applyBeforeTurnHooks(event: {
    text: string;
    systemPrompt: string;
    routing: PluginRoutingContext;
  }): Promise<{ text: string; systemPrompt: string }> {
    let state = { ...event };

    for (const entry of this.plugins) {
      if (!this.isPluginUsable(entry.manifest.id)) {
        continue;
      }
      const hook = entry.plugin.hooks?.beforeTurn;
      if (!hook) {
        continue;
      }
      const result = await this.executeHookWithPolicy(entry, "before_turn", () =>
        Promise.resolve(hook(state)),
      );
      if (result && typeof result === "object") {
        if (typeof result.text === "string" && result.text.trim().length > 0) {
          state = { ...state, text: result.text };
        }
        if (
          typeof result.systemPrompt === "string" &&
          result.systemPrompt.trim().length > 0
        ) {
          state = { ...state, systemPrompt: result.systemPrompt };
        }
      }
    }

    return {
      text: state.text,
      systemPrompt: state.systemPrompt,
    };
  }

  public async runAfterTurnHooks(event: {
    text: string;
    systemPrompt: string;
    routing: PluginRoutingContext;
    result: PluginTurnResult;
  }): Promise<void> {
    for (const entry of this.plugins) {
      if (!this.isPluginUsable(entry.manifest.id)) {
        continue;
      }
      const hook = entry.plugin.hooks?.afterTurn;
      if (!hook) {
        continue;
      }
      await this.executeHookWithPolicy(entry, "after_turn", () =>
        Promise.resolve(hook(event)),
      );
    }
  }

  public async applyBeforeToolCallHooks(event: PluginBeforeToolCallEvent): Promise<Record<string, unknown>> {
    let input = { ...event.input };

    for (const entry of this.plugins) {
      if (!this.isPluginUsable(entry.manifest.id)) {
        continue;
      }
      const hook = entry.plugin.hooks?.beforeToolCall;
      if (!hook) {
        continue;
      }
      const result = await this.executeHookWithPolicy(entry, "before_tool_call", () =>
        Promise.resolve(
          hook({
            ...event,
            input,
          }),
        ),
      );
      if (result && typeof result === "object" && result.input && typeof result.input === "object") {
        input = result.input as Record<string, unknown>;
      }
    }

    return input;
  }

  public async applyAfterToolCallHooks(event: PluginAfterToolCallEvent): Promise<string> {
    let output = event.output;

    for (const entry of this.plugins) {
      if (!this.isPluginUsable(entry.manifest.id)) {
        continue;
      }
      const hook = entry.plugin.hooks?.afterToolCall;
      if (!hook) {
        continue;
      }
      const result = await this.executeHookWithPolicy(entry, "after_tool_call", () =>
        Promise.resolve(
          hook({
            ...event,
            output,
          }),
        ),
      );
      if (result && typeof result === "object" && typeof result.output === "string") {
        output = result.output;
      }
    }

    return output;
  }

  public async runHealthChecks(): Promise<Record<string, { healthy: boolean; details?: string }>> {
    const results: Record<string, { healthy: boolean; details?: string }> = {};
    for (const entry of this.plugins) {
      const healthcheck = entry.plugin.lifecycle?.onHealthCheck;
      if (!healthcheck) {
        results[entry.manifest.id] = { healthy: true };
        continue;
      }
      const timeoutMs = entry.manifest.healthcheck?.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
      try {
        const result = await withTimeout(
          Promise.resolve(
            healthcheck({
              pluginId: entry.manifest.id,
              nowIso: nowIso(),
            }),
          ),
          timeoutMs,
          `plugin healthcheck timeout (${entry.manifest.id})`,
        );
        if (result && typeof result === "object" && typeof result.healthy === "boolean") {
          results[entry.manifest.id] = result;
        } else {
          results[entry.manifest.id] = { healthy: true };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results[entry.manifest.id] = { healthy: false, details: message };
      }
    }
    return results;
  }

  public registerWorkerHost(pluginId: string, host: PluginWorkerHost): void {
    this.workerHosts.set(pluginId, host);
  }

  public async shutdown(): Promise<void> {
    // Stop the grant cleanup timer.
    if (this.grantCleanupTimer) {
      clearInterval(this.grantCleanupTimer);
      this.grantCleanupTimer = null;
    }
    for (const entry of this.plugins) {
      // Revoke all active secret grants for each plugin on unload.
      this.secretBroker?.revokePluginGrants(entry.manifest.id);
      const unload = entry.plugin.lifecycle?.onUnload;
      if (!unload) {
        continue;
      }
      try {
        await withTimeout(
          Promise.resolve(
            unload({
              pluginId: entry.manifest.id,
              nowIso: nowIso(),
            }),
          ),
          DEFAULT_HOOK_TIMEOUT_MS,
          `plugin lifecycle timeout (${entry.manifest.id}.onUnload)`,
        );
      } catch {
        // best-effort on shutdown
      }
    }
    for (const host of this.workerHosts.values()) {
      try {
        await host.shutdown();
      } catch {
        // best-effort on shutdown
      }
    }
    this.workerHosts.clear();
  }

  private resolvePolicy(
    entry: LoadedPlugin,
    hookName: PluginHookName,
  ): { timeoutMs: number; onError: PluginHookErrorMode } {
    const policy =
      entry.manifest.hookPolicies?.[hookName] ??
      entry.manifest.hookPolicy ??
      {};
    return {
      timeoutMs: policy.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
      onError: policy.onError ?? DEFAULT_HOOK_ERROR_MODE,
    };
  }

  private isPluginUsable(pluginId: string): boolean {
    const status = this.statusStore.get(pluginId);
    if (status === null) {
      return false;
    }
    if (status.state === "enabled") {
      return true;
    }
    if (status.state === "disabled") {
      return false;
    }
    if (status.state === "open_circuit") {
      if (!status.circuitOpenedAt) {
        return false;
      }
      const openedAt = Date.parse(status.circuitOpenedAt);
      if (!Number.isFinite(openedAt)) {
        return false;
      }
      if (Date.now() - openedAt >= this.breakerCooldownMs) {
        this.statusStore.update({
          ...status,
          state: "enabled",
          consecutiveFailures: 0,
          circuitOpenedAt: undefined,
          lastUpdatedAt: nowIso(),
        });
        return true;
      }
      return false;
    }
    return false;
  }

  private recordSuccess(pluginId: string): void {
    const status = this.statusStore.get(pluginId);
    if (status === null) {
      return;
    }
    this.failureState.delete(pluginId);
    this.statusStore.update({
      ...status,
      state: "enabled",
      consecutiveFailures: 0,
      circuitOpenedAt: undefined,
      lastUpdatedAt: nowIso(),
    });
  }

  private recordFailure(pluginId: string, error: unknown): void {
    const previous = this.failureState.get(pluginId) ?? { timestamps: [] };
    const now = Date.now();
    const kept = previous.timestamps.filter((value) => now - value <= this.breakerWindowMs);
    kept.push(now);
    this.failureState.set(pluginId, { timestamps: kept });

    const status = this.statusStore.get(pluginId);
    if (status === null) {
      return;
    }
    const shouldOpen = kept.length >= this.breakerThreshold;
    this.statusStore.update({
      ...status,
      state: shouldOpen ? "open_circuit" : status.state,
      consecutiveFailures: kept.length,
      circuitOpenedAt: shouldOpen ? nowIso() : status.circuitOpenedAt,
      lastError: error instanceof Error ? error.message : String(error),
      lastUpdatedAt: nowIso(),
    });
    if (shouldOpen) {
      this.emitEvent({
        name: "plugin.disabled",
        pluginId,
        details: { reason: "circuit_opened", consecutiveFailures: kept.length },
      });
    }
  }

  private emitEvent(input: Omit<PluginEvent, "timestamp">): void {
    this.eventSink.emit({
      ...input,
      timestamp: nowIso(),
    });
  }

  private async executeHookWithPolicy<T>(
    entry: LoadedPlugin,
    hookName: PluginHookName,
    execute: () => Promise<T>,
  ): Promise<T | undefined> {
    const policy = this.resolvePolicy(entry, hookName);
    const startedAt = Date.now();
    this.emitEvent({
      name: "plugin.hook.started",
      pluginId: entry.manifest.id,
      details: { hookName },
    });

    try {
      const result = await withTimeout(
        execute(),
        policy.timeoutMs,
        `plugin hook timeout (${entry.manifest.id}.${hookName})`,
      );
      this.recordSuccess(entry.manifest.id);
      this.emitEvent({
        name: "plugin.hook.completed",
        pluginId: entry.manifest.id,
        details: {
          hookName,
          durationMs: Date.now() - startedAt,
        },
      });
      return result;
    } catch (error) {
      this.recordFailure(entry.manifest.id, error);
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("plugin hook timeout")) {
        this.emitEvent({
          name: "plugin.hook.timed_out",
          pluginId: entry.manifest.id,
          details: {
            hookName,
            timeoutMs: policy.timeoutMs,
          },
        });
      } else {
        this.emitEvent({
          name: "plugin.failed",
          pluginId: entry.manifest.id,
          details: {
            hookName,
            error: message,
          },
        });
      }

      const details = {
        pluginId: entry.manifest.id,
        hookName,
        timeoutMs: policy.timeoutMs,
        error: message,
      };
      if (policy.onError === "fail") {
        this.logger.error("plugin.hook.failed", details);
        throw error;
      }
      this.logger.warn("plugin.hook.failed", details);
      return undefined;
    }
  }

  public static empty(options: PluginRuntimeOptions = {}): PluginRuntime {
    return new PluginRuntime([], options);
  }
}

async function runLifecycleHook(
  entry: LoadedPlugin,
  name: "onInstall" | "onEnable",
): Promise<void> {
  const lifecycle = entry.plugin.lifecycle;
  if (!lifecycle || !lifecycle[name]) {
    return;
  }
  await withTimeout(
    Promise.resolve(
      lifecycle[name]?.({
        pluginId: entry.manifest.id,
        nowIso: nowIso(),
      }),
    ),
    DEFAULT_HOOK_TIMEOUT_MS,
    `plugin lifecycle timeout (${entry.manifest.id}.${name})`,
  );
}

export async function loadWorkspacePlugins(
  options: LoadWorkspacePluginsOptions = {},
): Promise<PluginLoadResult> {
  const logger = options.logger ?? DEFAULT_LOGGER;
  const hostVersion = options.hostVersion ?? DEFAULT_PLUGIN_HOST_VERSION;
  const supportedApiVersions =
    options.supportedApiVersions ?? [...DEFAULT_SUPPORTED_PLUGIN_API_VERSIONS];
  const isolationPolicy = options.isolationPolicy ?? DEFAULT_ISOLATION_POLICY;
  const eventSink = options.eventSink;
  const manifests = await discoverPluginManifests(options);
  const issues: PluginLoadIssue[] = [];
  const plugins: LoadedPlugin[] = [];
  const workerHosts: Array<{ pluginId: string; host: PluginWorkerHost }> = [];

  for (const item of manifests) {
    const pluginId = item.manifest.id;
    if (!item.manifest.enabled) {
      continue;
    }

    if (!supportedApiVersions.includes(item.manifest.apiVersion)) {
      issues.push({
        pluginId,
        level: "error",
        message: `unsupported apiVersion ${item.manifest.apiVersion}; supported versions: ${supportedApiVersions.join(", ")}`,
      });
      continue;
    }

    const compatibility = isHostVersionCompatible(item.manifest, hostVersion);
    if (!compatibility.ok) {
      issues.push({
        pluginId,
        level: "error",
        message: compatibility.reason ?? "host version compatibility failed",
      });
      continue;
    }

    try {
      const entryPath = resolve(item.rootDir, item.manifest.entry);

      // Resolve effective execution mode via policy
      const modeResolution = resolvePluginExecutionMode(item.manifest, isolationPolicy);
      logger.debug?.("plugin.policy.resolved", {
        pluginId,
        effectiveMode: modeResolution.effectiveMode,
        requestedMode: modeResolution.requestedMode,
        reasons: modeResolution.reasons,
        denied: modeResolution.denied,
      });

      if (modeResolution.denied) {
        const denyMessage = `policy denied: ${modeResolution.reasons.join("; ")}`;
        issues.push({
          pluginId,
          level: "error",
          message: denyMessage,
        });
        eventSink?.emit({
          timestamp: nowIso(),
          name: "plugin.policy.denied",
          pluginId,
          details: {
            requestedMode: modeResolution.requestedMode,
            effectiveMode: modeResolution.effectiveMode,
            reasons: modeResolution.reasons,
          },
        });
        logger.warn("plugin.policy.denied", {
          pluginId,
          message: denyMessage,
        });
        continue;
      }

      const effectiveMode = modeResolution.effectiveMode;
      eventSink?.emit({
        timestamp: nowIso(),
        name: "plugin.policy.resolved",
        pluginId,
        details: {
          effectiveMode,
          requestedMode: modeResolution.requestedMode,
          reasons: modeResolution.reasons,
        },
      });

      if (effectiveMode === "external_process" || effectiveMode === "container") {
        issues.push({
          pluginId,
          level: "error",
          message: `execution mode "${effectiveMode}" is not yet supported (requires M2/M3)`,
        });
        continue;
      }

      if (effectiveMode === "worker_thread") {
        const host = new PluginWorkerHost(item.manifest);
        await host.start(entryPath);
        const proxyPlugin = host.toPluginProxy();
        const loaded: LoadedPlugin = {
          manifest: item.manifest,
          plugin: proxyPlugin,
        };
        await runLifecycleHook(loaded, "onInstall");
        await runLifecycleHook(loaded, "onEnable");
        plugins.push(loaded);
        workerHosts.push({ pluginId, host });
      } else {
        const moduleValue = (await import(pathToFileURL(entryPath).href)) as JihnPluginModule;
        const plugin = await normalizePluginExportAsync(moduleValue, item.manifest, issues);
        if (plugin === null) {
          issues.push({
            pluginId,
            level: "error",
            message: `plugin entry ${join(item.rootDir, item.manifest.entry)} does not export default/plugin`,
          });
          continue;
        }

        validateCapabilities(plugin, item.manifest);
        const loaded: LoadedPlugin = {
          manifest: item.manifest,
          plugin,
        };
        await runLifecycleHook(loaded, "onInstall");
        await runLifecycleHook(loaded, "onEnable");
        plugins.push(loaded);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({ pluginId, level: "error", message });
      logger.error("plugin.load.failed", { pluginId, error: message });
    }
  }

  const depResult = topologicalSortPlugins(plugins);
  for (const { pluginId, missing } of depResult.missingDeps) {
    issues.push({
      pluginId,
      level: "error",
      message: `missing dependency "${missing}"`,
    });
  }
  for (const cycle of depResult.cycles) {
    const cycleStr = cycle.join(" -> ");
    issues.push({
      pluginId: cycle[0] ?? "unknown",
      level: "error",
      message: `dependency cycle detected: ${cycleStr}`,
    });
  }

  const loadOrder = depResult.cycles.length === 0 && depResult.missingDeps.length === 0
    ? depResult.sorted
    : plugins;

  return {
    plugins: loadOrder,
    issues,
    workerHosts,
  };
}

export function createPluginRuntimeFromLoaded(
  loaded: PluginLoadResult,
  options: PluginRuntimeOptions = {},
): PluginRuntime {
  const runtime = new PluginRuntime(loaded.plugins, options);
  for (const { pluginId, host } of loaded.workerHosts ?? []) {
    const workerHost = host as PluginWorkerHost;
    // Wire context services so worker-thread plugins get a PluginContext
    // backed by RPC proxies to the host's gated accessors.
    if (options.contextServices) {
      workerHost.setContextServices(options.contextServices, options.secretBroker);
    }
    runtime.registerWorkerHost(pluginId, workerHost);
  }
  return runtime;
}

export function createPluginRuntime(
  entries: LoadedPlugin[],
  options: PluginRuntimeOptions = {},
): PluginRuntime {
  for (const entry of entries) {
    validateCapabilities(entry.plugin, entry.manifest);
  }
  return new PluginRuntime(entries, options);
}

export function validatePluginModuleForTests(manifest: PluginManifest, moduleValue: JihnPluginModule): JihnPlugin {
  const plugin = normalizePluginExport(moduleValue);
  if (plugin === null) {
    throw new Error("plugin module missing export");
  }
  validateCapabilities(plugin, manifest);
  return plugin;
}

export function isPluginPermissionError(error: unknown): error is PluginPermissionError {
  return error instanceof PluginPermissionError;
}
