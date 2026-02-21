import { type GatewayEventFrame } from "@jihn/agent-core";
export interface GatewayClientConnectOptions {
    url: string;
    authToken?: string;
    client: {
        id: string;
        name?: string;
        version?: string;
        capabilities?: string[];
    };
    protocolVersion?: number;
    connectTimeoutMs?: number;
}
export interface GatewayRequestOptions {
    idempotencyKey?: string;
}
export interface GatewayEventSubscription {
    id: string;
    unsubscribe: () => Promise<void>;
}
export declare class JihnGatewayClient {
    private socket;
    private connected;
    private readonly pending;
    private readonly eventHandlers;
    connect(options: GatewayClientConnectOptions): Promise<void>;
    close(): Promise<void>;
    request<TResult = unknown>(method: string, payload: unknown, options?: GatewayRequestOptions): Promise<TResult>;
    subscribeEvents(params: {
        replayFromSeq?: number;
        eventTypes?: string[];
        onEvent: (event: GatewayEventFrame) => void;
    }): Promise<GatewayEventSubscription>;
    private ensureConnected;
    private handleFrame;
}
//# sourceMappingURL=index.d.ts.map