import { createHash } from "node:crypto";
import { createJihnLogger } from "../observability/logger.js";
export class GatewayError extends Error {
    code;
    statusCode;
    details;
    constructor(params) {
        super(params.message, params.cause !== undefined ? { cause: params.cause } : undefined);
        this.name = "GatewayError";
        this.code = params.code;
        this.statusCode = params.statusCode ?? 500;
        if (params.details !== undefined) {
            this.details = params.details;
        }
    }
}
export function isGatewayError(value) {
    return value instanceof GatewayError;
}
class ConsoleGatewayLogger {
    logger = createJihnLogger({
        name: "jihn-gateway",
    });
    log(event) {
        if (event.level === "error") {
            this.logger.error(event);
            return;
        }
        if (event.level === "warn") {
            this.logger.warn(event);
            return;
        }
        this.logger.info(event);
    }
}
export const DEFAULT_GATEWAY_LOGGER = new ConsoleGatewayLogger();
export class InMemoryGatewayIdempotencyStore {
    entries = new Map();
    ttlMs;
    constructor(ttlMs = 24 * 60 * 60 * 1000) {
        this.ttlMs = ttlMs;
    }
    buildKey(sessionKey, idempotencyKey) {
        return `${sessionKey}::${idempotencyKey}`;
    }
    isExpired(entry) {
        return Date.now() - entry.createdAtMs > this.ttlMs;
    }
    async get(sessionKey, idempotencyKey) {
        const key = this.buildKey(sessionKey, idempotencyKey);
        const entry = this.entries.get(key) ?? null;
        if (entry === null) {
            return null;
        }
        if (this.isExpired(entry)) {
            this.entries.delete(key);
            return null;
        }
        return entry;
    }
    async set(sessionKey, idempotencyKey, entry) {
        const key = this.buildKey(sessionKey, idempotencyKey);
        this.entries.set(key, entry);
    }
}
export const DEFAULT_IDEMPOTENCY_STORE = new InMemoryGatewayIdempotencyStore();
export class InMemorySessionLockManager {
    chains = new Map();
    async runExclusive(sessionKey, task) {
        const previous = this.chains.get(sessionKey) ?? Promise.resolve();
        let release;
        const current = new Promise((resolve) => {
            release = resolve;
        });
        const nextChain = previous.then(() => current);
        this.chains.set(sessionKey, nextChain);
        await previous;
        try {
            return await task();
        }
        finally {
            if (release !== undefined) {
                release();
            }
            if (this.chains.get(sessionKey) === nextChain) {
                this.chains.delete(sessionKey);
            }
        }
    }
}
export const DEFAULT_SESSION_LOCK_MANAGER = new InMemorySessionLockManager();
export function buildIdempotencyFingerprint(params) {
    const canonical = JSON.stringify({
        text: params.text,
        model: params.model ?? null,
        maxTurns: params.maxTurns ?? null,
        maxTokens: params.maxTokens ?? null,
        agentId: params.agentId,
        scope: params.scope,
        channelId: params.channelId,
        peerId: params.peerId,
    });
    return createHash("sha256").update(canonical).digest("hex");
}
//# sourceMappingURL=hardening.js.map