import { describe, expect, it } from "@jest/globals";

import { InMemoryGatewayEventBus } from "../dist/index.js";

describe("InMemoryGatewayEventBus", () => {
  it("assigns monotonic sequence numbers", () => {
    const bus = new InMemoryGatewayEventBus();
    const one = bus.emit("agent.turn.started", { id: 1 });
    const two = bus.emit("agent.turn.completed", { id: 1 });

    expect(one.seq).toBe(1);
    expect(two.seq).toBe(2);
    expect(bus.getCurrentSeq()).toBe(2);
  });

  it("replays events from cursor for new subscribers", () => {
    const bus = new InMemoryGatewayEventBus();
    bus.emit("a", { v: 1 });
    bus.emit("b", { v: 2 });

    const seen = [];
    const subscription = bus.subscribe({
      replayFromSeq: 1,
      onEvent(event) {
        seen.push(event.type);
      },
    });

    bus.emit("c", { v: 3 });
    subscription.unsubscribe();

    expect(seen).toEqual(["b", "c"]);
  });

  it("enforces retention cap", () => {
    const bus = new InMemoryGatewayEventBus({ maxEvents: 2 });
    bus.emit("a", {});
    bus.emit("b", {});
    bus.emit("c", {});

    const events = bus.listSince(0, 10);
    expect(events.map((event) => event.type)).toEqual(["b", "c"]);
  });
});
