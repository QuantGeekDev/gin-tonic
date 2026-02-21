import { describe, expect, it } from "@jest/globals";

import { GatewayPrometheusMetrics } from "../dist/metrics.js";

describe("GatewayPrometheusMetrics", () => {
  it("records request metrics and renders prometheus output", async () => {
    const metrics = new GatewayPrometheusMetrics({ includeDefaultMetrics: false });

    metrics.observeAudit({ method: "health.get", outcome: "ok", durationMs: 12 });
    metrics.observeAudit({ method: "agent.run", outcome: "error", durationMs: 45 });
    metrics.observeAudit({ method: "health.get", outcome: "rate_limited", durationMs: 5 });
    metrics.setGatewaySnapshot({
      connectedClients: 3,
      queueQueued: 2,
      queueActive: 1,
      queueDeadLetters: 4,
    });

    const output = await metrics.render();

    expect(output).toContain("jihn_gateway_ws_requests_total");
    expect(output).toContain('method="health.get",outcome="ok"');
    expect(output).toContain("jihn_gateway_ws_request_duration_ms");
    expect(output).toContain("jihn_gateway_ws_rate_limited_total");
    expect(output).toContain("jihn_gateway_connected_clients 3");
    expect(output).toContain("jihn_gateway_queue_dead_letters 4");
  });
});
