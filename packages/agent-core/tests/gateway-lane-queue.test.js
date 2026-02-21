import { describe, expect, it } from "@jest/globals";

import { InMemoryLaneQueue } from "../dist/index.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("InMemoryLaneQueue", () => {
  it("serializes tasks within the same lane", async () => {
    const queue = new InMemoryLaneQueue({
      maxGlobalConcurrency: 4,
      defaultLaneConcurrency: 1,
    });

    const trace = [];
    const first = queue.enqueue({ lane: "session:a" }, async () => {
      trace.push("first:start");
      await sleep(20);
      trace.push("first:end");
      return "first";
    });
    const second = queue.enqueue({ lane: "session:a" }, async () => {
      trace.push("second:start");
      await sleep(5);
      trace.push("second:end");
      return "second";
    });

    await expect(first.result).resolves.toBe("first");
    await expect(second.result).resolves.toBe("second");
    expect(trace).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("supports parallel execution across different lanes", async () => {
    const queue = new InMemoryLaneQueue({
      maxGlobalConcurrency: 2,
      defaultLaneConcurrency: 1,
    });

    let active = 0;
    let maxSeen = 0;

    const run = (lane, waitMs) =>
      queue.enqueue({ lane }, async () => {
        active += 1;
        maxSeen = Math.max(maxSeen, active);
        await sleep(waitMs);
        active -= 1;
        return lane;
      }).result;

    await Promise.all([run("session:a", 30), run("session:b", 30), run("session:c", 30)]);
    expect(maxSeen).toBe(2);
  });

  it("retries failed tasks and records dead letters after max attempts", async () => {
    const queue = new InMemoryLaneQueue({
      defaultRetry: {
        maxAttempts: 2,
        backoffMs: 1,
      },
    });

    let attempts = 0;
    const task = queue.enqueue(
      {
        lane: "session:failure",
      },
      async () => {
        attempts += 1;
        throw new Error("boom");
      },
    );

    await expect(task.result).rejects.toThrow("boom");
    expect(attempts).toBe(2);

    const deadLetters = queue.listDeadLetters();
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]).toMatchObject({
      lane: "session:failure",
      attempts: 2,
      error: "boom",
    });
  });

  it("prioritizes interactive work before background work", async () => {
    const queue = new InMemoryLaneQueue({
      maxGlobalConcurrency: 1,
    });

    const order = [];

    queue.enqueue({ lane: "session:p" }, async () => {
      order.push("blocking");
      await sleep(20);
      return "ok";
    });

    const low = queue.enqueue(
      { lane: "session:p", priority: "background" },
      async () => {
        order.push("background");
        return "background";
      },
    );

    const high = queue.enqueue(
      { lane: "session:p", priority: "interactive" },
      async () => {
        order.push("interactive");
        return "interactive";
      },
    );

    await high.result;
    await low.result;
    expect(order).toEqual(["blocking", "interactive", "background"]);
  });
});
