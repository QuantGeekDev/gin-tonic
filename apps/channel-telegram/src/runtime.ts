import {
  type HandleMessageResult,
  isGatewayError,
} from "@jihn/agent-core";
import type { PluginRuntime } from "@jihn/agent-core";
import { JihnGatewayClient } from "@jihn/gateway-client";
import type { TelegramChannelConfig } from "./config.js";
import type { TelegramTurnInput } from "./telegram/types.js";

export interface TelegramAgentRuntime {
  readonly pluginRuntime: PluginRuntime | null;
  runTurn(input: TelegramTurnInput): Promise<HandleMessageResult>;
  close(): Promise<void>;
}

export async function createTelegramAgentRuntime(
  config: TelegramChannelConfig,
): Promise<TelegramAgentRuntime> {
  const gateway = new JihnGatewayClient();
  await gateway.connect({
    url: process.env.JIHN_GATEWAY_URL ?? "ws://127.0.0.1:18789/ws",
    ...(process.env.JIHN_GATEWAY_TOKEN !== undefined
      ? { authToken: process.env.JIHN_GATEWAY_TOKEN }
      : {}),
    client: {
      id: "channel-telegram",
      name: "jihn-channel-telegram",
      version: "1.0.0",
      capabilities: ["agent.run"],
    },
  });

  return {
    pluginRuntime: null,
    async runTurn(input: TelegramTurnInput): Promise<HandleMessageResult> {
      return await gateway.request<HandleMessageResult>(
        "agent.run",
        {
          text: input.text,
          routing: input.routing,
          maxTurns: config.maxTurns,
          maxTokens: config.maxTokens,
        },
        { idempotencyKey: input.idempotencyKey },
      );
    },
    async close(): Promise<void> {
      await gateway.close();
    },
  };
}

export function toTelegramErrorText(error: unknown): string {
  if (isGatewayError(error)) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
