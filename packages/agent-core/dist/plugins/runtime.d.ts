import { PluginWorkerHost } from "./isolation/worker-host.js";
import { PluginPermissionError } from "./permissions.js";
import { type PluginContextServices } from "./context.js";
import type { JihnPlugin, JihnPluginModule, LoadedPlugin, PluginAfterToolCallEvent, PluginBeforeToolCallEvent, PluginContext, PluginEvent, PluginEventSink, PluginIsolationPolicy, PluginLoadResult, PluginManifest, PluginPermission, PluginPromptComposeContext, PluginRoutingContext, PluginRuntimeLogger, PluginStatusSnapshot, PluginStatusStore, PluginTurnResult } from "./types.js";
import type { PluginSecretBroker } from "./isolation/secret-broker.js";
import type { ToolDefinition } from "../tools.js";
export declare const DEFAULT_PLUGIN_HOST_VERSION = "1.0.0";
export declare const DEFAULT_SUPPORTED_PLUGIN_API_VERSIONS: readonly [1];
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
export declare function topologicalSortPlugins(entries: LoadedPlugin[]): {
    sorted: LoadedPlugin[];
    cycles: string[][];
    missingDeps: Array<{
        pluginId: string;
        missing: string;
    }>;
};
export declare class PluginRuntime {
    private readonly plugins;
    private readonly logger;
    private readonly toolMap;
    private readonly toolOwnerMap;
    private readonly pluginMap;
    private readonly contextMap;
    private readonly eventSink;
    private readonly statusStore;
    private readonly workerHosts;
    private readonly failureState;
    private readonly secretBroker;
    private grantCleanupTimer;
    private readonly breakerThreshold;
    private readonly breakerCooldownMs;
    private readonly breakerWindowMs;
    constructor(entries: LoadedPlugin[], options?: PluginRuntimeOptions);
    listPlugins(): PluginManifest[];
    getPluginContext(pluginId: string): PluginContext | null;
    listStatuses(): PluginStatusSnapshot[];
    listEvents(): PluginEvent[];
    getToolDefinitions(): ToolDefinition[];
    hasTool(toolName: string): boolean;
    assertPermission(pluginId: string, permission: PluginPermission): void;
    hasPermission(pluginId: string, permission: PluginPermission): boolean;
    disablePlugin(pluginId: string, reason?: string): Promise<void>;
    executeTool(name: string, input: Record<string, unknown>): Promise<string>;
    applyPromptHooks(prompt: string, context: PluginPromptComposeContext): Promise<string>;
    applyBeforeTurnHooks(event: {
        text: string;
        systemPrompt: string;
        routing: PluginRoutingContext;
    }): Promise<{
        text: string;
        systemPrompt: string;
    }>;
    runAfterTurnHooks(event: {
        text: string;
        systemPrompt: string;
        routing: PluginRoutingContext;
        result: PluginTurnResult;
    }): Promise<void>;
    applyBeforeToolCallHooks(event: PluginBeforeToolCallEvent): Promise<Record<string, unknown>>;
    applyAfterToolCallHooks(event: PluginAfterToolCallEvent): Promise<string>;
    runHealthChecks(): Promise<Record<string, {
        healthy: boolean;
        details?: string;
    }>>;
    registerWorkerHost(pluginId: string, host: PluginWorkerHost): void;
    shutdown(): Promise<void>;
    private resolvePolicy;
    private isPluginUsable;
    private recordSuccess;
    private recordFailure;
    private emitEvent;
    private executeHookWithPolicy;
    static empty(options?: PluginRuntimeOptions): PluginRuntime;
}
export declare function loadWorkspacePlugins(options?: LoadWorkspacePluginsOptions): Promise<PluginLoadResult>;
export declare function createPluginRuntimeFromLoaded(loaded: PluginLoadResult, options?: PluginRuntimeOptions): PluginRuntime;
export declare function createPluginRuntime(entries: LoadedPlugin[], options?: PluginRuntimeOptions): PluginRuntime;
export declare function validatePluginModuleForTests(manifest: PluginManifest, moduleValue: JihnPluginModule): JihnPlugin;
export declare function isPluginPermissionError(error: unknown): error is PluginPermissionError;
//# sourceMappingURL=runtime.d.ts.map