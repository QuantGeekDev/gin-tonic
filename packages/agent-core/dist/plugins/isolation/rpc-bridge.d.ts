import type { WorkerRpcRequest, WorkerRpcResponse } from "./protocol.js";
/**
 * Abstract message transport for RPC calls between worker and host.
 * Implementations adapt this to `parentPort.postMessage` (worker-side)
 * or `worker.postMessage` (host-side).
 */
export interface RpcChannel {
    postMessage(message: WorkerRpcRequest): void;
    onResponse(handler: (response: WorkerRpcResponse) => void): () => void;
}
/**
 * Creates a proxy object that forwards method calls over an RPC channel.
 * Each proxied method returns a Promise resolved when the host responds.
 *
 * @param service  - Service name for routing (e.g. "memory", "session")
 * @param methods  - Method names to proxy (e.g. ["read", "write"])
 * @param channel  - Transport for sending/receiving RPC messages
 * @returns A proxy object with the specified methods
 *
 * @example
 * ```ts
 * const memory = createRpcProxy<PluginMemoryAccessor>(
 *   "memory", ["read", "write"], channel,
 * );
 * const results = await memory.read("query");
 * ```
 */
export declare function createRpcProxy<T>(service: string, methods: string[], channel: RpcChannel): T;
/**
 * Detaches the response listener created by `createRpcProxy`.
 * Call this after the tool execution completes to prevent handler leaks.
 */
export declare function cleanupRpcProxy(proxy: unknown): void;
/**
 * Map of service names to objects whose methods handle RPC calls.
 * Each value is a plain object with async methods.
 */
export type ServiceAccessorMap = Record<string, Record<string, (...args: any[]) => Promise<any>>>;
/**
 * Creates a dispatcher function that routes incoming `WorkerRpcRequest`
 * messages to the appropriate service accessor method.
 *
 * @param services - Map of service name -> accessor object
 * @param respond  - Callback to send the response back to the worker
 * @returns A handler function to be called for each `WorkerRpcRequest`
 *
 * @example
 * ```ts
 * const dispatch = createRpcDispatcher(
 *   { memory: { read: ctx.memory.read, write: ctx.memory.write } },
 *   (response) => worker.postMessage(response),
 * );
 * worker.on("message", (msg) => {
 *   if (msg.type === "rpc_request") dispatch(msg);
 * });
 * ```
 */
export declare function createRpcDispatcher(services: ServiceAccessorMap, respond: (response: WorkerRpcResponse) => void): (request: WorkerRpcRequest) => void;
//# sourceMappingURL=rpc-bridge.d.ts.map