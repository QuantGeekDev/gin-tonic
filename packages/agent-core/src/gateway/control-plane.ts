import { createHash } from "node:crypto";
import {
  InMemoryGatewayEventBus,
  type GatewayEvent,
  type GatewayEventSubscription,
} from "./events-bus.js";
import { InMemoryLaneQueue } from "./queue/in-memory-lane-queue.js";
import type {
  EnqueueLaneTaskOptions,
  LaneQueueOptions,
  QueuePriority,
} from "./queue/types.js";

export interface GatewayConnectInput {
  clientId: string;
  authToken?: string;
  metadata?: {
    name?: string;
    version?: string;
    capabilities?: string[];
  };
}

export interface GatewayClientSession {
  clientId: string;
  connectedAt: string;
  metadata?: {
    name?: string;
    version?: string;
    capabilities?: string[];
  };
}

export interface GatewayControlPlaneOptions {
  authTokens?: string[];
  idempotencyTtlMs?: number;
  queue?: LaneQueueOptions;
  eventRetention?: number;
}

export interface GatewayRequestContext {
  clientId: string;
  requestId: string;
  method: string;
}

export interface GatewayMethodMap {
  "health.get": {
    params: Record<string, never>;
    result: {
      status: "ok";
      nowIso: string;
      queue: {
        queued: number;
        active: number;
      };
    };
  };
  "agent.run": {
    params: {
      sessionKey: string;
      text: string;
      priority?: QueuePriority;
      metadata?: Record<string, unknown>;
    };
    result: {
      sessionKey: string;
      output: string;
    };
  };
}

export class GatewayControlPlaneError extends Error {
  public readonly code: string;

  public readonly statusCode: number;

  public readonly details?: Record<string, unknown>;

  public constructor(params: {
    code: string;
    statusCode: number;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = "GatewayControlPlaneError";
    this.code = params.code;
    this.statusCode = params.statusCode;
    if (params.details !== undefined) {
      this.details = params.details;
    }
  }
}

interface MethodHandler<TParams, TResult> {
  (params: TParams, context: GatewayRequestContext): Promise<TResult>;
}

interface IdempotencyEntry {
  fingerprint: string;
  result: unknown;
  expiresAt: number;
}

const DEFAULT_IDEMPOTENCY_TTL_MS = 5 * 60_000;

type AgentRunHandler = MethodHandler<
  GatewayMethodMap["agent.run"]["params"],
  GatewayMethodMap["agent.run"]["result"]
>;

function nowIso(): string {
  return new Date().toISOString();
}

function trimNonEmpty(value: string, field: string): string {
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

function fingerprintFor(method: string, params: unknown): string {
  return createHash("sha256").update(`${method}:${JSON.stringify(params)}`).digest("hex");
}

export class GatewayControlPlaneService {
  private readonly authTokens: Set<string>;

  private readonly idempotencyTtlMs: number;

  private readonly queue: InMemoryLaneQueue;

  private readonly eventBus: InMemoryGatewayEventBus;

  private readonly sessions = new Map<string, GatewayClientSession>();

  private readonly idempotency = new Map<string, IdempotencyEntry>();

  private agentRunHandler: AgentRunHandler;

  public constructor(options: GatewayControlPlaneOptions = {}) {
    this.authTokens = new Set((options.authTokens ?? []).map((token) => token.trim()).filter(Boolean));
    this.idempotencyTtlMs = Number.isFinite(options.idempotencyTtlMs)
      ? Math.max(1_000, Math.floor(options.idempotencyTtlMs as number))
      : DEFAULT_IDEMPOTENCY_TTL_MS;
    this.queue = new InMemoryLaneQueue(options.queue);
    this.eventBus = new InMemoryGatewayEventBus(
      options.eventRetention !== undefined
        ? {
            maxEvents: options.eventRetention,
          }
        : {},
    );
    this.agentRunHandler = async (params) => ({
      sessionKey: params.sessionKey,
      output: `not_implemented:${params.text}`,
    });

    this.queue.subscribe((snapshot) => {
      this.eventBus.emit("queue.depth.changed", snapshot);
    });
  }

  public setAgentRunHandler(handler: AgentRunHandler): void {
    this.agentRunHandler = handler;
  }

  public connect(input: GatewayConnectInput): GatewayClientSession {
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

    const session: GatewayClientSession = {
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

  public disconnect(clientId: string): void {
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

  public subscribeToEvents(params: {
    replayFromSeq?: number;
    eventTypes?: string[];
    onEvent: (event: GatewayEvent) => void;
  }): GatewayEventSubscription {
    return this.eventBus.subscribe(params);
  }

  public async request<K extends keyof GatewayMethodMap>(params: {
    clientId: string;
    requestId: string;
    method: K;
    payload: GatewayMethodMap[K]["params"];
    idempotencyKey?: string;
  }): Promise<GatewayMethodMap[K]["result"]> {
    this.ensureConnected(params.clientId);
    this.gcIdempotency();

    const context: GatewayRequestContext = {
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
        return existing.result as GatewayMethodMap[K]["result"];
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

  public getQueueSnapshot() {
    return this.queue.getSnapshot();
  }

  public getDeadLetters() {
    return this.queue.listDeadLetters();
  }

  public getConnectedClientCount(): number {
    return this.sessions.size;
  }

  private ensureConnected(clientId: string): void {
    const normalizedClientId = trimNonEmpty(clientId, "clientId");
    if (!this.sessions.has(normalizedClientId)) {
      throw new GatewayControlPlaneError({
        code: "UNAUTHORIZED",
        statusCode: 401,
        message: "client is not connected",
      });
    }
  }

  private async dispatchMethod<K extends keyof GatewayMethodMap>(
    context: GatewayRequestContext,
    method: K,
    payload: GatewayMethodMap[K]["params"],
  ): Promise<GatewayMethodMap[K]["result"]> {
    if (method === "health.get") {
      return {
        status: "ok",
        nowIso: nowIso(),
        queue: {
          queued: this.queue.getSnapshot().queued,
          active: this.queue.getSnapshot().active,
        },
      } as GatewayMethodMap[K]["result"];
    }

    if (method === "agent.run") {
      const typed = payload as GatewayMethodMap["agent.run"]["params"];
      const sessionKey = trimNonEmpty(typed.sessionKey, "sessionKey");
      const text = trimNonEmpty(typed.text, "text");

      const enqueueOptions: EnqueueLaneTaskOptions = {
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
        return await this.agentRunHandler(
          {
            ...typed,
            sessionKey,
            text,
          },
          context,
        );
      });

      try {
        const output = await result;
        this.eventBus.emit("agent.turn.completed", {
          sessionKey,
          requestId: context.requestId,
          clientId: context.clientId,
        });
        return output as GatewayMethodMap[K]["result"];
      } catch (error) {
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

  private gcIdempotency(): void {
    const now = Date.now();
    for (const [key, entry] of this.idempotency.entries()) {
      if (entry.expiresAt <= now) {
        this.idempotency.delete(key);
      }
    }
  }
}
