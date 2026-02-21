import { describe, expect, it, jest } from "@jest/globals";

import { startTelegramTypingIndicator } from "../dist/telegram/typing.js";

describe("startTelegramTypingIndicator", () => {
  it("sends typing immediately and on interval until stopped", async () => {
    jest.useFakeTimers();
    const calls = [];
    const api = {
      async sendChatAction(chatId, action, options) {
        calls.push({ chatId, action, options });
      },
    };

    const handle = startTelegramTypingIndicator({
      api,
      chatId: 42,
      intervalMs: 1000,
    });

    await Promise.resolve();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ chatId: 42, action: "typing" });

    await jest.advanceTimersByTimeAsync(2100);
    expect(calls.length).toBeGreaterThanOrEqual(3);

    handle.stop();
    const before = calls.length;
    await jest.advanceTimersByTimeAsync(3000);
    expect(calls).toHaveLength(before);
    jest.useRealTimers();
  });

  it("includes message thread id when provided", async () => {
    const calls = [];
    const api = {
      async sendChatAction(_chatId, _action, options) {
        calls.push(options);
      },
    };

    const handle = startTelegramTypingIndicator({
      api,
      chatId: 10,
      messageThreadId: 77,
      intervalMs: 5000,
    });
    await Promise.resolve();
    handle.stop();

    expect(calls[0]).toEqual({ message_thread_id: 77 });
  });
});

