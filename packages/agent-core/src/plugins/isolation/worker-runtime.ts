import { parentPort } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import type {
  WorkerResponse,
  WorkerLoadRequest,
  WorkerExecuteHookRequest,
  WorkerExecuteToolRequest,
  WorkerLifecycleRequest,
  WorkerHealthcheckRequest,
  WorkerRpcRequest,
  WorkerRpcResponse,
  WorkerContextMeta,
  HostToWorkerMessage,
} from "./protocol.js";
import {
  createRpcProxy,
  cleanupRpcProxy,
  type RpcChannel,
} from "./rpc-bridge.js";
import type {
  JihnPlugin,
  PluginContext,
  PluginFilesystemAccessor,
  PluginMemoryAccessor,
  PluginNetworkAccessor,
  PluginPermission,
  PluginSecretAccessor,
  PluginSessionAccessor,
  PluginToolDefinition,
} from "../types.js";

let loadedPlugin: JihnPlugin | null = null;
const toolMap = new Map<string, PluginToolDefinition>();
const hookNames: string[] = [];

// ---------------------------------------------------------------------------
// RPC response routing
// ---------------------------------------------------------------------------

/** Active response handlers keyed by scope (one per concurrent tool execution). */
const rpcResponseHandlers = new Set<(response: WorkerRpcResponse) => void>();

function routeRpcResponse(response: WorkerRpcResponse): void {
  for (const handler of rpcResponseHandlers) {
    handler(response);
  }
}

// ---------------------------------------------------------------------------
// Worker-side PluginContext reconstruction
// ---------------------------------------------------------------------------

/**
 * Build a PluginContext inside the worker from serialized metadata.
 * Async service accessors (memory, session, filesystem, network) are backed
 * by RPC proxies that relay calls to the host's gated implementations.
 * Secrets use a pre-resolved snapshot for synchronous access.
 */
function buildWorkerContext(
  meta: WorkerContextMeta,
  channel: RpcChannel,
): { context: PluginContext; cleanup: () => void } {
  const memory = createRpcProxy<PluginMemoryAccessor>("memory", ["read", "write"], channel);
  const session = createRpcProxy<PluginSessionAccessor>("session", ["read", "write"], channel);
  const filesystem = createRpcProxy<PluginFilesystemAccessor>("filesystem", ["read", "write"], channel);
  const network = createRpcProxy<PluginNetworkAccessor>("network", ["fetch"], channel);

  const secrets: PluginSecretAccessor = {
    request(scope: string): string | null {
      return meta.secretsSnapshot[scope] ?? null;
    },
  };

  const permissions = Object.freeze([...(meta.permissions as PluginPermission[])]);

  const context: PluginContext = {
    pluginId: meta.pluginId,
    permissions,
    memory,
    session,
    filesystem,
    network,
    secrets,
    hasPermission(permission: PluginPermission): boolean {
      return (meta.permissions as string[]).includes(permission);
    },
  };

  const cleanup = () => {
    cleanupRpcProxy(memory);
    cleanupRpcProxy(session);
    cleanupRpcProxy(filesystem);
    cleanupRpcProxy(network);
  };

  return { context, cleanup };
}

/**
 * Create an RpcChannel scoped to a single tool execution.
 * The channel's `onResponse` registers/unregisters a handler in the
 * module-level `rpcResponseHandlers` set, ensuring cleanup after execution.
 */
function createWorkerRpcChannel(): RpcChannel {
  return {
    postMessage(message: WorkerRpcRequest): void {
      parentPort?.postMessage(message);
    },
    onResponse(handler: (response: WorkerRpcResponse) => void): () => void {
      rpcResponseHandlers.add(handler);
      return () => {
        rpcResponseHandlers.delete(handler);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Message sending
// ---------------------------------------------------------------------------

function respond(response: WorkerResponse): void {
  parentPort?.postMessage(response);
}

// ---------------------------------------------------------------------------
// Request handlers
// ---------------------------------------------------------------------------

async function handleLoad(request: WorkerLoadRequest): Promise<void> {
  try {
    const moduleValue = await import(pathToFileURL(request.entryPath).href);
    const raw = moduleValue.default ?? moduleValue.plugin;
    if (raw === undefined) {
      respond({ id: request.id, ok: false, error: "plugin module missing export" });
      return;
    }

    let plugin: JihnPlugin;
    if (typeof raw === "object" && raw !== null && "manifest" in raw && "create" in raw) {
      plugin = typeof raw.create === "function" ? await raw.create() : raw;
    } else if (typeof raw === "function") {
      plugin = await raw();
    } else {
      plugin = raw;
    }

    loadedPlugin = plugin;
    toolMap.clear();
    hookNames.length = 0;

    const names: string[] = [];
    for (const tool of plugin.tools ?? []) {
      toolMap.set(tool.name, tool);
      names.push(tool.name);
    }
    if (plugin.hooks) {
      for (const key of Object.keys(plugin.hooks)) {
        hookNames.push(key);
      }
    }

    respond({ id: request.id, ok: true, toolNames: names, hookNames });
  } catch (error) {
    respond({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleExecuteHook(request: WorkerExecuteHookRequest): Promise<void> {
  if (!loadedPlugin?.hooks) {
    respond({ id: request.id, ok: false, error: "no hooks loaded" });
    return;
  }

  const hookMap: Record<string, Function | undefined> = {
    beforePromptCompose: loadedPlugin.hooks.beforePromptCompose,
    afterPromptCompose: loadedPlugin.hooks.afterPromptCompose,
    beforeTurn: loadedPlugin.hooks.beforeTurn,
    afterTurn: loadedPlugin.hooks.afterTurn,
    beforeToolCall: loadedPlugin.hooks.beforeToolCall,
    afterToolCall: loadedPlugin.hooks.afterToolCall,
  };

  const hook = hookMap[request.hookName];
  if (!hook) {
    respond({ id: request.id, ok: true, result: undefined });
    return;
  }

  try {
    const result = await Promise.resolve(hook(request.event));
    respond({ id: request.id, ok: true, result: result ?? undefined });
  } catch (error) {
    respond({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleExecuteTool(request: WorkerExecuteToolRequest): Promise<void> {
  const tool = toolMap.get(request.toolName);
  if (!tool) {
    respond({ id: request.id, ok: false, error: `unknown tool: ${request.toolName}` });
    return;
  }

  let context: PluginContext | undefined;
  let cleanup: (() => void) | undefined;

  if (request.contextMeta) {
    const channel = createWorkerRpcChannel();
    const built = buildWorkerContext(request.contextMeta, channel);
    context = built.context;
    cleanup = built.cleanup;
  }

  try {
    const result = await tool.execute(request.input, context);
    respond({ id: request.id, ok: true, result });
  } catch (error) {
    respond({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    cleanup?.();
  }
}

async function handleLifecycle(request: WorkerLifecycleRequest): Promise<void> {
  if (!loadedPlugin?.lifecycle) {
    respond({ id: request.id, ok: true });
    return;
  }

  const hookMap: Record<string, Function | undefined> = {
    onInstall: loadedPlugin.lifecycle.onInstall,
    onEnable: loadedPlugin.lifecycle.onEnable,
    onDisable: loadedPlugin.lifecycle.onDisable,
    onUnload: loadedPlugin.lifecycle.onUnload,
  };

  const hook = hookMap[request.hookName];
  if (!hook) {
    respond({ id: request.id, ok: true });
    return;
  }

  try {
    await Promise.resolve(hook(request.context));
    respond({ id: request.id, ok: true });
  } catch (error) {
    respond({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleHealthcheck(request: WorkerHealthcheckRequest): Promise<void> {
  if (!loadedPlugin?.lifecycle?.onHealthCheck) {
    respond({ id: request.id, ok: true, result: { healthy: true } });
    return;
  }

  try {
    const result = await Promise.resolve(
      loadedPlugin.lifecycle.onHealthCheck(request.context),
    );
    respond({ id: request.id, ok: true, result: result ?? { healthy: true } });
  } catch (error) {
    respond({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---------------------------------------------------------------------------
// Message dispatch
// ---------------------------------------------------------------------------

parentPort?.on("message", (message: HostToWorkerMessage) => {
  // Route host-to-worker RPC responses to the pending proxy handlers.
  if ("type" in message && message.type === "rpc_response") {
    routeRpcResponse(message as WorkerRpcResponse);
    return;
  }

  // Standard host-initiated requests.
  const request = message as HostToWorkerMessage;
  switch ((request as { type: string }).type) {
    case "load":
      handleLoad(request as WorkerLoadRequest).catch((error) => {
        respond({
          id: (request as WorkerLoadRequest).id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      break;
    case "execute_hook":
      handleExecuteHook(request as WorkerExecuteHookRequest).catch((error) => {
        respond({
          id: (request as WorkerExecuteHookRequest).id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      break;
    case "execute_tool":
      handleExecuteTool(request as WorkerExecuteToolRequest).catch((error) => {
        respond({
          id: (request as WorkerExecuteToolRequest).id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      break;
    case "lifecycle":
      handleLifecycle(request as WorkerLifecycleRequest).catch((error) => {
        respond({
          id: (request as WorkerLifecycleRequest).id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      break;
    case "healthcheck":
      handleHealthcheck(request as WorkerHealthcheckRequest).catch((error) => {
        respond({
          id: (request as WorkerHealthcheckRequest).id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      break;
    case "shutdown":
      if (loadedPlugin?.lifecycle?.onUnload) {
        Promise.resolve(
          loadedPlugin.lifecycle.onUnload({
            pluginId: "",
            nowIso: new Date().toISOString(),
          }),
        )
          .catch(() => {})
          .finally(() => {
            respond({ id: (request as { id: string }).id, ok: true });
          });
      } else {
        respond({ id: (request as { id: string }).id, ok: true });
      }
      break;
  }
});
