import { type PluginContextServices } from "../context.js";
import type { JihnPlugin, PluginManifest } from "../types.js";
import type { PluginSecretBroker } from "./secret-broker.js";
export declare class PluginWorkerHost {
    private worker;
    private readonly pendingRequests;
    private requestCounter;
    private toolNames;
    private hookNames;
    readonly pluginId: string;
    readonly manifest: PluginManifest;
    private contextServices;
    private secretBroker;
    private rpcDispatcher;
    constructor(manifest: PluginManifest);
    /**
     * Provide the service implementations that back the worker's PluginContext.
     * When set, tool execution requests include `contextMeta` and RPC calls
     * from the worker are routed through gated accessors on the host.
     */
    setContextServices(services: PluginContextServices, secretBroker?: PluginSecretBroker | undefined): void;
    start(entryPath: string): Promise<{
        toolNames: string[];
        hookNames: string[];
    }>;
    executeHook(hookName: string, event: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
    executeTool(toolName: string, input: Record<string, unknown>, timeoutMs?: number): Promise<string>;
    runLifecycle(hookName: string, context: {
        pluginId: string;
        nowIso: string;
    }, timeoutMs?: number): Promise<void>;
    runHealthcheck(context: {
        pluginId: string;
        nowIso: string;
    }, timeoutMs?: number): Promise<{
        healthy: boolean;
        details?: string;
    }>;
    shutdown(): Promise<void>;
    terminate(): Promise<void>;
    getToolNames(): string[];
    getHookNames(): string[];
    hasHook(hookName: string): boolean;
    isAlive(): boolean;
    toPluginProxy(): JihnPlugin;
    private handleRpcRequest;
    /**
     * Lazily build the RPC dispatcher from the gated plugin context.
     * The dispatcher routes worker RPC requests to the host's gated accessors
     * where permission checks, ACL enforcement, and audit events all fire.
     */
    private ensureRpcDispatcher;
    /**
     * Build the serializable context metadata to send with a tool execution
     * request. Returns `undefined` if no context services are configured.
     */
    private buildContextMeta;
    /**
     * Build a minimal env for the worker thread. Only passes through essential
     * Node.js runtime vars plus broker-scoped secrets. Prevents leakage of
     * host process.env (API keys, database URLs, etc.) to plugin code.
     */
    private buildWorkerEnv;
    private nextId;
    private send;
}
//# sourceMappingURL=worker-host.d.ts.map