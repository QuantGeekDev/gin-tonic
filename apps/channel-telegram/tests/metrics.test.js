import { describe, expect, it } from "@jest/globals";

import { TelegramPrometheusMetrics } from "../dist/telegram/metrics.js";

describe("TelegramPrometheusMetrics", () => {
  it("records enqueue/retry/sent/dead and renders text", async () => {
    const metrics = new TelegramPrometheusMetrics({ includeDefaultMetrics: false });

    metrics.observeEnqueue({ latencyMs: 8 });
    metrics.observeRetry({
      failureCode: "network",
      queueLatencyMs: 40,
      processLatencyMs: 10,
    });
    metrics.observeSent({
      queueLatencyMs: 60,
      processLatencyMs: 12,
    });
    metrics.observeDeadLetter({
      failureCode: "client",
      queueLatencyMs: 500,
      processLatencyMs: 25,
    });
    metrics.setSnapshot({
      queued: 3,
      processing: 1,
      retry: 2,
      dead: 4,
    });
    metrics.setDeadLetterOldestAgeSeconds(123);

    const text = await metrics.render();
    expect(text).toContain("jihn_telegram_outbox_enqueued_total");
    expect(text).toContain("jihn_telegram_outbox_deliveries_total");
    expect(text).toContain('outcome="retry",failure_code="network"');
    expect(text).toContain("jihn_telegram_outbox_dead_letter_oldest_age_seconds 123");
  });
});
