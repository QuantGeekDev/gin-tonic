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
export type PluginExecutionMode = "in_process" | "worker_thread" | "external_process" | "container";

export const PLUGIN_EXECUTION_MODES = [
  "in_process",
  "worker_thread",
  "external_process",
  "container",
] as const;

/**
 * Isolation strength ordering: higher index = stronger isolation.
 * Used by policy resolver to enforce minimum isolation levels.
 */
export const EXECUTION_MODE_STRENGTH: Record<PluginExecutionMode, number> = {
  in_process: 0,
  worker_thread: 1,
  external_process: 2,
  container: 3,
};

export const PLUGIN_TRUST_TIERS = [
  "first_party",
  "verified_partner",
  "community",
] as const;

export type PluginTrustTier = (typeof PLUGIN_TRUST_TIERS)[number];

/**
 * Permissions that carry elevated risk and may require stricter isolation.
 */
export const RISKY_PLUGIN_PERMISSIONS: readonly PluginPermission[] = [
  "filesystem.write",
  "network.http",
];

/**
 * Operator-level isolation policy configuration.
 */
export interface PluginIsolationPolicy {
  /** Default execution mode when manifest does not specify one. */
  defaultMode: PluginExecutionMode;
  /** Plugin IDs explicitly allowed to run in_process. */
  inProcessAllowlist: string[];
  /** Minimum execution mode for plugins with risky permissions. */
  riskyPermissionMinimumMode: PluginExecutionMode;
  /** Per-trust-tier default execution modes. */
  trustTierDefaults: Partial<Record<PluginTrustTier, PluginExecutionMode>>;
}

/**
 * Result of resolving the effective execution mode for a plugin.
 */
export interface PluginModeResolution {
  effectiveMode: PluginExecutionMode;
  requestedMode: PluginExecutionMode | undefined;
  reasons: string[];
  denied: boolean;
}

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
  trustTier?: PluginTrustTier | undefined;
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
  "plugin.policy.resolved",
  "plugin.policy.denied",
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

/**
 * Per-plugin capability enforcement policy.
 * When set, operations are validated against allowlists before delegation.
 * Default behavior when no policy is set: deny operations that lack
 * the declared permission (existing behavior). When policy IS set,
 * even permitted operations are further constrained by the allowlists.
 */
export interface PluginCapabilityPolicy {
  /** Filesystem path ACLs. Paths are resolved and matched as prefixes. */
  filesystem?: {
    allowedReadPaths?: string[];
    allowedWritePaths?: string[];
  };
  /** Network egress domain allowlist. Matched against URL hostname. */
  network?: {
    allowedDomains?: string[];
  };
  /** Memory namespace scoping. Plugin can only access these namespaces. */
  memory?: {
    allowedNamespaces?: string[];
  };
  /** Session scope guard. Plugin can only access these session key patterns. */
  session?: {
    allowedSessionPatterns?: string[];
  };
}

/**
 * Callback for denied capability operations, used for audit events.
 */
export type PluginCapabilityDenyCallback = (event: {
  pluginId: string;
  permission: PluginPermission;
  operation: string;
  target: string;
  reason: string;
}) => void;

export interface PluginContext {
  readonly pluginId: string;
  readonly permissions: readonly PluginPermission[];
  readonly memory: PluginMemoryAccessor;
  readonly session: PluginSessionAccessor;
  readonly filesystem: PluginFilesystemAccessor;
  readonly network: PluginNetworkAccessor;
  hasPermission(permission: PluginPermission): boolean;
}
