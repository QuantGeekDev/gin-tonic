import { JihnGatewayClient } from "@jihn/gateway-client";

interface BenchmarkScenario {
  id: string;
  description: string;
}

interface BenchmarkSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalDurationMs: number;
  throughputRps: number;
  minMs: number | null;
  maxMs: number | null;
  avgMs: number | null;
  p50Ms: number | null;
  p90Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

interface BenchmarkRunResult {
  id: string;
  scenario: string;
  label: string;
  startedAt: string;
  completedAt: string;
  config: {
    samples: number;
    warmup: number;
    concurrency: number;
  };
  summary: BenchmarkSummary;
  errors: Array<{
    index: number;
    message: string;
  }>;
}

interface BenchmarkSnapshot {
  generatedAt: string;
  scenarios: BenchmarkScenario[];
  runs: BenchmarkRunResult[];
}

interface GatewayClientLike {
  connect(options: {
    url: string;
    authToken?: string;
    client: {
      id: string;
      name?: string;
      version?: string;
      capabilities?: string[];
    };
  }): Promise<void>;
  request<TResult = unknown>(
    method: string,
    payload: unknown,
    options?: { idempotencyKey?: string },
  ): Promise<TResult>;
  close(): Promise<void>;
}

interface BenchmarkCommandDeps {
  createClient: () => GatewayClientLike;
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
}

function readFlag(args: string[], names: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg || !names.includes(arg)) {
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      return undefined;
    }
    return value;
  }
  return undefined;
}

function hasFlag(args: string[], names: string[]): boolean {
  return args.some((arg) => names.includes(arg));
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected integer but received "${value}"`);
  }
  return parsed;
}

function requireGatewayUrl(env: NodeJS.ProcessEnv): string {
  const value = env.JIHN_GATEWAY_URL?.trim();
  if (!value) {
    throw new Error("benchmark commands require JIHN_GATEWAY_URL");
  }
  return value;
}

function defaultDeps(): BenchmarkCommandDeps {
  return {
    createClient: () => new JihnGatewayClient(),
    env: process.env,
    log: (line: string) => console.log(line),
  };
}

export function printBenchmarkUsage(log: (line: string) => void = (line) => console.log(line)): void {
  log("Benchmark commands:");
  log("  jihn benchmark list");
  log("  jihn benchmark scenarios");
  log("  jihn benchmark run --scenario <SCENARIO_ID> [--samples <N>] [--warmup <N>] [--concurrency <N>] [--label <NAME>] [--payload-json <JSON>]");
  log("  jihn benchmark clear");
}

async function withGatewayClient<T>(
  deps: BenchmarkCommandDeps,
  task: (client: GatewayClientLike) => Promise<T>,
): Promise<T> {
  const gatewayUrl = requireGatewayUrl(deps.env);
  const client = deps.createClient();
  await client.connect({
    url: gatewayUrl,
    ...(deps.env.JIHN_GATEWAY_TOKEN !== undefined
      ? { authToken: deps.env.JIHN_GATEWAY_TOKEN }
      : {}),
    client: {
      id: "cli-benchmark",
      name: "jihn-cli",
      version: "1.0.0",
      capabilities: ["benchmark"],
    },
  });

  try {
    return await task(client);
  } finally {
    await client.close();
  }
}

function printSummary(summary: BenchmarkSummary, log: (line: string) => void): void {
  log(`total=${summary.totalRequests} ok=${summary.successfulRequests} fail=${summary.failedRequests}`);
  log(
    `duration_ms=${summary.totalDurationMs.toFixed(2)} throughput_rps=${summary.throughputRps.toFixed(2)}`,
  );
  log(
    `latency_ms min=${summary.minMs?.toFixed(2) ?? "n/a"} avg=${summary.avgMs?.toFixed(2) ?? "n/a"} p50=${summary.p50Ms?.toFixed(2) ?? "n/a"} p95=${summary.p95Ms?.toFixed(2) ?? "n/a"} p99=${summary.p99Ms?.toFixed(2) ?? "n/a"} max=${summary.maxMs?.toFixed(2) ?? "n/a"}`,
  );
}

export async function runBenchmarkCliCommand(
  args: string[],
  providedDeps?: Partial<BenchmarkCommandDeps>,
): Promise<boolean> {
  if (args[0] !== "benchmark") {
    return false;
  }

  const deps: BenchmarkCommandDeps = {
    ...defaultDeps(),
    ...providedDeps,
  };

  const subcommand = args[1] ?? "help";
  if (subcommand === "help" || hasFlag(args, ["--help", "-h"])) {
    printBenchmarkUsage(deps.log);
    return true;
  }

  if (subcommand === "list") {
    const snapshot = await withGatewayClient(deps, async (client) => {
      return await client.request<BenchmarkSnapshot>("benchmark.snapshot", {});
    });
    deps.log(`generated_at=${snapshot.generatedAt}`);
    deps.log(`stored_runs=${snapshot.runs.length}`);
    if (snapshot.runs.length === 0) {
      deps.log("No benchmark runs.");
      return true;
    }
    for (const run of snapshot.runs) {
      deps.log(
        [
          `${run.id}`,
          `scenario=${run.scenario}`,
          `label=${run.label}`,
          `samples=${run.config.samples}`,
          `concurrency=${run.config.concurrency}`,
          `p95_ms=${run.summary.p95Ms?.toFixed(2) ?? "n/a"}`,
          `throughput_rps=${run.summary.throughputRps.toFixed(2)}`,
        ].join(" | "),
      );
    }
    return true;
  }

  if (subcommand === "scenarios") {
    const snapshot = await withGatewayClient(deps, async (client) => {
      return await client.request<BenchmarkSnapshot>("benchmark.snapshot", {});
    });
    if (snapshot.scenarios.length === 0) {
      deps.log("No benchmark scenarios available.");
      return true;
    }
    for (const scenario of snapshot.scenarios) {
      deps.log(`${scenario.id} | ${scenario.description}`);
    }
    return true;
  }

  if (subcommand === "clear") {
    const result = await withGatewayClient(deps, async (client) => {
      return await client.request<{ cleared: number }>("benchmark.clear", {});
    });
    deps.log(`cleared_runs=${result.cleared}`);
    return true;
  }

  if (subcommand === "run") {
    const scenario = readFlag(args, ["--scenario"]);
    if (!scenario) {
      throw new Error("benchmark run requires --scenario");
    }
    const samples = parseOptionalInt(readFlag(args, ["--samples"]));
    const warmup = parseOptionalInt(readFlag(args, ["--warmup"]));
    const concurrency = parseOptionalInt(readFlag(args, ["--concurrency"]));
    const label = readFlag(args, ["--label"]);
    const payloadJson = readFlag(args, ["--payload-json"]);
    const payload =
      payloadJson !== undefined ? (JSON.parse(payloadJson) as unknown) : undefined;

    const result = await withGatewayClient(deps, async (client) => {
      return await client.request<BenchmarkRunResult>("benchmark.run", {
        scenario,
        ...(samples !== undefined ? { samples } : {}),
        ...(warmup !== undefined ? { warmup } : {}),
        ...(concurrency !== undefined ? { concurrency } : {}),
        ...(label !== undefined ? { label } : {}),
        ...(payload !== undefined ? { payload } : {}),
      });
    });
    deps.log(`benchmark_id=${result.id}`);
    deps.log(`scenario=${result.scenario}`);
    deps.log(`label=${result.label}`);
    deps.log(
      `config samples=${result.config.samples} warmup=${result.config.warmup} concurrency=${result.config.concurrency}`,
    );
    printSummary(result.summary, deps.log);
    if (result.errors.length > 0) {
      deps.log(`errors=${result.errors.length}`);
      for (const sample of result.errors) {
        deps.log(`error[index=${sample.index}] ${sample.message}`);
      }
    }
    return true;
  }

  printBenchmarkUsage(deps.log);
  return true;
}
