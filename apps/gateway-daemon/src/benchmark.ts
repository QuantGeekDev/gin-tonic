export interface BenchmarkRunRequest {
  scenario: string;
  samples?: number;
  warmup?: number;
  concurrency?: number;
  label?: string;
  payload?: unknown;
}

export interface BenchmarkSummary {
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

export interface BenchmarkScenarioDescriptor {
  id: string;
  description: string;
}

export interface BenchmarkScenario extends BenchmarkScenarioDescriptor {
  execute: (payload: unknown) => Promise<unknown>;
  defaultPayload?: unknown;
}

export interface BenchmarkErrorSample {
  index: number;
  message: string;
}

export interface BenchmarkRunResult {
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
  errors: BenchmarkErrorSample[];
}

export interface BenchmarkSnapshot {
  generatedAt: string;
  scenarios: BenchmarkScenarioDescriptor[];
  runs: BenchmarkRunResult[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.trunc(value as number);
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
}

function percentile(sortedValues: number[], pct: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }
  const rank = Math.ceil((pct / 100) * sortedValues.length) - 1;
  const clamped = Math.min(Math.max(rank, 0), sortedValues.length - 1);
  return sortedValues[clamped] ?? null;
}

function summarize(samples: number[], totalRequests: number, failedRequests: number, totalDurationMs: number): BenchmarkSummary {
  if (samples.length === 0) {
    return {
      totalRequests,
      successfulRequests: 0,
      failedRequests,
      totalDurationMs,
      throughputRps: totalDurationMs > 0 ? Number((totalRequests * 1000) / totalDurationMs) : 0,
      minMs: null,
      maxMs: null,
      avgMs: null,
      p50Ms: null,
      p90Ms: null,
      p95Ms: null,
      p99Ms: null,
    };
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const sum = sorted.reduce((accumulator, value) => accumulator + value, 0);

  return {
    totalRequests,
    successfulRequests: samples.length,
    failedRequests,
    totalDurationMs,
    throughputRps: totalDurationMs > 0 ? Number((totalRequests * 1000) / totalDurationMs) : 0,
    minMs: sorted[0] ?? null,
    maxMs: sorted[sorted.length - 1] ?? null,
    avgMs: Number(sum / sorted.length),
    p50Ms: percentile(sorted, 50),
    p90Ms: percentile(sorted, 90),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
  };
}

function durationMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

export class GatewayBenchmarkService {
  private readonly scenarios = new Map<string, BenchmarkScenario>();

  private readonly maxRuns: number;

  private readonly label: string;

  private readonly runs: BenchmarkRunResult[] = [];

  public constructor(params: {
    scenarios: BenchmarkScenario[];
    maxRuns?: number;
    label?: string;
  }) {
    this.maxRuns = clampInt(params.maxRuns, 100, 10, 2_000);
    this.label = (params.label ?? "gateway").trim() || "gateway";

    for (const scenario of params.scenarios) {
      this.scenarios.set(scenario.id, scenario);
    }
  }

  public describeScenarios(): BenchmarkScenarioDescriptor[] {
    return [...this.scenarios.values()].map((scenario) => ({
      id: scenario.id,
      description: scenario.description,
    }));
  }

  public async run(request: BenchmarkRunRequest): Promise<BenchmarkRunResult> {
    const scenario = this.scenarios.get(request.scenario);
    if (!scenario) {
      throw new Error(`Unknown benchmark scenario: ${request.scenario}`);
    }

    const samples = clampInt(request.samples, 100, 1, 10_000);
    const warmup = clampInt(request.warmup, 5, 0, 5_000);
    const concurrency = clampInt(request.concurrency, 1, 1, 256);
    const payload = request.payload ?? scenario.defaultPayload ?? {};
    const startedIso = nowIso();

    for (let index = 0; index < warmup; index += 1) {
      await scenario.execute(payload);
    }

    const sampleDurations: number[] = [];
    const errorSamples: BenchmarkErrorSample[] = [];
    let nextIndex = 0;
    let failures = 0;
    const measuredStart = process.hrtime.bigint();

    const worker = async (): Promise<void> => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= samples) {
          return;
        }

        const iterationStartedAt = process.hrtime.bigint();
        try {
          await scenario.execute(payload);
          sampleDurations.push(durationMs(iterationStartedAt));
        } catch (error) {
          failures += 1;
          if (errorSamples.length < 20) {
            errorSamples.push({
              index,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, samples) }, () => worker());
    await Promise.all(workers);
    const totalDurationMs = durationMs(measuredStart);

    const result: BenchmarkRunResult = {
      id: `bench_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      scenario: scenario.id,
      label: (request.label ?? this.label).trim() || this.label,
      startedAt: startedIso,
      completedAt: nowIso(),
      config: {
        samples,
        warmup,
        concurrency,
      },
      summary: summarize(sampleDurations, samples, failures, totalDurationMs),
      errors: errorSamples,
    };

    this.runs.unshift(result);
    if (this.runs.length > this.maxRuns) {
      this.runs.length = this.maxRuns;
    }

    return result;
  }

  public snapshot(): BenchmarkSnapshot {
    return {
      generatedAt: nowIso(),
      scenarios: this.describeScenarios(),
      runs: [...this.runs],
    };
  }

  public clear(): { cleared: number } {
    const cleared = this.runs.length;
    this.runs.length = 0;
    return { cleared };
  }
}
