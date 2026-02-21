import { describe, expect, it } from "@jest/globals";
import { GatewayBenchmarkService } from "../dist/benchmark.js";

describe("GatewayBenchmarkService", () => {
  it("runs benchmark scenario and stores results in snapshot", async () => {
    let calls = 0;
    const service = new GatewayBenchmarkService({
      scenarios: [
        {
          id: "fast.path",
          description: "test scenario",
          async execute() {
            calls += 1;
          },
        },
      ],
      maxRuns: 5,
      label: "node",
    });

    const result = await service.run({
      scenario: "fast.path",
      samples: 10,
      warmup: 2,
      concurrency: 2,
    });
    const snapshot = service.snapshot();

    expect(calls).toBe(12);
    expect(result.scenario).toBe("fast.path");
    expect(result.summary.totalRequests).toBe(10);
    expect(result.summary.failedRequests).toBe(0);
    expect(result.summary.successfulRequests).toBe(10);
    expect(result.summary.p95Ms).not.toBeNull();
    expect(snapshot.runs).toHaveLength(1);
    expect(snapshot.scenarios.map((scenario) => scenario.id)).toContain("fast.path");
  });

  it("captures failures and supports clear", async () => {
    let callIndex = 0;
    const service = new GatewayBenchmarkService({
      scenarios: [
        {
          id: "unstable.path",
          description: "fails every other call",
          async execute() {
            callIndex += 1;
            if (callIndex % 2 === 0) {
              throw new Error("boom");
            }
          },
        },
      ],
      maxRuns: 5,
    });

    const result = await service.run({
      scenario: "unstable.path",
      samples: 8,
      warmup: 0,
      concurrency: 3,
    });

    expect(result.summary.totalRequests).toBe(8);
    expect(result.summary.failedRequests).toBe(4);
    expect(result.summary.successfulRequests).toBe(4);
    expect(result.errors.length).toBeGreaterThan(0);

    const cleared = service.clear();
    const snapshot = service.snapshot();
    expect(cleared.cleared).toBe(1);
    expect(snapshot.runs).toEqual([]);
  });
});
