import { describe, expect, it } from "@jest/globals";

import { buildTelegramReplyOptions, splitTelegramText } from "../dist/telegram/reply.js";

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
});
