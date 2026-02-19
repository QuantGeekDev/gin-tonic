import { describe, expect, it } from "@jest/globals";

import { buildTelegramPeerId, buildTelegramTurnInput } from "../dist/telegram/bridge.js";

describe("telegram bridge", () => {
  it("builds stable peer id", () => {
    expect(buildTelegramPeerId({ chatId: 100, userId: 200 })).toBe("telegram:100:user:200");
  });

  it("builds turn input with idempotency by update id", () => {
    const result = buildTelegramTurnInput({
      message: {
        updateId: 44,
        messageId: 99,
        chatId: 123,
        userId: 456,
        text: "hello",
        isDirectMessage: true,
        isTopicMessage: false,
      },
      agentId: "main",
      sessionScope: "channel-peer",
    });

    expect(result.text).toBe("hello");
    expect(result.routing.channelId).toBe("telegram");
    expect(result.routing.peerId).toBe("telegram:123:user:456");
    expect(result.idempotencyKey).toBe("telegram-update:44");
  });
});
