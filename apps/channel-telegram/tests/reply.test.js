import { describe, expect, it, jest } from "@jest/globals";

import {
  buildTelegramReplyOptions,
  sendTelegramVoiceReply,
  splitTelegramText,
} from "../dist/telegram/reply.js";

describe("telegram reply helpers", () => {
  it("splits oversized text into chunks", () => {
    const longText = "x".repeat(9000);
    const chunks = splitTelegramText(longText);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.length <= 4096)).toBe(true);
  });

  it("adds reply metadata for incoming message", () => {
    const options = buildTelegramReplyOptions({
      message: {
        updateId: 1,
        messageId: 101,
        chatId: 9,
        userId: 3,
        text: "test",
        isDirectMessage: false,
        isTopicMessage: true,
        messageThreadId: 55,
      },
      replyToIncomingByDefault: false,
    });

    expect(options.replyToMessageId).toBe(101);
    expect(options.messageThreadId).toBe(55);
  });

  it("sends voice reply with reply metadata", async () => {
    const sendVoice = jest.fn(async () => ({}));
    const api = { sendVoice };

    await sendTelegramVoiceReply({
      api,
      chatId: 7,
      audio: new Uint8Array([1, 2, 3]),
      contentType: "audio/ogg",
      options: {
        messageThreadId: 9,
        replyToMessageId: 10,
      },
    });

    expect(sendVoice).toHaveBeenCalledTimes(1);
    expect(sendVoice).toHaveBeenCalledWith(
      7,
      expect.anything(),
      expect.objectContaining({
        message_thread_id: 9,
        reply_parameters: { message_id: 10 },
      }),
    );
  });
});
