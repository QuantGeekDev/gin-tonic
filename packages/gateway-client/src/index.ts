import WebSocket from "ws";
import {
  parseGatewayOutboundFrame,
  type GatewayEventFrame,
  type GatewayOutboundFrame,
} from "@jihn/agent-core";

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

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(String(value));
}

export class JihnGatewayClient {
  private socket: WebSocket | null = null;

  private connected = false;

  private readonly pending = new Map<string, PendingRequest>();

  private readonly eventHandlers = new Set<(event: GatewayEventFrame) => void>();

  public async connect(options: GatewayClientConnectOptions): Promise<void> {
    if (this.socket) {
      await this.close();
    }

    const protocolVersion = options.protocolVersion ?? 1;
    const timeoutMs = options.connectTimeoutMs ?? 5_000;

    const socket = new WebSocket(options.url);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Gateway connect timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.once("open", () => {
        const connectFrame = {
          type: "connect",
          id: randomId("connect"),
          protocolVersion,
          ...(options.authToken ? { auth: { token: options.authToken } } : {}),
          client: options.client,
        };
        socket.send(JSON.stringify(connectFrame));
      });

      socket.on("message", (rawData) => {
        try {
          const data = rawData.toString("utf8");
          const frame = parseGatewayOutboundFrame(JSON.parse(data));
          if (frame.type === "res" && frame.ok === true && frame.id.startsWith("connect_")) {
            this.connected = true;
            clearTimeout(timeout);
            resolve();
            return;
          }
          this.handleFrame(frame);
        } catch (error) {
          clearTimeout(timeout);
          reject(toError(error));
        }
      });

      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(toError(error));
      });

      socket.once("close", () => {
        this.connected = false;
      });
    });
  }

  public async close(): Promise<void> {
    const socket = this.socket;
    if (!socket) {
      return;
    }

    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
      socket.close();
    });

    this.socket = null;
    this.connected = false;
    for (const pending of this.pending.values()) {
      pending.reject(new Error("gateway connection closed"));
    }
    this.pending.clear();
  }

  public async request<TResult = unknown>(
    method: string,
    payload: unknown,
    options: GatewayRequestOptions = {},
  ): Promise<TResult> {
    this.ensureConnected();
    const socket = this.socket as WebSocket;

    const requestId = randomId("req");
    const frame = {
      type: "req",
      id: requestId,
      method,
      params: payload,
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    };

    const result = new Promise<TResult>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as TResult),
        reject,
      });
    });

    socket.send(JSON.stringify(frame));
    return await result;
  }

  public async subscribeEvents(params: {
    replayFromSeq?: number;
    eventTypes?: string[];
    onEvent: (event: GatewayEventFrame) => void;
  }): Promise<GatewayEventSubscription> {
    this.eventHandlers.add(params.onEvent);
    const response = await this.request<{ subscriptionId: string }>("events.subscribe", {
      ...(params.replayFromSeq !== undefined ? { replayFromSeq: params.replayFromSeq } : {}),
      ...(params.eventTypes !== undefined ? { eventTypes: params.eventTypes } : {}),
    });

    return {
      id: response.subscriptionId,
      unsubscribe: async () => {
        this.eventHandlers.delete(params.onEvent);
        await this.request("events.unsubscribe", {
          subscriptionId: response.subscriptionId,
        });
      },
    };
  }

  private ensureConnected(): void {
    if (!this.socket || !this.connected) {
      throw new Error("gateway client is not connected");
    }
  }

  private handleFrame(frame: GatewayOutboundFrame): void {
    if (frame.type === "event") {
      for (const handler of this.eventHandlers) {
        handler(frame);
      }
      return;
    }

    if (frame.type === "res") {
      const pending = this.pending.get(frame.id);
      if (!pending) {
        return;
      }
      this.pending.delete(frame.id);

      if (frame.ok === true) {
        pending.resolve(frame.result);
      } else {
        pending.reject(new Error(`${frame.error.code}: ${frame.error.message}`));
      }
      return;
    }

    if (frame.type === "error") {
      const error = new Error(`${frame.code}: ${frame.message}`);
      if (frame.id) {
        const pending = this.pending.get(frame.id);
        if (pending) {
          this.pending.delete(frame.id);
          pending.reject(error);
          return;
        }
      }
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
    }
  }
}
