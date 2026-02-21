import { describe, expect, it } from "@jest/globals";
import { runBenchmarkCliCommand } from "../dist/commands/benchmark.js";

function createMockClient(params) {
  const state = {
    connectCalls: [],
    requestCalls: [],
    closed: false,
  };

  const client = {
    async connect(options) {
      state.connectCalls.push(options);
    },
    async request(method, payload) {
      state.requestCalls.push({ method, payload });
      if (params?.request) {
        return await params.request(method, payload);
      }
      return {};
    },
    async close() {
      state.closed = true;
    },
  };

  return { client, state };
}

describe("runBenchmarkCliCommand", () => {
  it("returns false for non-benchmark commands", async () => {
    const logs = [];
    const { client } = createMockClient();

    const handled = await runBenchmarkCliCommand(["settings", "list"], {
      createClient: () => client,
      env: { JIHN_GATEWAY_URL: "ws://localhost:18789/ws" },
      log: (line) => logs.push(line),
    });

    expect(handled).toBe(false);
    expect(logs).toEqual([]);
  });

  it("runs benchmark scenario through gateway", async () => {
    const logs = [];
    const { client, state } = createMockClient({
      async request(method, payload) {
        expect(method).toBe("benchmark.run");
        expect(payload).toMatchObject({
          scenario: "health.get",
          samples: 20,
          warmup: 2,
          concurrency: 4,
          label: "node",
        });
        return {
          id: "bench_123",
          scenario: "health.get",
          label: "node",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:01.000Z",
          config: {
            samples: 20,
            warmup: 2,
            concurrency: 4,
          },
          summary: {
            totalRequests: 20,
            successfulRequests: 20,
            failedRequests: 0,
            totalDurationMs: 1000,
            throughputRps: 20,
            minMs: 1,
            maxMs: 8,
            avgMs: 3,
            p50Ms: 3,
            p90Ms: 6,
            p95Ms: 7,
            p99Ms: 8,
          },
          errors: [],
        };
      },
    });

    await runBenchmarkCliCommand(
      [
        "benchmark",
        "run",
        "--scenario",
        "health.get",
        "--samples",
        "20",
        "--warmup",
        "2",
        "--concurrency",
        "4",
        "--label",
        "node",
      ],
      {
        createClient: () => client,
        env: { JIHN_GATEWAY_URL: "ws://localhost:18789/ws" },
        log: (line) => logs.push(line),
      },
    );

    expect(state.connectCalls).toHaveLength(1);
    expect(state.closed).toBe(true);
    expect(logs.join("\n")).toContain("benchmark_id=bench_123");
    expect(logs.join("\n")).toContain("throughput_rps=20.00");
  });

  it("lists scenarios from benchmark snapshot", async () => {
    const logs = [];
    const { client } = createMockClient({
      async request(method) {
        expect(method).toBe("benchmark.snapshot");
        return {
          generatedAt: "2026-01-01T00:00:00.000Z",
          scenarios: [
            {
              id: "health.get",
              description: "health path",
            },
            {
              id: "agent.run.small",
              description: "small turn",
            },
          ],
          runs: [],
        };
      },
    });

    await runBenchmarkCliCommand(["benchmark", "scenarios"], {
      createClient: () => client,
      env: { JIHN_GATEWAY_URL: "ws://localhost:18789/ws" },
      log: (line) => logs.push(line),
    });

    expect(logs).toEqual([
      "health.get | health path",
      "agent.run.small | small turn",
    ]);
  });
});
