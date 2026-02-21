import { describe, expect, it, jest } from "@jest/globals";

import { InMemoryTelegramOutboxStore } from "../dist/telegram/outbox-store.js";
import { TelegramOutboundQueue } from "../dist/telegram/outbound-queue.js";

async function waitFor(predicate, timeoutMs = 1200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for condition");
}

describe("TelegramOutboundQueue", () => {
  it("retries and succeeds", async () => {
    const store = new InMemoryTelegramOutboxStore();
    let attempts = 0;
    let retries = 0;

    const queue = new TelegramOutboundQueue({
      maxAttempts: 3,
      baseDelayMs: 5,
      pollIntervalMs: 5,
      store,
      send: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("transient");
        }
      },
      onRetry: async () => {
        retries += 1;
      },
    });

    await queue.start();
    await queue.enqueue({
      accountKey: "chat:1",
      payload: {
        chatId: 1,
        text: "hello",
        options: {},
      },
    });

    await waitFor(async () => {
      const snapshot = await queue.snapshot();
      return snapshot.sent === 1;
    });

    await queue.stop();
    expect(attempts).toBe(3);
    expect(retries).toBe(2);
  });

  it("moves non-retryable failures to dead letters", async () => {
    const store = new InMemoryTelegramOutboxStore();
    let dead = 0;

    const queue = new TelegramOutboundQueue({
      maxAttempts: 4,
      baseDelayMs: 5,
      pollIntervalMs: 5,
      store,
      classifyError: () => ({
        retryable: false,
        code: "client",
        message: "400 bad request",
      }),
      send: async () => {
        throw new Error("400 bad request");
      },
      onDeadLetter: async () => {
        dead += 1;
      },
    });

    await queue.start();
    await queue.enqueue({
      accountKey: "chat:2",
      payload: {
        chatId: 2,
        text: "fail",
        options: {},
      },
    });

    await waitFor(async () => {
      const snapshot = await queue.snapshot();
      return snapshot.dead === 1;
    });

    const deadLetters = await queue.deadLetters(5);
    await queue.stop();

    expect(dead).toBe(1);
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]?.error).toContain("400");
  });

  it("recovers stuck processing messages on start", async () => {
    const store = new InMemoryTelegramOutboxStore();
    await store.enqueue({
      accountKey: "chat:3",
      payload: {
        chatId: 3,
        text: "recover",
        options: {},
      },
      availableAtMs: Date.now(),
    });
    await store.claimNextReady(Date.now());

    let sent = 0;
    const queue = new TelegramOutboundQueue({
      maxAttempts: 3,
      baseDelayMs: 5,
      pollIntervalMs: 5,
      store,
      send: async () => {
        sent += 1;
      },
    });

    await queue.start();
    await waitFor(async () => {
      const snapshot = await queue.snapshot();
      return snapshot.sent === 1;
    });
    await queue.stop();

    expect(sent).toBe(1);
  });

  it("passes tts payload to sender", async () => {
    const store = new InMemoryTelegramOutboxStore();
    const send = jest.fn(async () => {});
    const queue = new TelegramOutboundQueue({
      maxAttempts: 3,
      baseDelayMs: 5,
      pollIntervalMs: 5,
      store,
      send,
    });

    await queue.start();
    await queue.enqueue({
      accountKey: "chat:4",
      payload: {
        chatId: 4,
        text: "speak this",
        options: {},
        tts: {
          mode: "voice_only",
          outputFormat: "opus_48000_64",
        },
      },
    });

    await waitFor(async () => {
      const snapshot = await queue.snapshot();
      return snapshot.sent === 1;
    });
    await queue.stop();

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 4,
        text: "speak this",
        tts: expect.objectContaining({ mode: "voice_only" }),
      }),
    );
  });
});
