import { describe, expect, it } from "@jest/globals";

import { JihnGatewayClient } from "../dist/index.js";

describe("JihnGatewayClient", () => {
  it("fails requests when disconnected", async () => {
    const client = new JihnGatewayClient();
    await expect(client.request("health.get", {})).rejects.toThrow(
      "gateway client is not connected",
    );
  });

  it("resolves pending requests from success responses", async () => {
    const client = new JihnGatewayClient();

    const pending = new Promise((resolve, reject) => {
      client.pending.set("req-1", { resolve, reject });
    });

    client.handleFrame({
      type: "res",
      id: "req-1",
      ok: true,
      result: { status: "ok" },
    });

    await expect(pending).resolves.toEqual({ status: "ok" });
  });

  it("dispatches outbound event frames to handlers", () => {
    const client = new JihnGatewayClient();
    const events = [];

    const handler = (event) => {
      events.push(event.event);
    };
    client.eventHandlers.add(handler);

    client.handleFrame({
      type: "event",
      event: "agent.turn.completed",
      seq: 2,
      timestamp: new Date().toISOString(),
      payload: { ok: true },
    });

    expect(events).toEqual(["agent.turn.completed"]);
  });
});
