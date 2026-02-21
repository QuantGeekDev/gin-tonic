import type { JihnPlugin, PluginManifest } from "../types.js";
export declare class PluginWorkerHost {
    private worker;
    private readonly pendingRequests;
    private requestCounter;
    private toolNames;
    private hookNames;
    readonly pluginId: string;
    readonly manifest: PluginManifest;
    constructor(manifest: PluginManifest);
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
    private nextId;
    private send;
}
//# sourceMappingURL=worker-host.d.ts.map