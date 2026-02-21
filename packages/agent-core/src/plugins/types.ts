import type { ToolDefinition } from "../tools.js";
import type { Message } from "../types/message.js";

export const PLUGIN_CAPABILITIES = [
  "tools",
  "prompt",
  "turn",
  "tool_intercept",
] as const;

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

export const PLUGIN_HOOK_NAMES = [
  "before_prompt_compose",
  "after_prompt_compose",
  "before_turn",
  "after_turn",
  "before_tool_call",
  "after_tool_call",
] as const;

export type PluginHookName = (typeof PLUGIN_HOOK_NAMES)[number];

export type PluginHookErrorMode = "continue" | "fail";
export type PluginExecutionMode = "in_process" | "worker_thread";

export const PLUGIN_PERMISSIONS = [
  "memory.read",
  "memory.write",
  "session.read",
  "session.write",
  "channel.send",
  "channel.receive",
  "network.http",
  "filesystem.read",
  "filesystem.write",
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export interface PluginHealthcheckConfig {
  timeoutMs?: number | undefined;
}

export interface PluginCompatibility {
  minHostVersion?: string | undefined;
  maxHostVersion?: string | undefined;
}

export interface PluginHookPolicy {
  timeoutMs?: number | undefined;
  onError?: PluginHookErrorMode | undefined;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  entry: string;
  enabled: boolean;
  priority: number;
  capabilities: PluginCapability[];
  permissions?: PluginPermission[] | undefined;
  executionMode?: PluginExecutionMode | undefined;
  compatibility?: PluginCompatibility | undefined;
  healthcheck?: PluginHealthcheckConfig | undefined;
  hookPolicy?: PluginHookPolicy | undefined;
  hookPolicies?: Partial<Record<PluginHookName, PluginHookPolicy>> | undefined;
  dependencies?: string[] | undefined;
  description?: string | undefined;
}

export interface PluginPromptComposeContext {
  agentId?: string;
  workspaceDir: string;
}

export interface PluginBeforePromptComposeEvent {
  prompt: string;
  context: PluginPromptComposeContext;
}

export interface PluginAfterPromptComposeEvent {
  prompt: string;
  context: PluginPromptComposeContext;
}

export interface PluginRoutingContext {
  agentId: string;
  scope: string;
  channelId: string;
  peerId: string;
  sessionKey: string;
}

export interface PluginTurnResult {
  text: string;
  messages: Message[];
  usage: {
    estimatedInputTokens: number;
    inputTokens: number;
    outputTokens: number;
  };
  persistenceMode: "append" | "save";
  idempotencyHit?: boolean;
}

export interface PluginBeforeTurnEvent {
  text: string;
  systemPrompt: string;
  routing: PluginRoutingContext;
}

export interface PluginAfterTurnEvent {
  text: string;
  systemPrompt: string;
  routing: PluginRoutingContext;
  result: PluginTurnResult;
}

export interface PluginBeforeToolCallEvent {
  name: string;
  input: Record<string, unknown>;
  routing?: PluginRoutingContext;
}

export interface PluginAfterToolCallEvent {
  name: string;
  input: Record<string, unknown>;
  output: string;
  routing?: PluginRoutingContext;
}

export interface PluginToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolDefinition["inputSchema"];
  execute(input: Record<string, unknown>, context?: PluginContext): Promise<string>;
}

export interface PluginHooks {
  beforePromptCompose?(event: PluginBeforePromptComposeEvent): Promise<string | void> | string | void;
  afterPromptCompose?(event: PluginAfterPromptComposeEvent): Promise<string | void> | string | void;
  beforeTurn?(
    event: PluginBeforeTurnEvent,
  ): Promise<Partial<Pick<PluginBeforeTurnEvent, "text" | "systemPrompt">> | void> |
    Partial<Pick<PluginBeforeTurnEvent, "text" | "systemPrompt">> |
    void;
  afterTurn?(event: PluginAfterTurnEvent): Promise<void> | void;
  beforeToolCall?(
    event: PluginBeforeToolCallEvent,
  ): Promise<Partial<Pick<PluginBeforeToolCallEvent, "input">> | void> |
    Partial<Pick<PluginBeforeToolCallEvent, "input">> |
    void;
  afterToolCall?(
    event: PluginAfterToolCallEvent,
  ): Promise<Partial<Pick<PluginAfterToolCallEvent, "output">> | void> |
    Partial<Pick<PluginAfterToolCallEvent, "output">> |
    void;
}

export interface PluginLifecycleContext {
  pluginId: string;
  nowIso: string;
}

export interface PluginLifecycle {
  onInstall?(context: PluginLifecycleContext): Promise<void> | void;
  onEnable?(context: PluginLifecycleContext): Promise<void> | void;
  onDisable?(context: PluginLifecycleContext): Promise<void> | void;
  onUnload?(context: PluginLifecycleContext): Promise<void> | void;
  onHealthCheck?(
    context: PluginLifecycleContext,
  ): Promise<{ healthy: boolean; details?: string } | void> | { healthy: boolean; details?: string } | void;
}

export interface JihnPlugin {
  hooks?: PluginHooks;
  tools?: PluginToolDefinition[];
  lifecycle?: PluginLifecycle;
}

export type JihnPluginFactory = () => Promise<JihnPlugin> | JihnPlugin;

export type JihnPluginModule = {
  default?: JihnPluginFactory | JihnPlugin;
  plugin?: JihnPluginFactory | JihnPlugin;
};

export interface LoadedPlugin {
  manifest: PluginManifest;
  plugin: JihnPlugin;
}

export interface PluginLoadIssue {
  pluginId: string;
  level: "warn" | "error";
  message: string;
}

export interface PluginLoadResult {
  plugins: LoadedPlugin[];
  issues: PluginLoadIssue[];
  workerHosts?: Array<{ pluginId: string; host: unknown }> | undefined;
}

export const PLUGIN_EVENT_NAMES = [
  "plugin.loaded",
  "plugin.failed",
  "plugin.disabled",
  "plugin.hook.started",
  "plugin.hook.completed",
  "plugin.hook.timed_out",
  "plugin.tool.executed",
  "plugin.permission.denied",
] as const;

export type PluginEventName = (typeof PLUGIN_EVENT_NAMES)[number];

export interface PluginEvent {
  timestamp: string;
  name: PluginEventName;
  pluginId: string;
  sessionKey?: string | undefined;
  requestId?: string | undefined;
  channelId?: string | undefined;
  details?: Record<string, unknown> | undefined;
}

export interface PluginEventSink {
  emit(event: PluginEvent): void;
  list(): PluginEvent[];
}

export type PluginStatusState = "enabled" | "disabled" | "open_circuit";

export interface PluginStatusSnapshot {
  pluginId: string;
  state: PluginStatusState;
  consecutiveFailures: number;
  circuitOpenedAt?: string | undefined;
  lastError?: string | undefined;
  lastUpdatedAt: string;
}

export interface PluginStatusStore {
  get(pluginId: string): PluginStatusSnapshot | null;
  list(): PluginStatusSnapshot[];
  update(status: PluginStatusSnapshot): void;
}

export interface PluginRuntimeLogger {
  debug?(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

export interface PluginMemoryAccessor {
  read(query: string, options?: { namespace?: string; limit?: number }): Promise<unknown[]>;
  write(text: string, options?: { namespace?: string; tags?: string[] }): Promise<{ id: string }>;
}

export interface PluginSessionAccessor {
  read(sessionKey: string): Promise<unknown[]>;
  write(sessionKey: string, messages: unknown[]): Promise<void>;
}

export interface PluginFilesystemAccessor {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
}

export interface PluginNetworkAccessor {
  fetch(url: string, init?: RequestInit): Promise<{ status: number; body: string }>;
}

export interface PluginContext {
  readonly pluginId: string;
  readonly permissions: readonly PluginPermission[];
  readonly memory: PluginMemoryAccessor;
  readonly session: PluginSessionAccessor;
  readonly filesystem: PluginFilesystemAccessor;
  readonly network: PluginNetworkAccessor;
  hasPermission(permission: PluginPermission): boolean;
}
