import type { SessionScope } from "@jihn/agent-core";

export interface TelegramInboundMessage {
  updateId: number;
  messageId: number;
  chatId: number;
  userId: number;
  text: string;
  isDirectMessage: boolean;
  isTopicMessage: boolean;
  messageThreadId?: number;
}

export interface TelegramTurnRouting {
  agentId: string;
  scope: SessionScope;
  channelId: "telegram";
  peerId: string;
}

export interface TelegramTurnInput {
  text: string;
  routing: TelegramTurnRouting;
  idempotencyKey: string;
}
