import { createHash } from "node:crypto";
import { InMemoryGatewayEventBus, } from "./events-bus.js";
import { InMemoryLaneQueue } from "./queue/in-memory-lane-queue.js";
export class GatewayControlPlaneError extends Error {
    code;
    statusCode;
    details;
    constructor(params) {
        super(params.message);
        this.name = "GatewayControlPlaneError";
        this.code = params.code;
        this.statusCode = params.statusCode;
        if (params.details !== undefined) {
            this.details = params.details;
        }
    }
}
const DEFAULT_IDEMPOTENCY_TTL_MS = 5 * 60_000;
function nowIso() {
    return new Date().toISOString();
}
function trimNonEmpty(value, field) {
    const normalized = value.trim();
    if (normalized.length === 0) {
        throw new GatewayControlPlaneError({
            code: "INVALID_ARGUMENT",
            statusCode: 400,
            message: `${field} must be a non-empty string`,
        });
    }
    return normalized;
}
function fingerprintFor(method, params) {
    return createHash("sha256").update(`${method}:${JSON.stringify(params)}`).digest("hex");
}
export class GatewayControlPlaneService {
    authTokens;
    idempotencyTtlMs;
    queue;
    eventBus;
    sessions = new Map();
    idempotency = new Map();
    agentRunHandler;
    constructor(options = {}) {
        this.authTokens = new Set((options.authTokens ?? []).map((token) => token.trim()).filter(Boolean));
        this.idempotencyTtlMs = Number.isFinite(options.idempotencyTtlMs)
            ? Math.max(1_000, Math.floor(options.idempotencyTtlMs))
            : DEFAULT_IDEMPOTENCY_TTL_MS;
        this.queue = new InMemoryLaneQueue(options.queue);
        this.eventBus = new InMemoryGatewayEventBus(options.eventRetention !== undefined
            ? {
                maxEvents: options.eventRetention,
            }
            : {});
        this.agentRunHandler = async (params) => ({
            sessionKey: params.sessionKey,
            output: `not_implemented:${params.text}`,
        });
        this.queue.subscribe((snapshot) => {
            this.eventBus.emit("queue.depth.changed", snapshot);
        });
    }
    setAgentRunHandler(handler) {
        this.agentRunHandler = handler;
    }
    connect(input) {
        const clientId = trimNonEmpty(input.clientId, "clientId");
        if (this.authTokens.size > 0) {
            const token = input.authToken?.trim();
            if (!token || !this.authTokens.has(token)) {
                throw new GatewayControlPlaneError({
                    code: "UNAUTHORIZED",
                    statusCode: 401,
                    message: "invalid gateway auth token",
                });
            }
        }
        const session = {
            clientId,
            connectedAt: nowIso(),
            ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        };
        this.sessions.set(clientId, session);
        this.eventBus.emit("gateway.client.connected", {
            clientId,
            connectedAt: session.connectedAt,
            metadata: input.metadata ?? null,
        });
        return session;
    }
    disconnect(clientId) {
        const normalizedClientId = clientId.trim();
        if (normalizedClientId.length === 0) {
            return;
        }
        const existed = this.sessions.delete(normalizedClientId);
        if (!existed) {
            return;
        }
        this.eventBus.emit("gateway.client.disconnected", {
            clientId: normalizedClientId,
            disconnectedAt: nowIso(),
        });
    }
    subscribeToEvents(params) {
        return this.eventBus.subscribe(params);
    }
    async request(params) {
        this.ensureConnected(params.clientId);
        this.gcIdempotency();
        const context = {
            clientId: params.clientId,
            requestId: trimNonEmpty(params.requestId, "requestId"),
            method: String(params.method),
        };
        const idempotencyKey = params.idempotencyKey?.trim();
        if (idempotencyKey && idempotencyKey.length > 0) {
            const cacheKey = `${params.clientId}:${context.method}:${idempotencyKey}`;
            const fingerprint = fingerprintFor(context.method, params.payload);
            const existing = this.idempotency.get(cacheKey);
            if (existing) {
                if (existing.fingerprint !== fingerprint) {
                    throw new GatewayControlPlaneError({
                        code: "IDEMPOTENCY_CONFLICT",
                        statusCode: 409,
                        message: "idempotency key already used with different payload",
                    });
                }
                return existing.result;
            }
            const result = await this.dispatchMethod(context, params.method, params.payload);
            this.idempotency.set(cacheKey, {
                fingerprint,
                result,
                expiresAt: Date.now() + this.idempotencyTtlMs,
            });
            return result;
        }
        return await this.dispatchMethod(context, params.method, params.payload);
    }
    getQueueSnapshot() {
        return this.queue.getSnapshot();
    }
    getDeadLetters() {
        return this.queue.listDeadLetters();
    }
    getConnectedClientCount() {
        return this.sessions.size;
    }
    ensureConnected(clientId) {
        const normalizedClientId = trimNonEmpty(clientId, "clientId");
        if (!this.sessions.has(normalizedClientId)) {
            throw new GatewayControlPlaneError({
                code: "UNAUTHORIZED",
                statusCode: 401,
                message: "client is not connected",
            });
        }
    }
    async dispatchMethod(context, method, payload) {
        if (method === "health.get") {
            return {
                status: "ok",
                nowIso: nowIso(),
                queue: {
                    queued: this.queue.getSnapshot().queued,
                    active: this.queue.getSnapshot().active,
                },
            };
        }
        if (method === "agent.run") {
            const typed = payload;
            const sessionKey = trimNonEmpty(typed.sessionKey, "sessionKey");
            const text = trimNonEmpty(typed.text, "text");
            const enqueueOptions = {
                lane: `session:${sessionKey}`,
                priority: typed.priority ?? "interactive",
                ...(typed.metadata !== undefined ? { metadata: typed.metadata } : {}),
            };
            this.eventBus.emit("agent.turn.started", {
                sessionKey,
                requestId: context.requestId,
                clientId: context.clientId,
            });
            const { result } = this.queue.enqueue(enqueueOptions, async () => {
                return await this.agentRunHandler({
                    ...typed,
                    sessionKey,
                    text,
                }, context);
            });
            try {
                const output = await result;
                this.eventBus.emit("agent.turn.completed", {
                    sessionKey,
                    requestId: context.requestId,
                    clientId: context.clientId,
                });
                return output;
            }
            catch (error) {
                this.eventBus.emit("agent.turn.failed", {
                    sessionKey,
                    requestId: context.requestId,
                    clientId: context.clientId,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        }
        throw new GatewayControlPlaneError({
            code: "METHOD_NOT_FOUND",
            statusCode: 404,
            message: `Unsupported method: ${String(method)}`,
        });
    }
    gcIdempotency() {
        const now = Date.now();
        for (const [key, entry] of this.idempotency.entries()) {
            if (entry.expiresAt <= now) {
                this.idempotency.delete(key);
            }
        }
    }
}
//# sourceMappingURL=control-plane.js.map