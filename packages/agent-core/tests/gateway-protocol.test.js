import { describe, expect, it } from "@jest/globals";

import {
  parseGatewayInboundFrame,
  parseGatewayOutboundFrame,
} from "../dist/index.js";

describe("gateway protocol schema", () => {
  it("parses valid inbound connect frame", () => {
    const frame = parseGatewayInboundFrame({
      type: "connect",
      id: "1",
      protocolVersion: 1,
      auth: { token: "dev-token" },
      client: {
        id: "cli",
        name: "jihn-cli",
        version: "1.0.0",
        capabilities: ["agent.run"],
      },
    });

    expect(frame.type).toBe("connect");
    expect(frame.client.id).toBe("cli");
  });

  it("rejects malformed inbound frames", () => {
    expect(() =>
      parseGatewayInboundFrame({
        type: "req",
        method: "agent.run",
      }),
    ).toThrow();
  });

  it("parses valid outbound event frame", () => {
    const frame = parseGatewayOutboundFrame({
      type: "event",
      event: "agent.turn.completed",
      seq: 2,
      timestamp: new Date().toISOString(),
      payload: { sessionKey: "session:a" },
    });

    expect(frame.type).toBe("event");
    expect(frame.event).toBe("agent.turn.completed");
  });
});
