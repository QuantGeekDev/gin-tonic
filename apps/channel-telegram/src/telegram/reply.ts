import type { Api, RawApi } from "grammy";
import type { TelegramInboundMessage } from "./types.js";

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export interface TelegramReplyOptions {
  messageThreadId?: number;
  replyToMessageId?: number;
}

export function splitTelegramText(text: string): string[] {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return ["(empty response)"];
  }

  if (normalized.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
    return [normalized];
  }

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
    let cut = remaining.lastIndexOf("\n", TELEGRAM_MAX_MESSAGE_LENGTH);
    if (cut < TELEGRAM_MAX_MESSAGE_LENGTH * 0.6) {
      cut = remaining.lastIndexOf(" ", TELEGRAM_MAX_MESSAGE_LENGTH);
    }
    if (cut < TELEGRAM_MAX_MESSAGE_LENGTH * 0.4) {
      cut = TELEGRAM_MAX_MESSAGE_LENGTH;
    }

    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

export function buildTelegramReplyOptions(params: {
  message: TelegramInboundMessage;
  replyToIncomingByDefault: boolean;
}): TelegramReplyOptions {
  const { message } = params;
  const shouldReplyToMessage =
    params.replyToIncomingByDefault || !message.isDirectMessage || message.isTopicMessage;

  return {
    ...(message.messageThreadId !== undefined
      ? { messageThreadId: message.messageThreadId }
      : {}),
    ...(shouldReplyToMessage ? { replyToMessageId: message.messageId } : {}),
  };
}

export async function sendTelegramReply(params: {
  api: Api<RawApi>;
  chatId: number;
  text: string;
  options: TelegramReplyOptions;
}): Promise<void> {
  const chunks = splitTelegramText(params.text);
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index] as string;
    await params.api.sendMessage(params.chatId, chunk, {
      ...(params.options.messageThreadId !== undefined
        ? { message_thread_id: params.options.messageThreadId }
        : {}),
      ...(index === 0 && params.options.replyToMessageId !== undefined
        ? {
            reply_parameters: {
              message_id: params.options.replyToMessageId,
            },
          }
        : {}),
    });
  }
}
