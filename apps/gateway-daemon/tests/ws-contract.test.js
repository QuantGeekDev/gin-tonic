import { describe, expect, it } from "@jest/globals";
import { GatewayControlPlaneService } from "@jihn/agent-core";

import { FixedWindowRateLimiter } from "../dist/rate-limit.js";
import { handleGatewayWsFrame } from "../dist/ws/handler.js";

function state() {
  return {
    connectedClientId: null,
    subscriptions: new Map(),
  };
}

describe("handleGatewayWsFrame", () => {
  it("rejects requests before connect handshake", async () => {
    const sent = [];
    const handled = await handleGatewayWsFrame({
      frame: {
        type: "req",
        id: "req-1",
        method: "health.get",
        params: {},
      },
      state: state(),
      gateway: new GatewayControlPlaneService(),
      rateLimiter: new FixedWindowRateLimiter({ limit: 5, windowMs: 60_000 }),
      send(frame) {
        sent.push(frame);
      },
    });

    expect(handled).toBe(true);
    expect(sent[0]).toMatchObject({
      type: "error",
      code: "UNAUTHORIZED",
    });
  });

  it("handles connect + health.get request", async () => {
    const sent = [];
    const connectionState = state();
    const gateway = new GatewayControlPlaneService();
    const limiter = new FixedWindowRateLimiter({ limit: 5, windowMs: 60_000 });

    await handleGatewayWsFrame({
      frame: {
        type: "connect",
        id: "connect-1",
        protocolVersion: 1,
        client: {
          id: "client-a",
          name: "test",
        },
      },
      state: connectionState,
      gateway,
      rateLimiter: limiter,
      send(frame) {
        sent.push(frame);
      },
    });

    await handleGatewayWsFrame({
      frame: {
        type: "req",
        id: "req-2",
        method: "health.get",
        params: {},
      },
      state: connectionState,
      gateway,
      rateLimiter: limiter,
      send(frame) {
        sent.push(frame);
      },
    });

    expect(connectionState.connectedClientId).toBe("client-a");
    expect(sent[0]).toMatchObject({ type: "res", id: "connect-1", ok: true });
    expect(sent[1]).toMatchObject({
      type: "res",
      id: "req-2",
      ok: true,
      result: {
        status: "ok",
      },
    });
  });

  it("supports event subscription with replay", async () => {
    const sent = [];
    const connectionState = state();
    const gateway = new GatewayControlPlaneService();
    const limiter = new FixedWindowRateLimiter({ limit: 5, windowMs: 60_000 });

    await handleGatewayWsFrame({
      frame: {
        type: "connect",
        id: "connect-1",
        protocolVersion: 1,
        client: {
          id: "client-a",
        },
      },
      state: connectionState,
      gateway,
      rateLimiter: limiter,
      send(frame) {
        sent.push(frame);
      },
    });

    await handleGatewayWsFrame({
      frame: {
        type: "req",
        id: "req-sub",
        method: "events.subscribe",
        params: {
          replayFromSeq: 0,
        },
      },
      state: connectionState,
      gateway,
      rateLimiter: limiter,
      send(frame) {
        sent.push(frame);
      },
    });

    const eventFrames = sent.filter((frame) => frame.type === "event");
    const responseFrames = sent.filter((frame) => frame.type === "res");

    expect(eventFrames.length).toBeGreaterThan(0);
    expect(eventFrames.some((frame) => frame.event === "gateway.client.connected")).toBe(true);
    expect(responseFrames.some((frame) => frame.id === "req-sub" && frame.ok === true)).toBe(true);
  });

  it("enforces per-client request rate limits", async () => {
    const sent = [];
    const connectionState = state();
    const gateway = new GatewayControlPlaneService();
    const limiter = new FixedWindowRateLimiter({ limit: 2, windowMs: 60_000 });

    await handleGatewayWsFrame({
      frame: {
        type: "connect",
        id: "connect-1",
        protocolVersion: 1,
        client: {
          id: "client-a",
        },
      },
      state: connectionState,
      gateway,
      rateLimiter: limiter,
      send(frame) {
        sent.push(frame);
      },
    });

    const requestFrame = {
      type: "req",
      method: "health.get",
      params: {},
    };

    await handleGatewayWsFrame({
      frame: { ...requestFrame, id: "req-1" },
      state: connectionState,
      gateway,
      rateLimiter: limiter,
      send(frame) {
        sent.push(frame);
      },
    });
    await handleGatewayWsFrame({
      frame: { ...requestFrame, id: "req-2" },
      state: connectionState,
      gateway,
      rateLimiter: limiter,
      send(frame) {
        sent.push(frame);
      },
    });
    await handleGatewayWsFrame({
      frame: { ...requestFrame, id: "req-3" },
      state: connectionState,
      gateway,
      rateLimiter: limiter,
      send(frame) {
        sent.push(frame);
      },
    });

    expect(sent[sent.length - 1]).toMatchObject({
      type: "error",
      id: "req-3",
      code: "RATE_LIMITED",
    });
  });
});
