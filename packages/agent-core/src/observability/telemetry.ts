import { metrics, trace } from "@opentelemetry/api";

const TRACER_NAME = "jihn.agent-core";
const METER_NAME = "jihn.agent-core";

const tracer = trace.getTracer(TRACER_NAME);
const meter = metrics.getMeter(METER_NAME);

const gatewayTurnCounter = meter.createCounter("jihn_gateway_turns_total", {
  description: "Total gateway turns processed",
});

const gatewayErrorCounter = meter.createCounter("jihn_gateway_errors_total", {
  description: "Total gateway request errors",
});

const gatewayDurationMs = meter.createHistogram("jihn_gateway_duration_ms", {
  description: "Gateway request duration in milliseconds",
  unit: "ms",
});

export function getJihnTracer() {
  return tracer;
}

export function recordGatewayTurn(params: {
  durationMs: number;
  agentId: string;
  scope: string;
  channelId: string;
  success: boolean;
  idempotencyHit: boolean;
}): void {
  const attributes = {
    "jihn.agent_id": params.agentId,
    "jihn.scope": params.scope,
    "jihn.channel_id": params.channelId,
    "jihn.success": params.success,
    "jihn.idempotency_hit": params.idempotencyHit,
  };
  gatewayTurnCounter.add(1, attributes);
  gatewayDurationMs.record(Math.max(0, params.durationMs), attributes);
  if (!params.success) {
    gatewayErrorCounter.add(1, attributes);
  }
}
