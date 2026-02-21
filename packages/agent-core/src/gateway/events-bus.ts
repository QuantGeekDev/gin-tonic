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

const DEFAULT_MAX_EVENTS = 2_000;

function nowIso(): string {
  return new Date().toISOString();
}

interface SubscriptionRecord {
  eventTypes: Set<string> | null;
  onEvent: (event: GatewayEvent) => void;
}

export class InMemoryGatewayEventBus {
  private readonly maxEvents: number;

  private readonly events: GatewayEvent[] = [];

  private readonly subscriptions = new Map<string, SubscriptionRecord>();

  private seq = 0;

  public constructor(options: GatewayEventBusOptions = {}) {
    const requested = options.maxEvents ?? DEFAULT_MAX_EVENTS;
    this.maxEvents = Number.isFinite(requested) && requested > 0
      ? Math.floor(requested)
      : DEFAULT_MAX_EVENTS;
  }

  public getCurrentSeq(): number {
    return this.seq;
  }

  public emit<TPayload>(type: string, payload: TPayload): GatewayEvent<TPayload> {
    const event: GatewayEvent<TPayload> = {
      seq: this.seq + 1,
      timestamp: nowIso(),
      type,
      payload,
    };
    this.seq = event.seq;
    this.events.push(event);

    if (this.events.length > this.maxEvents) {
      const removeCount = this.events.length - this.maxEvents;
      this.events.splice(0, removeCount);
    }

    for (const subscription of this.subscriptions.values()) {
      if (subscription.eventTypes !== null && !subscription.eventTypes.has(event.type)) {
        continue;
      }
      subscription.onEvent(event);
    }

    return event;
  }

  public listSince(seq: number, limit = 200): GatewayEvent[] {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 200;
    if (safeLimit <= 0) {
      return [];
    }

    const startIndex = this.events.findIndex((event) => event.seq > seq);
    if (startIndex === -1) {
      return [];
    }
    return this.events.slice(startIndex, startIndex + safeLimit);
  }

  public subscribe(options: SubscribeGatewayEventsOptions): GatewayEventSubscription {
    const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const eventTypes =
      options.eventTypes !== undefined && options.eventTypes.length > 0
        ? new Set(options.eventTypes)
        : null;

    if (options.replayFromSeq !== undefined) {
      const replay = this.listSince(options.replayFromSeq);
      for (const event of replay) {
        if (eventTypes !== null && !eventTypes.has(event.type)) {
          continue;
        }
        options.onEvent(event);
      }
    }

    this.subscriptions.set(id, {
      eventTypes,
      onEvent: options.onEvent,
    });

    return {
      id,
      unsubscribe: () => {
        this.subscriptions.delete(id);
      },
    };
  }
}
