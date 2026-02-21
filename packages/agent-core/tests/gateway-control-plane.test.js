import { describe, expect, it } from "@jest/globals";

import {
  GatewayControlPlaneError,
  GatewayControlPlaneService,
} from "../dist/index.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("GatewayControlPlaneService", () => {
  it("enforces token auth on connect", () => {
    const gateway = new GatewayControlPlaneService({
      authTokens: ["secret"],
    });

    expect(() =>
      gateway.connect({
        clientId: "web",
        authToken: "wrong",
      }),
    ).toThrow(GatewayControlPlaneError);

    const session = gateway.connect({
      clientId: "web",
      authToken: "secret",
    });
    expect(session.clientId).toBe("web");
  });

  it("runs agent turns through per-session lane queue", async () => {
    const gateway = new GatewayControlPlaneService();
    gateway.connect({ clientId: "cli" });

    const order = [];
    gateway.setAgentRunHandler(async (params) => {
      order.push(`start:${params.text}`);
      await sleep(15);
      order.push(`end:${params.text}`);
      return {
        sessionKey: params.sessionKey,
        output: `ok:${params.text}`,
      };
    });

    const a = gateway.request({
      clientId: "cli",
      requestId: "r1",
      method: "agent.run",
      payload: {
        sessionKey: "session:1",
        text: "one",
      },
    });

    const b = gateway.request({
      clientId: "cli",
      requestId: "r2",
      method: "agent.run",
      payload: {
        sessionKey: "session:1",
        text: "two",
      },
    });

    await expect(a).resolves.toMatchObject({ output: "ok:one" });
    await expect(b).resolves.toMatchObject({ output: "ok:two" });
    expect(order).toEqual(["start:one", "end:one", "start:two", "end:two"]);
  });

  it("supports idempotency cache and detects conflicts", async () => {
    const gateway = new GatewayControlPlaneService();
    gateway.connect({ clientId: "cli" });

    let calls = 0;
    gateway.setAgentRunHandler(async (params) => {
      calls += 1;
      return {
        sessionKey: params.sessionKey,
        output: `ok:${params.text}`,
      };
    });

    const first = await gateway.request({
      clientId: "cli",
      requestId: "idempotent-1",
      method: "agent.run",
      idempotencyKey: "same",
      payload: {
        sessionKey: "session:1",
        text: "hello",
      },
    });

    const second = await gateway.request({
      clientId: "cli",
      requestId: "idempotent-2",
      method: "agent.run",
      idempotencyKey: "same",
      payload: {
        sessionKey: "session:1",
        text: "hello",
      },
    });

    expect(first).toEqual(second);
    expect(calls).toBe(1);

    await expect(
      gateway.request({
        clientId: "cli",
        requestId: "idempotent-3",
        method: "agent.run",
        idempotencyKey: "same",
        payload: {
          sessionKey: "session:1",
          text: "changed",
        },
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("emits real-time control plane events", async () => {
    const gateway = new GatewayControlPlaneService();
    gateway.connect({ clientId: "web" });

    gateway.setAgentRunHandler(async (params) => ({
      sessionKey: params.sessionKey,
      output: "done",
    }));

    const events = [];
    const subscription = gateway.subscribeToEvents({
      onEvent(event) {
        events.push(event.type);
      },
    });

    await gateway.request({
      clientId: "web",
      requestId: "event-1",
      method: "agent.run",
      payload: {
        sessionKey: "session:event",
        text: "hello",
      },
    });

    subscription.unsubscribe();

    expect(events).toEqual(
      expect.arrayContaining(["agent.turn.started", "agent.turn.completed"]),
    );
  });
});
