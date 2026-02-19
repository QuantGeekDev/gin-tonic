import type { SessionScope } from "@jihn/agent-core";
import type { TelegramInboundMessage, TelegramTurnInput } from "./types.js";

export function buildTelegramPeerId(message: Pick<TelegramInboundMessage, "chatId" | "userId">): string {
  return `telegram:${message.chatId}:user:${message.userId}`;
}

export function buildTelegramTurnInput(params: {
  message: TelegramInboundMessage;
  agentId: string;
  sessionScope: SessionScope;
}): TelegramTurnInput {
  return {
    text: params.message.text,
    routing: {
      agentId: params.agentId,
      scope: params.sessionScope,
      channelId: "telegram",
      peerId: buildTelegramPeerId(params.message),
    },
    idempotencyKey: `telegram-update:${params.message.updateId}`,
  };
}
