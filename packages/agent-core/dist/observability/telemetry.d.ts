export declare function getJihnTracer(): import("@opentelemetry/api").Tracer;
export declare function recordGatewayTurn(params: {
    durationMs: number;
    agentId: string;
    scope: string;
    channelId: string;
    success: boolean;
    idempotencyHit: boolean;
}): void;
//# sourceMappingURL=telemetry.d.ts.map