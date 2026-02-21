import { createHash } from "node:crypto";
import { createJihnLogger } from "../observability/logger.js";
import type { HandleMessageResult } from "./handle-message.js";

export type GatewayErrorCode =
  | "INVALID_ARGUMENT"
  | "IDEMPOTENCY_CONFLICT"
  | "TOOL_POLICY_BLOCKED"
  | "INTERNAL_ERROR";

export class GatewayError extends Error {
  public readonly code: GatewayErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  public constructor(params: {
    code: GatewayErrorCode;
    message: string;
    statusCode?: number;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(params.message, params.cause !== undefined ? { cause: params.cause } : undefined);
    this.name = "GatewayError";
    this.code = params.code;
    this.statusCode = params.statusCode ?? 500;
    if (params.details !== undefined) {
      this.details = params.details;
    }
  }
}

export function isGatewayError(value: unknown): value is GatewayError {
  return value instanceof GatewayError;
}

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

class ConsoleGatewayLogger implements GatewayLogger {
  private readonly logger = createJihnLogger({
    name: "jihn-gateway",
  });

  public log(event: GatewayLogEvent): void {
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

export const DEFAULT_GATEWAY_LOGGER: GatewayLogger = new ConsoleGatewayLogger();

interface IdempotencyEntry {
  fingerprint: string;
  result: HandleMessageResult;
  createdAtMs: number;
}

export interface GatewayIdempotencyStore {
  get(sessionKey: string, idempotencyKey: string): Promise<IdempotencyEntry | null>;
  set(
    sessionKey: string,
    idempotencyKey: string,
    entry: IdempotencyEntry,
  ): Promise<void>;
}

export class InMemoryGatewayIdempotencyStore implements GatewayIdempotencyStore {
  private readonly entries = new Map<string, IdempotencyEntry>();
  private readonly ttlMs: number;

  public constructor(ttlMs = 24 * 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  private buildKey(sessionKey: string, idempotencyKey: string): string {
    return `${sessionKey}::${idempotencyKey}`;
  }

  private isExpired(entry: IdempotencyEntry): boolean {
    return Date.now() - entry.createdAtMs > this.ttlMs;
  }

  public async get(sessionKey: string, idempotencyKey: string): Promise<IdempotencyEntry | null> {
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

  public async set(
    sessionKey: string,
    idempotencyKey: string,
    entry: IdempotencyEntry,
  ): Promise<void> {
    const key = this.buildKey(sessionKey, idempotencyKey);
    this.entries.set(key, entry);
  }
}

export const DEFAULT_IDEMPOTENCY_STORE = new InMemoryGatewayIdempotencyStore();

export interface SessionLockManager {
  runExclusive<T>(sessionKey: string, task: () => Promise<T>): Promise<T>;
}

export class InMemorySessionLockManager implements SessionLockManager {
  private readonly chains = new Map<string, Promise<void>>();

  public async runExclusive<T>(
    sessionKey: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.chains.get(sessionKey) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const nextChain = previous.then(() => current);
    this.chains.set(sessionKey, nextChain);

    await previous;
    try {
      return await task();
    } finally {
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

export function buildIdempotencyFingerprint(params: {
  text: string;
  model?: string;
  maxTurns?: number;
  maxTokens?: number;
  agentId: string;
  scope: string;
  channelId: string;
  peerId: string;
}): string {
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
