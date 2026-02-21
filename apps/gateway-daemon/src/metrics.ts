import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
  type HistogramConfiguration,
} from "prom-client";

export interface GatewayAuditMetricInput {
  method: string;
  outcome: "ok" | "error" | "rate_limited";
  durationMs: number;
}

function metricBuckets(): number[] {
  return [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
}

export class GatewayPrometheusMetrics {
  private readonly registry: Registry;

  private readonly requestTotal: Counter<"method" | "outcome">;

  private readonly requestDurationMs: Histogram<"method" | "outcome">;

  private readonly rateLimitedTotal: Counter<"method">;

  private readonly connectedClients: Gauge<string>;

  private readonly queueQueued: Gauge<string>;

  private readonly queueActive: Gauge<string>;

  private readonly queueDeadLetters: Gauge<string>;

  public constructor(params: { includeDefaultMetrics?: boolean } = {}) {
    this.registry = new Registry();

    if (params.includeDefaultMetrics !== false) {
      collectDefaultMetrics({ register: this.registry });
    }

    this.requestTotal = new Counter({
      name: "jihn_gateway_ws_requests_total",
      help: "Total gateway websocket requests by method/outcome",
      labelNames: ["method", "outcome"],
      registers: [this.registry],
    });

    this.requestDurationMs = new Histogram({
      name: "jihn_gateway_ws_request_duration_ms",
      help: "Gateway websocket request duration in milliseconds",
      labelNames: ["method", "outcome"],
      buckets: metricBuckets(),
      registers: [this.registry],
    } as HistogramConfiguration<"method" | "outcome">);

    this.rateLimitedTotal = new Counter({
      name: "jihn_gateway_ws_rate_limited_total",
      help: "Total websocket requests rejected by gateway rate limiting",
      labelNames: ["method"],
      registers: [this.registry],
    });

    this.connectedClients = new Gauge({
      name: "jihn_gateway_connected_clients",
      help: "Connected websocket clients",
      registers: [this.registry],
    });

    this.queueQueued = new Gauge({
      name: "jihn_gateway_queue_queued",
      help: "Gateway lane queue queued task count",
      registers: [this.registry],
    });

    this.queueActive = new Gauge({
      name: "jihn_gateway_queue_active",
      help: "Gateway lane queue active task count",
      registers: [this.registry],
    });

    this.queueDeadLetters = new Gauge({
      name: "jihn_gateway_queue_dead_letters",
      help: "Gateway lane queue dead-letter task count",
      registers: [this.registry],
    });
  }

  public observeAudit(input: GatewayAuditMetricInput): void {
    const method = input.method.trim().length > 0 ? input.method.trim() : "unknown";
    this.requestTotal.inc({ method, outcome: input.outcome }, 1);
    this.requestDurationMs.observe({ method, outcome: input.outcome }, Math.max(0, input.durationMs));
    if (input.outcome === "rate_limited") {
      this.rateLimitedTotal.inc({ method }, 1);
    }
  }

  public setGatewaySnapshot(snapshot: {
    connectedClients: number;
    queueQueued: number;
    queueActive: number;
    queueDeadLetters: number;
  }): void {
    this.connectedClients.set(Math.max(0, snapshot.connectedClients));
    this.queueQueued.set(Math.max(0, snapshot.queueQueued));
    this.queueActive.set(Math.max(0, snapshot.queueActive));
    this.queueDeadLetters.set(Math.max(0, snapshot.queueDeadLetters));
  }

  public async render(): Promise<string> {
    return await this.registry.metrics();
  }
}
