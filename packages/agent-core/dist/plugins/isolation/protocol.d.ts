export type WorkerRequestType = "load" | "execute_hook" | "execute_tool" | "lifecycle" | "healthcheck" | "shutdown";
export interface WorkerLoadRequest {
    type: "load";
    id: string;
    entryPath: string;
    manifest: Record<string, unknown>;
}
export interface WorkerExecuteHookRequest {
    type: "execute_hook";
    id: string;
    hookName: string;
    event: Record<string, unknown>;
    timeoutMs: number;
}
export interface WorkerExecuteToolRequest {
    type: "execute_tool";
    id: string;
    toolName: string;
    input: Record<string, unknown>;
    timeoutMs: number;
}
export interface WorkerLifecycleRequest {
    type: "lifecycle";
    id: string;
    hookName: string;
    context: {
        pluginId: string;
        nowIso: string;
    };
    timeoutMs: number;
}
export interface WorkerHealthcheckRequest {
    type: "healthcheck";
    id: string;
    context: {
        pluginId: string;
        nowIso: string;
    };
    timeoutMs: number;
}
export interface WorkerShutdownRequest {
    type: "shutdown";
    id: string;
}
export type WorkerRequest = WorkerLoadRequest | WorkerExecuteHookRequest | WorkerExecuteToolRequest | WorkerLifecycleRequest | WorkerHealthcheckRequest | WorkerShutdownRequest;
export interface WorkerResponse {
    id: string;
    ok: boolean;
    result?: unknown;
    error?: string;
    toolNames?: string[];
    hookNames?: string[];
}
//# sourceMappingURL=protocol.d.ts.map