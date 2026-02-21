import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
  type HistogramConfiguration,
} from "prom-client";

interface OutboundSnapshot {
  queued: number;
  processing: number;
  retry: number;
  dead: number;
}

function bucketsMs(): number[] {
  return [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000];
}

export class TelegramPrometheusMetrics {
  private readonly registry: Registry;

  private readonly enqueueTotal: Counter<string>;

  private readonly enqueueLatencyMs: Histogram<string>;

  private readonly deliveriesTotal: Counter<"outcome" | "failure_code">;

  private readonly deliveryLatencyMs: Histogram<"outcome">;

  private readonly processLatencyMs: Histogram<"outcome">;

  private readonly queueDepth: Gauge<string>;

  private readonly queueProcessing: Gauge<string>;

  private readonly queueRetryDepth: Gauge<string>;

  private readonly deadLetterDepth: Gauge<string>;

  private readonly deadLetterOldestAgeSeconds: Gauge<string>;

  public constructor(params: { includeDefaultMetrics?: boolean } = {}) {
    this.registry = new Registry();
    if (params.includeDefaultMetrics !== false) {
      collectDefaultMetrics({ register: this.registry });
    }

    this.enqueueTotal = new Counter({
      name: "jihn_telegram_outbox_enqueued_total",
      help: "Total outbound messages enqueued to Telegram outbox",
      registers: [this.registry],
    });

    this.enqueueLatencyMs = new Histogram({
      name: "jihn_telegram_outbox_enqueue_latency_ms",
      help: "Latency to persist a Telegram outbox enqueue operation",
      buckets: bucketsMs(),
      registers: [this.registry],
    } as HistogramConfiguration<string>);

    this.deliveriesTotal = new Counter({
      name: "jihn_telegram_outbox_deliveries_total",
      help: "Outbound delivery outcomes for Telegram outbox",
      labelNames: ["outcome", "failure_code"],
      registers: [this.registry],
    });

    this.deliveryLatencyMs = new Histogram({
      name: "jihn_telegram_outbox_delivery_latency_ms",
      help: "End-to-end outbox delivery latency from enqueue to terminal outcome",
      labelNames: ["outcome"],
      buckets: bucketsMs(),
      registers: [this.registry],
    } as HistogramConfiguration<"outcome">);

    this.processLatencyMs = new Histogram({
      name: "jihn_telegram_outbox_process_latency_ms",
      help: "Worker processing latency per outbox attempt",
      labelNames: ["outcome"],
      buckets: bucketsMs(),
      registers: [this.registry],
    } as HistogramConfiguration<"outcome">);

    this.queueDepth = new Gauge({
      name: "jihn_telegram_outbox_queue_depth",
      help: "Queued telegram outbox messages (pending + retry)",
      registers: [this.registry],
    });

    this.queueProcessing = new Gauge({
      name: "jihn_telegram_outbox_processing",
      help: "Currently processing telegram outbox messages",
      registers: [this.registry],
    });

    this.queueRetryDepth = new Gauge({
      name: "jihn_telegram_outbox_retry_depth",
      help: "Telegram outbox messages in retry state",
      registers: [this.registry],
    });

    this.deadLetterDepth = new Gauge({
      name: "jihn_telegram_outbox_dead_letter_depth",
      help: "Telegram outbox messages in dead-letter state",
      registers: [this.registry],
    });

    this.deadLetterOldestAgeSeconds = new Gauge({
      name: "jihn_telegram_outbox_dead_letter_oldest_age_seconds",
      help: "Age in seconds of the oldest current dead-letter telegram outbox message",
      registers: [this.registry],
    });
  }

  public observeEnqueue(params: { latencyMs: number }): void {
    this.enqueueTotal.inc(1);
    this.enqueueLatencyMs.observe(Math.max(0, params.latencyMs));
  }

  public observeRetry(params: { queueLatencyMs: number; processLatencyMs: number; failureCode: string }): void {
    this.deliveriesTotal.inc({ outcome: "retry", failure_code: params.failureCode }, 1);
    this.deliveryLatencyMs.observe({ outcome: "retry" }, Math.max(0, params.queueLatencyMs));
    this.processLatencyMs.observe({ outcome: "retry" }, Math.max(0, params.processLatencyMs));
  }

  public observeSent(params: { queueLatencyMs: number; processLatencyMs: number }): void {
    this.deliveriesTotal.inc({ outcome: "sent", failure_code: "none" }, 1);
    this.deliveryLatencyMs.observe({ outcome: "sent" }, Math.max(0, params.queueLatencyMs));
    this.processLatencyMs.observe({ outcome: "sent" }, Math.max(0, params.processLatencyMs));
  }

  public observeDeadLetter(params: { queueLatencyMs: number; processLatencyMs: number; failureCode: string }): void {
    this.deliveriesTotal.inc({ outcome: "dead", failure_code: params.failureCode }, 1);
    this.deliveryLatencyMs.observe({ outcome: "dead" }, Math.max(0, params.queueLatencyMs));
    this.processLatencyMs.observe({ outcome: "dead" }, Math.max(0, params.processLatencyMs));
  }

  public setSnapshot(snapshot: OutboundSnapshot): void {
    this.queueDepth.set(Math.max(0, snapshot.queued));
    this.queueProcessing.set(Math.max(0, snapshot.processing));
    this.queueRetryDepth.set(Math.max(0, snapshot.retry));
    this.deadLetterDepth.set(Math.max(0, snapshot.dead));
  }

  public setDeadLetterOldestAgeSeconds(seconds: number): void {
    this.deadLetterOldestAgeSeconds.set(Math.max(0, seconds));
  }

  public async render(): Promise<string> {
    return await this.registry.metrics();
  }
}
