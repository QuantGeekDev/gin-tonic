import { describe, expect, it } from "@jest/globals";

import { TelegramOutboundQueue } from "../dist/telegram/outbound-queue.js";

describe("TelegramOutboundQueue", () => {
  it("retries and succeeds", async () => {
    const queue = new TelegramOutboundQueue({
      maxAttempts: 3,
      baseDelayMs: 5,
    });

    let attempts = 0;
    let retries = 0;
    await queue.enqueue({
      run: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("transient");
        }
      },
      onRetry: async () => {
        retries += 1;
      },
    });

    expect(attempts).toBe(3);
    expect(retries).toBe(2);
  });

  it("fails after max attempts", async () => {
    const queue = new TelegramOutboundQueue({
      maxAttempts: 2,
      baseDelayMs: 5,
    });

    await expect(
      queue.enqueue({
        run: async () => {
          throw new Error("always");
        },
      }),
    ).rejects.toThrow("always");
  });
});
