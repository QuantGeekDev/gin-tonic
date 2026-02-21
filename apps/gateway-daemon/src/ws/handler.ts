import {
  GatewayControlPlaneService,
  isGatewayError,
  type GatewayEventSubscription,
  type GatewayInboundFrame,
} from "@jihn/agent-core";
import type { FixedWindowRateLimiter } from "../rate-limit.js";

export interface GatewayWsConnectionState {
  connectedClientId: string | null;
  subscriptions: Map<string, GatewayEventSubscription>;
}

export interface GatewayWsFrameContext {
  frame: GatewayInboundFrame;
  state: GatewayWsConnectionState;
  gateway: GatewayControlPlaneService;
  rateLimiter: FixedWindowRateLimiter;
  send: (frame: Record<string, unknown>) => void;
  onUnhandledRequest?: (params: {
    frame: Extract<GatewayInboundFrame, { type: "req" }>;
    clientId: string;
  }) => Promise<boolean>;
  onAudit?: (params: {
    clientId: string;
    requestId: string;
    method: string;
    durationMs: number;
    outcome: "ok" | "error" | "rate_limited";
  }) => void;
}

function emitError(params: {
  send: (frame: Record<string, unknown>) => void;
  id?: string;
  code: string;
  message: string;
  details?: unknown;
}): void {
  params.send({
    type: "error",
    ...(params.id !== undefined ? { id: params.id } : {}),
    code: params.code,
    message: params.message,
    ...(params.details !== undefined ? { details: params.details } : {}),
  });
}

export async function handleGatewayWsFrame(context: GatewayWsFrameContext): Promise<boolean> {
  const startedAt = Date.now();
  const { frame, state, gateway, rateLimiter, send, onUnhandledRequest, onAudit } = context;

  try {
    if (frame.type === "connect") {
      const session = gateway.connect({
        clientId: frame.client.id,
        ...(frame.auth?.token !== undefined ? { authToken: frame.auth.token } : {}),
        metadata: {
          ...(frame.client.name ? { name: frame.client.name } : {}),
          ...(frame.client.version ? { version: frame.client.version } : {}),
          ...(frame.client.capabilities ? { capabilities: frame.client.capabilities } : {}),
        },
      });
      state.connectedClientId = session.clientId;
      send({
        type: "res",
        id: frame.id,
        ok: true,
        result: {
          connectedAt: session.connectedAt,
          clientId: session.clientId,
        },
      });
      return true;
    }

    if (frame.type === "ack") {
      return true;
    }

    if (!state.connectedClientId) {
      emitError({
        send,
        code: "UNAUTHORIZED",
        message: "connect handshake required before requests",
      });
      return true;
    }

    const rateLimitDecision = rateLimiter.decide(state.connectedClientId);
    if (!rateLimitDecision.allowed) {
      emitError({
        send,
        id: frame.id,
        code: "RATE_LIMITED",
        message: "request rate limit exceeded",
        details: {
          limit: rateLimitDecision.limit,
          windowMs: rateLimitDecision.windowMs,
          retryAfterMs: rateLimitDecision.retryAfterMs,
        },
      });
      onAudit?.({
        clientId: state.connectedClientId,
        requestId: frame.id,
        method: frame.method,
        durationMs: Math.max(0, Date.now() - startedAt),
        outcome: "rate_limited",
      });
      return true;
    }

    if (frame.method === "events.subscribe") {
      const params = (frame.params ?? {}) as {
        replayFromSeq?: number;
        eventTypes?: string[];
      };
      const subscription = gateway.subscribeToEvents({
        ...(params.replayFromSeq !== undefined ? { replayFromSeq: params.replayFromSeq } : {}),
        ...(params.eventTypes !== undefined ? { eventTypes: params.eventTypes } : {}),
        onEvent(event) {
          send({
            type: "event",
            event: event.type,
            seq: event.seq,
            timestamp: event.timestamp,
            payload: event.payload,
          });
        },
      });
      state.subscriptions.set(subscription.id, subscription);
      send({
        type: "res",
        id: frame.id,
        ok: true,
        result: { subscriptionId: subscription.id },
      });
      onAudit?.({
        clientId: state.connectedClientId,
        requestId: frame.id,
        method: frame.method,
        durationMs: Math.max(0, Date.now() - startedAt),
        outcome: "ok",
      });
      return true;
    }

    if (frame.method === "events.unsubscribe") {
      const params = (frame.params ?? {}) as { subscriptionId?: string };
      if (params.subscriptionId && state.subscriptions.has(params.subscriptionId)) {
        const subscription = state.subscriptions.get(params.subscriptionId) as GatewayEventSubscription;
        subscription.unsubscribe();
        state.subscriptions.delete(params.subscriptionId);
      }
      send({ type: "res", id: frame.id, ok: true, result: { ok: true } });
      onAudit?.({
        clientId: state.connectedClientId,
        requestId: frame.id,
        method: frame.method,
        durationMs: Math.max(0, Date.now() - startedAt),
        outcome: "ok",
      });
      return true;
    }

    if (frame.method === "health.get") {
      const result = await gateway.request({
        clientId: state.connectedClientId,
        requestId: frame.id,
        method: "health.get",
        payload: {},
      });
      send({ type: "res", id: frame.id, ok: true, result });
      onAudit?.({
        clientId: state.connectedClientId,
        requestId: frame.id,
        method: frame.method,
        durationMs: Math.max(0, Date.now() - startedAt),
        outcome: "ok",
      });
      return true;
    }

    if (onUnhandledRequest !== undefined) {
      const handled = await onUnhandledRequest({
        frame,
        clientId: state.connectedClientId,
      });
      if (handled) {
        onAudit?.({
          clientId: state.connectedClientId,
          requestId: frame.id,
          method: frame.method,
          durationMs: Math.max(0, Date.now() - startedAt),
          outcome: "ok",
        });
        return true;
      }
    }

    return false;
  } catch (error) {
    if (isGatewayError(error)) {
      emitError({
        send,
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      });
    } else {
      emitError({
        send,
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (state.connectedClientId !== null) {
      onAudit?.({
        clientId: state.connectedClientId,
        requestId: frame.id,
        method: frame.type === "req" ? frame.method : "connect",
        durationMs: Math.max(0, Date.now() - startedAt),
        outcome: "error",
      });
    }
    return true;
  }
}
