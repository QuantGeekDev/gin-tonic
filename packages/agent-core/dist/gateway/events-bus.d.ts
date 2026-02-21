export interface GatewayEvent<TPayload = unknown> {
    seq: number;
    timestamp: string;
    type: string;
    payload: TPayload;
}
export interface GatewayEventSubscription {
    id: string;
    unsubscribe: () => void;
}
export interface SubscribeGatewayEventsOptions {
    replayFromSeq?: number;
    eventTypes?: string[];
    onEvent: (event: GatewayEvent) => void;
}
export interface GatewayEventBusOptions {
    maxEvents?: number;
}
export declare class InMemoryGatewayEventBus {
    private readonly maxEvents;
    private readonly events;
    private readonly subscriptions;
    private seq;
    constructor(options?: GatewayEventBusOptions);
    getCurrentSeq(): number;
    emit<TPayload>(type: string, payload: TPayload): GatewayEvent<TPayload>;
    listSince(seq: number, limit?: number): GatewayEvent[];
    subscribe(options: SubscribeGatewayEventsOptions): GatewayEventSubscription;
}
//# sourceMappingURL=events-bus.d.ts.map