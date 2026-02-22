import type { WorkerRpcRequest, WorkerRpcResponse } from "./protocol.js";

// ---------------------------------------------------------------------------
// Worker-side: RPC channel abstraction and proxy factory
// ---------------------------------------------------------------------------

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
export function createRpcProxy<T>(
  service: string,
  methods: string[],
  channel: RpcChannel,
): T {
  let rpcCounter = 0;
  const pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  const cleanup = channel.onResponse((response) => {
    const entry = pending.get(response.rpcId);
    if (!entry) return;
    pending.delete(response.rpcId);
    if (response.ok) {
      entry.resolve(response.result);
    } else {
      const error = new Error(response.error ?? "RPC call failed");
      if (response.errorType) {
        error.name = response.errorType;
      }
      entry.reject(error);
    }
  });

  const proxy: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

  for (const method of methods) {
    proxy[method] = (...args: unknown[]): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        rpcCounter += 1;
        const rpcId = `${service}_${rpcCounter}`;
        pending.set(rpcId, { resolve, reject });
        channel.postMessage({
          type: "rpc_request" as const,
          rpcId,
          service,
          method,
          args,
        });
      });
    };
  }

  // Attach cleanup so callers can tear down the response listener.
  (proxy as Record<string, unknown>).__cleanup = cleanup;

  return proxy as T;
}

/**
 * Detaches the response listener created by `createRpcProxy`.
 * Call this after the tool execution completes to prevent handler leaks.
 */
export function cleanupRpcProxy(proxy: unknown): void {
  if (
    proxy !== null &&
    typeof proxy === "object" &&
    "__cleanup" in proxy &&
    typeof (proxy as Record<string, unknown>).__cleanup === "function"
  ) {
    ((proxy as Record<string, unknown>).__cleanup as () => void)();
  }
}

// ---------------------------------------------------------------------------
// Host-side: RPC dispatcher
// ---------------------------------------------------------------------------

/**
 * Map of service names to objects whose methods handle RPC calls.
 * Each value is a plain object with async methods.
 */
export type ServiceAccessorMap = Record<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Record<string, (...args: any[]) => Promise<any>>
>;

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
export function createRpcDispatcher(
  services: ServiceAccessorMap,
  respond: (response: WorkerRpcResponse) => void,
): (request: WorkerRpcRequest) => void {
  return (request: WorkerRpcRequest) => {
    const accessor = services[request.service];
    if (!accessor) {
      respond({
        type: "rpc_response",
        rpcId: request.rpcId,
        ok: false,
        error: `unknown service: ${request.service}`,
      });
      return;
    }

    const method = accessor[request.method];
    if (typeof method !== "function") {
      respond({
        type: "rpc_response",
        rpcId: request.rpcId,
        ok: false,
        error: `unknown method: ${request.service}.${request.method}`,
      });
      return;
    }

    Promise.resolve()
      .then(() => method(...request.args))
      .then((result) => {
        respond({
          type: "rpc_response",
          rpcId: request.rpcId,
          ok: true,
          result,
        });
      })
      .catch((error: unknown) => {
        const response: WorkerRpcResponse = {
          type: "rpc_response",
          rpcId: request.rpcId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
        if (error instanceof Error) {
          response.errorType = error.name;
        }
        respond(response);
      });
  };
}
