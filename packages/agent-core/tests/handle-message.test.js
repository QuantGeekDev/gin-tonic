import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleMessage, SessionStore } from "../dist/index.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

async function createTempSessionsDir() {
  const dir = await mkdtemp(join(tmpdir(), "jihn-handle-message-"));
  tempDirs.push(dir);
  return dir;
}

describe("handleMessage", () => {
  it("runs shared pipeline and persists new messages via append", async () => {
    const dir = await createTempSessionsDir();
    const store = new SessionStore(dir);

    const result = await handleMessage({
      client: {},
      text: "hello",
      systemPrompt: "test prompt",
      tools: [],
      executeTool: async () => "unused",
      sessionStore: store,
      routing: {
        agentId: "main",
        scope: "peer",
        channelId: "web",
        peerId: "alex",
      },
      runTurn: async (params) => ({
        text: "hi alex",
        messages: [...params.messages, { role: "assistant", content: "hi alex" }],
        usage: {
          estimatedInputTokens: 1,
          inputTokens: 2,
          outputTokens: 3,
        },
      }),
    });

    expect(result.persistenceMode).toBe("append");
    expect(result.routing.sessionKey).toBe(
      "agent:main:scope:peer:peer:alex:channel:web",
    );
    await expect(store.load(result.routing.sessionKey)).resolves.toEqual(
      result.messages,
    );
  });

  it("falls back to save when turn result does not preserve existing prefix", async () => {
    const dir = await createTempSessionsDir();
    const store = new SessionStore(dir);
    const sessionKey = "agent:main:scope:peer:peer:alex:channel:web";

    await store.append(sessionKey, { role: "user", content: "old message" });

    const result = await handleMessage({
      client: {},
      text: "new input",
      systemPrompt: "test prompt",
      tools: [],
      executeTool: async () => "unused",
      sessionStore: store,
      routing: {
        agentId: "main",
        scope: "peer",
        channelId: "web",
        peerId: "alex",
      },
      runTurn: async () => ({
        text: "rewritten",
        messages: [
          { role: "user", content: "new input" },
          { role: "assistant", content: "rewritten" },
        ],
        usage: {
          estimatedInputTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
        },
      }),
    });

    expect(result.persistenceMode).toBe("save");
    await expect(store.load(sessionKey)).resolves.toEqual(result.messages);
  });

  it("rejects empty message text", async () => {
    await expect(
      handleMessage({
        client: {},
        text: "   ",
        systemPrompt: "test prompt",
        tools: [],
        executeTool: async () => "unused",
      }),
    ).rejects.toThrow("text must be a non-empty string");
  });
});
