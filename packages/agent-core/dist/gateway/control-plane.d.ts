import { type GatewayEvent, type GatewayEventSubscription } from "./events-bus.js";
import type { LaneQueueOptions, QueuePriority } from "./queue/types.js";
export interface GatewayConnectInput {
    clientId: string;
    authToken?: string;
    metadata?: {
        name?: string;
        version?: string;
        capabilities?: string[];
    };
}
export interface GatewayClientSession {
    clientId: string;
    connectedAt: string;
    metadata?: {
        name?: string;
        version?: string;
        capabilities?: string[];
    };
}
export interface GatewayControlPlaneOptions {
    authTokens?: string[];
    idempotencyTtlMs?: number;
    queue?: LaneQueueOptions;
    eventRetention?: number;
}
export interface GatewayRequestContext {
    clientId: string;
    requestId: string;
    method: string;
}
export interface GatewayMethodMap {
    "health.get": {
        params: Record<string, never>;
        result: {
            status: "ok";
            nowIso: string;
            queue: {
                queued: number;
                active: number;
            };
        };
    };
    "agent.run": {
        params: {
            sessionKey: string;
            text: string;
            priority?: QueuePriority;
            metadata?: Record<string, unknown>;
        };
        result: {
            sessionKey: string;
            output: string;
        };
    };
}
export declare class GatewayControlPlaneError extends Error {
    readonly code: string;
    readonly statusCode: number;
    readonly details?: Record<string, unknown>;
    constructor(params: {
        code: string;
        statusCode: number;
        message: string;
        details?: Record<string, unknown>;
    });
}
interface MethodHandler<TParams, TResult> {
    (params: TParams, context: GatewayRequestContext): Promise<TResult>;
}
type AgentRunHandler = MethodHandler<GatewayMethodMap["agent.run"]["params"], GatewayMethodMap["agent.run"]["result"]>;
export declare class GatewayControlPlaneService {
    private readonly authTokens;
    private readonly idempotencyTtlMs;
    private readonly queue;
    private readonly eventBus;
    private readonly sessions;
    private readonly idempotency;
    private agentRunHandler;
    constructor(options?: GatewayControlPlaneOptions);
    setAgentRunHandler(handler: AgentRunHandler): void;
    connect(input: GatewayConnectInput): GatewayClientSession;
    disconnect(clientId: string): void;
    subscribeToEvents(params: {
        replayFromSeq?: number;
        eventTypes?: string[];
        onEvent: (event: GatewayEvent) => void;
    }): GatewayEventSubscription;
    request<K extends keyof GatewayMethodMap>(params: {
        clientId: string;
        requestId: string;
        method: K;
        payload: GatewayMethodMap[K]["params"];
        idempotencyKey?: string;
    }): Promise<GatewayMethodMap[K]["result"]>;
    getQueueSnapshot(): import("./queue/types.js").LaneQueueSnapshot;
    getDeadLetters(): import("./queue/types.js").DeadLetterTask[];
    getConnectedClientCount(): number;
    private ensureConnected;
    private dispatchMethod;
    private gcIdempotency;
}
export {};
//# sourceMappingURL=control-plane.d.ts.map