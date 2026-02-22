import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRpcDispatcher, } from "./rpc-bridge.js";
import { createPluginContext } from "../context.js";
const DEFAULT_WORKER_TIMEOUT_MS = 10_000;
const workerRuntimePath = join(dirname(fileURLToPath(import.meta.url)), "worker-runtime.js");
/**
 * Essential env vars that must be passed to worker threads for Node.js
 * module resolution and basic runtime functionality.
 */
const WORKER_ENV_PASSTHROUGH_KEYS = [
    "NODE_PATH",
    "HOME",
    "PATH",
    "LANG",
    "TZ",
];
export class PluginWorkerHost {
    worker = null;
    pendingRequests = new Map();
    requestCounter = 0;
    toolNames = [];
    hookNames = [];
    pluginId;
    manifest;
    // Context bridge state
    contextServices = null;
    secretBroker = null;
    rpcDispatcher = null;
    constructor(manifest) {
        this.manifest = manifest;
        this.pluginId = manifest.id;
    }
    /**
     * Provide the service implementations that back the worker's PluginContext.
     * When set, tool execution requests include `contextMeta` and RPC calls
     * from the worker are routed through gated accessors on the host.
     */
    setContextServices(services, secretBroker) {
        this.contextServices = services;
        this.secretBroker = secretBroker ?? null;
        // Reset the dispatcher so it's rebuilt with the new services.
        this.rpcDispatcher = null;
    }
    async start(entryPath) {
        this.worker = new Worker(workerRuntimePath, {
            env: this.buildWorkerEnv(),
        });
        this.worker.on("message", (message) => {
            // Discriminate worker-initiated RPC requests from normal responses.
            if ("type" in message && message.type === "rpc_request") {
                this.handleRpcRequest(message);
                return;
            }
            // Normal request/response flow.
            const response = message;
            const pending = this.pendingRequests.get(response.id);
            if (pending) {
                clearTimeout(pending.timer);
                this.pendingRequests.delete(response.id);
                pending.resolve(response);
            }
        });
        this.worker.on("error", (error) => {
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
            manifest: this.manifest,
        });
        if (!response.ok) {
            throw new Error(response.error ?? "worker load failed");
        }
        this.toolNames = response.toolNames ?? [];
        this.hookNames = response.hookNames ?? [];
        return { toolNames: this.toolNames, hookNames: this.hookNames };
    }
    async executeHook(hookName, event, timeoutMs = DEFAULT_WORKER_TIMEOUT_MS) {
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
    async executeTool(toolName, input, timeoutMs = DEFAULT_WORKER_TIMEOUT_MS) {
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
    async runLifecycle(hookName, context, timeoutMs = DEFAULT_WORKER_TIMEOUT_MS) {
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
    async runHealthcheck(context, timeoutMs = DEFAULT_WORKER_TIMEOUT_MS) {
        const response = await this.send({
            type: "healthcheck",
            id: this.nextId(),
            context,
            timeoutMs,
        });
        if (!response.ok) {
            return { healthy: false, details: response.error ?? "healthcheck failed" };
        }
        const result = response.result;
        return {
            healthy: result?.healthy ?? true,
            ...(result?.details !== undefined ? { details: result.details } : {}),
        };
    }
    async shutdown() {
        if (!this.worker) {
            return;
        }
        try {
            await this.send({
                type: "shutdown",
                id: this.nextId(),
            });
        }
        catch {
            // worker may already be gone
        }
        await this.terminate();
    }
    async terminate() {
        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }
    }
    getToolNames() {
        return [...this.toolNames];
    }
    getHookNames() {
        return [...this.hookNames];
    }
    hasHook(hookName) {
        return this.hookNames.includes(hookName);
    }
    isAlive() {
        return this.worker !== null;
    }
    toPluginProxy() {
        const host = this;
        const tools = this.toolNames.map((name) => ({
            name,
            description: `[worker] ${name}`,
            inputSchema: { type: "object", properties: {} },
            async execute(input, _context) {
                return host.executeTool(name, input);
            },
        }));
        const hooks = {};
        if (this.hasHook("beforePromptCompose")) {
            hooks.beforePromptCompose = async (event) => {
                const result = await host.executeHook("beforePromptCompose", event);
                return typeof result === "string" ? result : undefined;
            };
        }
        if (this.hasHook("afterPromptCompose")) {
            hooks.afterPromptCompose = async (event) => {
                const result = await host.executeHook("afterPromptCompose", event);
                return typeof result === "string" ? result : undefined;
            };
        }
        if (this.hasHook("beforeTurn")) {
            hooks.beforeTurn = async (event) => {
                const result = await host.executeHook("beforeTurn", event);
                return (result ?? undefined);
            };
        }
        if (this.hasHook("afterTurn")) {
            hooks.afterTurn = async (event) => {
                await host.executeHook("afterTurn", event);
            };
        }
        if (this.hasHook("beforeToolCall")) {
            hooks.beforeToolCall = async (event) => {
                const result = await host.executeHook("beforeToolCall", event);
                return (result ?? undefined);
            };
        }
        if (this.hasHook("afterToolCall")) {
            hooks.afterToolCall = async (event) => {
                const result = await host.executeHook("afterToolCall", event);
                return (result ?? undefined);
            };
        }
        const lifecycle = {
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
    handleRpcRequest(request) {
        if (!this.rpcDispatcher) {
            this.worker?.postMessage({
                type: "rpc_response",
                rpcId: request.rpcId,
                ok: false,
                error: "context services not configured",
            });
            return;
        }
        this.rpcDispatcher(request);
    }
    /**
     * Lazily build the RPC dispatcher from the gated plugin context.
     * The dispatcher routes worker RPC requests to the host's gated accessors
     * where permission checks, ACL enforcement, and audit events all fire.
     */
    ensureRpcDispatcher() {
        if (this.rpcDispatcher || !this.contextServices)
            return;
        const ctx = createPluginContext(this.manifest, this.contextServices);
        const services = {
            memory: {
                read: (query, options) => ctx.memory.read(query, options),
                write: (text, options) => ctx.memory.write(text, options),
            },
            session: {
                read: (key) => ctx.session.read(key),
                write: (key, messages) => ctx.session.write(key, messages),
            },
            filesystem: {
                read: (path) => ctx.filesystem.read(path),
                write: (path, content) => ctx.filesystem.write(path, content),
            },
            network: {
                fetch: (url, init) => ctx.network.fetch(url, init),
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
    buildContextMeta() {
        if (!this.contextServices)
            return undefined;
        return {
            pluginId: this.pluginId,
            permissions: [...(this.manifest.permissions ?? [])],
            manifest: this.manifest,
            capabilityPolicy: this.contextServices.capabilityPolicy,
            secretsSnapshot: this.secretBroker?.buildPluginEnv(this.pluginId) ?? {},
        };
    }
    // ---------------------------------------------------------------------------
    // Env sanitization
    // ---------------------------------------------------------------------------
    /**
     * Build a minimal env for the worker thread. Only passes through essential
     * Node.js runtime vars plus broker-scoped secrets. Prevents leakage of
     * host process.env (API keys, database URLs, etc.) to plugin code.
     */
    buildWorkerEnv() {
        const env = {};
        for (const key of WORKER_ENV_PASSTHROUGH_KEYS) {
            const value = process.env[key];
            if (value !== undefined) {
                env[key] = value;
            }
        }
        // Merge broker-scoped secrets (only explicitly granted scopes).
        if (this.secretBroker) {
            Object.assign(env, this.secretBroker.buildPluginEnv(this.pluginId));
        }
        return env;
    }
    // ---------------------------------------------------------------------------
    // Request infrastructure
    // ---------------------------------------------------------------------------
    nextId() {
        this.requestCounter += 1;
        return `req_${this.requestCounter}`;
    }
    send(request) {
        return new Promise((resolve, reject) => {
            if (!this.worker) {
                reject(new Error("worker not started"));
                return;
            }
            const timeoutMs = "timeoutMs" in request && typeof request.timeoutMs === "number"
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
//# sourceMappingURL=worker-host.js.map