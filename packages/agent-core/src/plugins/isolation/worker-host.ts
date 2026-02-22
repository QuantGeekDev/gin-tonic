import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type {
  WorkerRequest,
  WorkerResponse,
  WorkerRpcRequest,
  WorkerRpcResponse,
  WorkerToHostMessage,
  WorkerContextMeta,
} from "./protocol.js";
import {
  createRpcDispatcher,
  type ServiceAccessorMap,
} from "./rpc-bridge.js";
import { createPluginContext, type PluginContextServices } from "../context.js";
import type {
  JihnPlugin,
  PluginContext,
  PluginManifest,
  PluginToolDefinition,
} from "../types.js";
import type { PluginSecretBroker } from "./secret-broker.js";
import type { ToolDefinition } from "../../tools.js";

const DEFAULT_WORKER_TIMEOUT_MS = 10_000;

const workerRuntimePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "worker-runtime.js",
);

export class PluginWorkerHost {
  private worker: Worker | null = null;
  private readonly pendingRequests = new Map<
    string,
    { resolve: (value: WorkerResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private requestCounter = 0;
  private toolNames: string[] = [];
  private hookNames: string[] = [];
  public readonly pluginId: string;
  public readonly manifest: PluginManifest;

  // Context bridge state
  private contextServices: PluginContextServices | null = null;
  private secretBroker: PluginSecretBroker | null = null;
  private rpcDispatcher: ((request: WorkerRpcRequest) => void) | null = null;

  public constructor(manifest: PluginManifest) {
    this.manifest = manifest;
    this.pluginId = manifest.id;
  }

  /**
   * Provide the service implementations that back the worker's PluginContext.
   * When set, tool execution requests include `contextMeta` and RPC calls
   * from the worker are routed through gated accessors on the host.
   */
  public setContextServices(
    services: PluginContextServices,
    secretBroker?: PluginSecretBroker | undefined,
  ): void {
    this.contextServices = services;
    this.secretBroker = secretBroker ?? null;
    // Reset the dispatcher so it's rebuilt with the new services.
    this.rpcDispatcher = null;
  }

  public async start(entryPath: string): Promise<{ toolNames: string[]; hookNames: string[] }> {
    this.worker = new Worker(workerRuntimePath);
    this.worker.on("message", (message: WorkerToHostMessage) => {
      // Discriminate worker-initiated RPC requests from normal responses.
      if ("type" in message && message.type === "rpc_request") {
        this.handleRpcRequest(message as WorkerRpcRequest);
        return;
      }
      // Normal request/response flow.
      const response = message as WorkerResponse;
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(response.id);
        pending.resolve(response);
      }
    });
    this.worker.on("error", (error: Error) => {
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(error);
        this.pendingRequests.delete(id);
      }
    });
    this.worker.on("exit", () => {
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error("worker exited"));
        this.pendingRequests.delete(id);
      }
      this.worker = null;
    });

    const response = await this.send({
      type: "load",
      id: this.nextId(),
      entryPath,
      manifest: this.manifest as unknown as Record<string, unknown>,
    });

    if (!response.ok) {
      throw new Error(response.error ?? "worker load failed");
    }

    this.toolNames = (response.toolNames as string[]) ?? [];
    this.hookNames = (response.hookNames as string[]) ?? [];
    return { toolNames: this.toolNames, hookNames: this.hookNames };
  }

  public async executeHook(
    hookName: string,
    event: Record<string, unknown>,
    timeoutMs = DEFAULT_WORKER_TIMEOUT_MS,
  ): Promise<unknown> {
    const response = await this.send({
      type: "execute_hook",
      id: this.nextId(),
      hookName,
      event,
      timeoutMs,
    });

    if (!response.ok) {
      throw new Error(response.error ?? "hook execution failed");
    }
    return response.result;
  }

  public async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    timeoutMs = DEFAULT_WORKER_TIMEOUT_MS,
  ): Promise<string> {
    this.ensureRpcDispatcher();

    const contextMeta = this.buildContextMeta();

    const response = await this.send({
      type: "execute_tool",
      id: this.nextId(),
      toolName,
      input,
      timeoutMs,
      ...(contextMeta !== undefined ? { contextMeta } : {}),
    });

    if (!response.ok) {
      throw new Error(response.error ?? "tool execution failed");
    }
    return String(response.result ?? "");
  }

  public async runLifecycle(
    hookName: string,
    context: { pluginId: string; nowIso: string },
    timeoutMs = DEFAULT_WORKER_TIMEOUT_MS,
  ): Promise<void> {
    const response = await this.send({
      type: "lifecycle",
      id: this.nextId(),
      hookName,
      context,
      timeoutMs,
    });

    if (!response.ok) {
      throw new Error(response.error ?? "lifecycle hook failed");
    }
  }

  public async runHealthcheck(
    context: { pluginId: string; nowIso: string },
    timeoutMs = DEFAULT_WORKER_TIMEOUT_MS,
  ): Promise<{ healthy: boolean; details?: string }> {
    const response = await this.send({
      type: "healthcheck",
      id: this.nextId(),
      context,
      timeoutMs,
    });

    if (!response.ok) {
      return { healthy: false, details: response.error ?? "healthcheck failed" };
    }
    const result = response.result as { healthy?: boolean; details?: string } | undefined;
    return {
      healthy: result?.healthy ?? true,
      ...(result?.details !== undefined ? { details: result.details } : {}),
    };
  }

  public async shutdown(): Promise<void> {
    if (!this.worker) {
      return;
    }
    try {
      await this.send({
        type: "shutdown",
        id: this.nextId(),
      });
    } catch {
      // worker may already be gone
    }
    await this.terminate();
  }

  public async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }

  public getToolNames(): string[] {
    return [...this.toolNames];
  }

  public getHookNames(): string[] {
    return [...this.hookNames];
  }

  public hasHook(hookName: string): boolean {
    return this.hookNames.includes(hookName);
  }

  public isAlive(): boolean {
    return this.worker !== null;
  }

  public toPluginProxy(): JihnPlugin {
    const host = this;
    const tools: PluginToolDefinition[] = this.toolNames.map((name) => ({
      name,
      description: `[worker] ${name}`,
      inputSchema: { type: "object" as const, properties: {} } as ToolDefinition["inputSchema"],
      async execute(input: Record<string, unknown>, _context?: PluginContext): Promise<string> {
        return host.executeTool(name, input);
      },
    }));

    const hooks: JihnPlugin["hooks"] = {};
    if (this.hasHook("beforePromptCompose")) {
      hooks.beforePromptCompose = async (event) => {
        const result = await host.executeHook("beforePromptCompose", event as unknown as Record<string, unknown>);
        return typeof result === "string" ? result : undefined;
      };
    }
    if (this.hasHook("afterPromptCompose")) {
      hooks.afterPromptCompose = async (event) => {
        const result = await host.executeHook("afterPromptCompose", event as unknown as Record<string, unknown>);
        return typeof result === "string" ? result : undefined;
      };
    }
    if (this.hasHook("beforeTurn")) {
      hooks.beforeTurn = async (event) => {
        const result = await host.executeHook("beforeTurn", event as unknown as Record<string, unknown>);
        return (result ?? undefined) as Partial<{ text: string; systemPrompt: string }> | undefined;
      };
    }
    if (this.hasHook("afterTurn")) {
      hooks.afterTurn = async (event) => {
        await host.executeHook("afterTurn", event as unknown as Record<string, unknown>);
      };
    }
    if (this.hasHook("beforeToolCall")) {
      hooks.beforeToolCall = async (event) => {
        const result = await host.executeHook("beforeToolCall", event as unknown as Record<string, unknown>);
        return (result ?? undefined) as Partial<{ input: Record<string, unknown> }> | undefined;
      };
    }
    if (this.hasHook("afterToolCall")) {
      hooks.afterToolCall = async (event) => {
        const result = await host.executeHook("afterToolCall", event as unknown as Record<string, unknown>);
        return (result ?? undefined) as Partial<{ output: string }> | undefined;
      };
    }

    const lifecycle: JihnPlugin["lifecycle"] = {
      async onInstall(ctx) {
        await host.runLifecycle("onInstall", ctx);
      },
      async onEnable(ctx) {
        await host.runLifecycle("onEnable", ctx);
      },
      async onDisable(ctx) {
        await host.runLifecycle("onDisable", ctx);
      },
      async onUnload(ctx) {
        await host.runLifecycle("onUnload", ctx);
      },
      async onHealthCheck(ctx) {
        return host.runHealthcheck(ctx);
      },
    };

    return { tools, hooks, lifecycle };
  }

  // ---------------------------------------------------------------------------
  // RPC bridge (host side)
  // ---------------------------------------------------------------------------

  private handleRpcRequest(request: WorkerRpcRequest): void {
    if (!this.rpcDispatcher) {
      this.worker?.postMessage({
        type: "rpc_response",
        rpcId: request.rpcId,
        ok: false,
        error: "context services not configured",
      } satisfies WorkerRpcResponse);
      return;
    }
    this.rpcDispatcher(request);
  }

  /**
   * Lazily build the RPC dispatcher from the gated plugin context.
   * The dispatcher routes worker RPC requests to the host's gated accessors
   * where permission checks, ACL enforcement, and audit events all fire.
   */
  private ensureRpcDispatcher(): void {
    if (this.rpcDispatcher || !this.contextServices) return;

    const ctx = createPluginContext(this.manifest, this.contextServices);
    const services: ServiceAccessorMap = {
      memory: {
        read: (query: string, options?: { namespace?: string; limit?: number }) =>
          ctx.memory.read(query, options),
        write: (text: string, options?: { namespace?: string; tags?: string[] }) =>
          ctx.memory.write(text, options),
      },
      session: {
        read: (key: string) => ctx.session.read(key),
        write: (key: string, messages: unknown[]) => ctx.session.write(key, messages),
      },
      filesystem: {
        read: (path: string) => ctx.filesystem.read(path),
        write: (path: string, content: string) => ctx.filesystem.write(path, content),
      },
      network: {
        fetch: (url: string, init?: RequestInit) => ctx.network.fetch(url, init),
      },
    };

    this.rpcDispatcher = createRpcDispatcher(services, (response) => {
      this.worker?.postMessage(response);
    });
  }

  /**
   * Build the serializable context metadata to send with a tool execution
   * request. Returns `undefined` if no context services are configured.
   */
  private buildContextMeta(): WorkerContextMeta | undefined {
    if (!this.contextServices) return undefined;

    return {
      pluginId: this.pluginId,
      permissions: [...(this.manifest.permissions ?? [])],
      manifest: this.manifest as unknown as Record<string, unknown>,
      capabilityPolicy: this.contextServices.capabilityPolicy,
      secretsSnapshot: this.secretBroker?.buildPluginEnv(this.pluginId) ?? {},
    };
  }

  // ---------------------------------------------------------------------------
  // Request infrastructure
  // ---------------------------------------------------------------------------

  private nextId(): string {
    this.requestCounter += 1;
    return `req_${this.requestCounter}`;
  }

  private send(request: WorkerRequest): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("worker not started"));
        return;
      }
      const timeoutMs =
        "timeoutMs" in request && typeof request.timeoutMs === "number"
          ? request.timeoutMs + 1000
          : DEFAULT_WORKER_TIMEOUT_MS;

      const timer = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error(`worker request timeout (${request.type})`));
      }, timeoutMs);

      this.pendingRequests.set(request.id, { resolve, reject, timer });
      this.worker.postMessage(request);
    });
  }
}
