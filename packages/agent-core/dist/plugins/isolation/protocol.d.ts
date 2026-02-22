import type { PluginCapabilityPolicy } from "../types.js";
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
/**
 * Serializable context metadata sent alongside tool execution requests.
 * The worker uses this to reconstruct a `PluginContext` with RPC-backed
 * service accessors.
 */
export interface WorkerContextMeta {
    pluginId: string;
    permissions: string[];
    manifest: Record<string, unknown>;
    capabilityPolicy?: PluginCapabilityPolicy | undefined;
    /** Pre-resolved secrets snapshot (scope -> value). */
    secretsSnapshot: Record<string, string>;
}
export interface WorkerExecuteToolRequest {
    type: "execute_tool";
    id: string;
    toolName: string;
    input: Record<string, unknown>;
    timeoutMs: number;
    /** When present, the worker reconstructs a PluginContext from this metadata. */
    contextMeta?: WorkerContextMeta | undefined;
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
/** Worker -> Host: request to invoke a service accessor method. */
export interface WorkerRpcRequest {
    type: "rpc_request";
    rpcId: string;
    service: string;
    method: string;
    args: unknown[];
}
/** Host -> Worker: response to a service accessor RPC call. */
export interface WorkerRpcResponse {
    type: "rpc_response";
    rpcId: string;
    ok: boolean;
    result?: unknown;
    error?: string;
    /** Preserved error constructor name (e.g. "PluginPermissionError"). */
    errorType?: string;
}
/** All message types the host may receive from a worker. */
export type WorkerToHostMessage = WorkerResponse | WorkerRpcRequest;
/** All message types the worker may receive from the host. */
export type HostToWorkerMessage = WorkerRequest | WorkerRpcResponse;
//# sourceMappingURL=protocol.d.ts.map