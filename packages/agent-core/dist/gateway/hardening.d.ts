import type { HandleMessageResult } from "./handle-message.js";
export type GatewayErrorCode = "INVALID_ARGUMENT" | "IDEMPOTENCY_CONFLICT" | "TOOL_POLICY_BLOCKED" | "INTERNAL_ERROR";
export declare class GatewayError extends Error {
    readonly code: GatewayErrorCode;
    readonly statusCode: number;
    readonly details?: Record<string, unknown>;
    constructor(params: {
        code: GatewayErrorCode;
        message: string;
        statusCode?: number;
        details?: Record<string, unknown>;
        cause?: unknown;
    });
}
export declare function isGatewayError(value: unknown): value is GatewayError;
export type GatewayLogLevel = "info" | "warn" | "error";
export interface GatewayLogEvent {
    level: GatewayLogLevel;
    event: string;
    timestamp: string;
    sessionKey?: string;
    idempotencyKey?: string;
    requestId?: string;
    details?: Record<string, unknown>;
}
export interface GatewayLogger {
    log(event: GatewayLogEvent): void;
}
export declare const DEFAULT_GATEWAY_LOGGER: GatewayLogger;
interface IdempotencyEntry {
    fingerprint: string;
    result: HandleMessageResult;
    createdAtMs: number;
}
export interface GatewayIdempotencyStore {
    get(sessionKey: string, idempotencyKey: string): Promise<IdempotencyEntry | null>;
    set(sessionKey: string, idempotencyKey: string, entry: IdempotencyEntry): Promise<void>;
}
export declare class InMemoryGatewayIdempotencyStore implements GatewayIdempotencyStore {
    private readonly entries;
    private readonly ttlMs;
    constructor(ttlMs?: number);
    private buildKey;
    private isExpired;
    get(sessionKey: string, idempotencyKey: string): Promise<IdempotencyEntry | null>;
    set(sessionKey: string, idempotencyKey: string, entry: IdempotencyEntry): Promise<void>;
}
export declare const DEFAULT_IDEMPOTENCY_STORE: InMemoryGatewayIdempotencyStore;
export interface SessionLockManager {
    runExclusive<T>(sessionKey: string, task: () => Promise<T>): Promise<T>;
}
export declare class InMemorySessionLockManager implements SessionLockManager {
    private readonly chains;
    runExclusive<T>(sessionKey: string, task: () => Promise<T>): Promise<T>;
}
export declare const DEFAULT_SESSION_LOCK_MANAGER: InMemorySessionLockManager;
export declare function buildIdempotencyFingerprint(params: {
    text: string;
    model?: string;
    maxTurns?: number;
    maxTokens?: number;
    agentId: string;
    scope: string;
    channelId: string;
    peerId: string;
}): string;
export {};
//# sourceMappingURL=hardening.d.ts.map