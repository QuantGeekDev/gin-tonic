import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ChannelAuthPairingMiddleware,
  FileChannelPairingStore,
} from "../dist/index.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

async function createStore() {
  const dir = await mkdtemp(join(tmpdir(), "jihn-pairing-"));
  tempDirs.push(dir);
  return new FileChannelPairingStore(join(dir, "pairing.json"));
}

describe("ChannelAuthPairingMiddleware", () => {
  it("issues challenge and verifies sender", async () => {
    const store = await createStore();
    const middleware = new ChannelAuthPairingMiddleware({
      mode: "pairing",
      store,
      hashSecret: "secret",
      codeLength: 6,
      now: () => 1_000_000,
    });

    const challenge = await middleware.evaluate({
      channelId: "telegram",
      senderId: "chat:1:user:1",
      text: "hello",
    });

    expect(challenge.decision).toBe("deny");
    expect(challenge.responseText).toContain("one-time code");

    const codeMatch = /code is: (\d+)/.exec(challenge.responseText);
    expect(codeMatch).not.toBeNull();
    const code = codeMatch[1];

    const verified = await middleware.evaluate({
      channelId: "telegram",
      senderId: "chat:1:user:1",
      text: `/verify ${code}`,
    });
    expect(verified.decision).toBe("deny");
    expect(verified.responseText).toContain("Verification successful");

    const allowed = await middleware.evaluate({
      channelId: "telegram",
      senderId: "chat:1:user:1",
      text: "hello again",
    });
    expect(allowed).toEqual({ decision: "allow" });
  });

  it("expires challenge and rotates after max attempts", async () => {
    const store = await createStore();
    let nowMs = 1_000;
    const middleware = new ChannelAuthPairingMiddleware({
      mode: "pairing",
      store,
      hashSecret: "secret",
      codeLength: 4,
      codeTtlMs: 100,
      maxAttempts: 2,
      now: () => nowMs,
    });

    const first = await middleware.evaluate({
      channelId: "telegram",
      senderId: "chat:2:user:2",
      text: "hi",
    });
    expect(first.decision).toBe("deny");

    const invalid = await middleware.evaluate({
      channelId: "telegram",
      senderId: "chat:2:user:2",
      text: "/verify 0000",
    });
    expect(invalid.responseText).toContain("Attempts remaining");

    const rotate = await middleware.evaluate({
      channelId: "telegram",
      senderId: "chat:2:user:2",
      text: "/verify 0000",
    });
    expect(rotate.responseText).toContain("one-time code");

    nowMs = 2_000;
    const expired = await middleware.evaluate({
      channelId: "telegram",
      senderId: "chat:2:user:2",
      text: "/verify 1234",
    });
    expect(expired.responseText).toContain("one-time code");
  });

  it("allows all messages when mode is off", async () => {
    const store = await createStore();
    const middleware = new ChannelAuthPairingMiddleware({
      mode: "off",
      store,
      hashSecret: "secret",
    });

    await expect(
      middleware.evaluate({
        channelId: "telegram",
        senderId: "chat:3:user:3",
        text: "hello",
      }),
    ).resolves.toEqual({ decision: "allow" });
  });
});
