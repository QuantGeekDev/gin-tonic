import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GatewayError,
  handleMessage,
  InMemoryGatewayIdempotencyStore,
  SessionStore,
} from "../dist/index.js";

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

  it("defaults routing scope to channel-peer when not provided", async () => {
    const dir = await createTempSessionsDir();
    const store = new SessionStore(dir);

    const result = await handleMessage({
      client: {},
      text: "hello",
      systemPrompt: "prompt",
      tools: [],
      executeTool: async () => "unused",
      sessionStore: store,
      runTurn: async (params) => ({
        text: "ok",
        messages: [...params.messages, { role: "assistant", content: "ok" }],
        usage: {
          estimatedInputTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
        },
      }),
    });

    expect(result.routing.scope).toBe("channel-peer");
    expect(result.routing.sessionKey).toBe(
      "agent:main:scope:channel-peer:peer:anonymous:channel:unknown-channel",
    );
  });

  it("routes /agent:<name> input to separate agent session", async () => {
    const dir = await createTempSessionsDir();
    const store = new SessionStore(dir);
    let seenUserInput = "";

    const result = await handleMessage({
      client: {},
      text: "/agent:research draft a risk report",
      systemPrompt: "prompt",
      tools: [],
      executeTool: async () => "unused",
      sessionStore: store,
      routing: {
        agentId: "main",
        scope: "peer",
        channelId: "web",
        peerId: "alex",
      },
      runTurn: async (params) => {
        seenUserInput = String(params.messages[params.messages.length - 1]?.content ?? "");
        return {
          text: "ok",
          messages: [...params.messages, { role: "assistant", content: "ok" }],
          usage: {
            estimatedInputTokens: 0,
            inputTokens: 0,
            outputTokens: 0,
          },
        };
      },
    });

    expect(result.routing.agentId).toBe("research");
    expect(result.routing.sessionKey).toBe(
      "agent:research:scope:peer:peer:alex:channel:web",
    );
    expect(seenUserInput).toBe("draft a risk report");
  });

  it("applies shared tool policy and blocks denied tool calls", async () => {
    const dir = await createTempSessionsDir();
    const store = new SessionStore(dir);

    await expect(
      handleMessage({
        client: {},
        text: "run calculate",
        systemPrompt: "test prompt",
        tools: [{ name: "calculate", description: "calc", inputSchema: {} }],
        executeTool: async () => "never",
        sessionStore: store,
        toolPolicy: {
          mode: "deny",
          toolNames: ["calculate"],
        },
        runTurn: async (params) => {
          await params.executeTool("calculate", { expression: "2+2" });
          return {
            text: "unreachable",
            messages: params.messages,
            usage: {
              estimatedInputTokens: 0,
              inputTokens: 0,
              outputTokens: 0,
            },
          };
        },
      }),
    ).rejects.toThrow('Tool "calculate" blocked by policy mode "deny".');
  });

  it("compacts identically across channels for the same transcript", async () => {
    const dir = await createTempSessionsDir();
    const store = new SessionStore(dir);
    const baseMessages = [
      { role: "user", content: "one ".repeat(80) },
      { role: "assistant", content: "two ".repeat(80) },
      { role: "user", content: "three ".repeat(80) },
      { role: "assistant", content: "four ".repeat(80) },
      { role: "user", content: "five ".repeat(80) },
      { role: "assistant", content: "six ".repeat(80) },
      { role: "user", content: "seven ".repeat(80) },
      { role: "assistant", content: "eight ".repeat(80) },
    ];

    const webSession = "agent:main:scope:peer:peer:alex:channel:web";
    const cliSession = "agent:main:scope:peer:peer:alex:channel:cli";
    await store.save(webSession, baseMessages);
    await store.save(cliSession, baseMessages);

    let webInput = [];
    let cliInput = [];
    const runTurn = async (params) => {
      return {
        text: "ok",
        messages: params.messages,
        usage: {
          estimatedInputTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
        },
      };
    };

    await handleMessage({
      client: {},
      text: "new question",
      systemPrompt: "prompt",
      tools: [],
      executeTool: async () => "unused",
      sessionStore: store,
      routing: { agentId: "main", scope: "peer", peerId: "alex", channelId: "web" },
      sessionCompaction: { tokenBudget: 350 },
      runTurn: async (params) => {
        webInput = params.messages;
        return runTurn(params);
      },
    });

    await handleMessage({
      client: {},
      text: "new question",
      systemPrompt: "prompt",
      tools: [],
      executeTool: async () => "unused",
      sessionStore: store,
      routing: { agentId: "main", scope: "peer", peerId: "alex", channelId: "cli" },
      sessionCompaction: { tokenBudget: 350 },
      runTurn: async (params) => {
        cliInput = params.messages;
        return runTurn(params);
      },
    });

    expect(webInput).toEqual(cliInput);
    expect(webInput[0]).toMatchObject({
      role: "assistant",
    });
  });

  it("serializes concurrent requests per session", async () => {
    const dir = await createTempSessionsDir();
    const store = new SessionStore(dir);
    let active = 0;
    let peak = 0;

    const delayedTurn = async (params) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => {
        setTimeout(resolve, 30);
      });
      active -= 1;
      return {
        text: "ok",
        messages: [...params.messages, { role: "assistant", content: "ok" }],
        usage: {
          estimatedInputTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
        },
      };
    };

    await Promise.all([
      handleMessage({
        client: {},
        text: "first",
        systemPrompt: "prompt",
        tools: [],
        executeTool: async () => "unused",
        sessionStore: store,
        routing: {
          agentId: "main",
          scope: "peer",
          channelId: "web",
          peerId: "alex",
        },
        runTurn: delayedTurn,
      }),
      handleMessage({
        client: {},
        text: "second",
        systemPrompt: "prompt",
        tools: [],
        executeTool: async () => "unused",
        sessionStore: store,
        routing: {
          agentId: "main",
          scope: "peer",
          channelId: "web",
          peerId: "alex",
        },
        runTurn: delayedTurn,
      }),
    ]);

    expect(peak).toBe(1);
    const finalMessages = await store.load(
      "agent:main:scope:peer:peer:alex:channel:web",
    );
    expect(finalMessages.filter((message) => message.role === "user")).toHaveLength(2);
  });

  it("returns cached result for repeated idempotency key", async () => {
    const dir = await createTempSessionsDir();
    const store = new SessionStore(dir);
    const idempotencyStore = new InMemoryGatewayIdempotencyStore();
    let runCount = 0;
    const runTurn = async (params) => {
      runCount += 1;
      return {
        text: "ok",
        messages: [...params.messages, { role: "assistant", content: "ok" }],
        usage: {
          estimatedInputTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
        },
      };
    };

    const first = await handleMessage({
      client: {},
      text: "hello",
      systemPrompt: "prompt",
      tools: [],
      executeTool: async () => "unused",
      sessionStore: store,
      idempotencyStore,
      idempotencyKey: "idem-1",
      routing: { agentId: "main", scope: "peer", channelId: "web", peerId: "alex" },
      runTurn,
    });
    const second = await handleMessage({
      client: {},
      text: "hello",
      systemPrompt: "prompt",
      tools: [],
      executeTool: async () => "unused",
      sessionStore: store,
      idempotencyStore,
      idempotencyKey: "idem-1",
      routing: { agentId: "main", scope: "peer", channelId: "web", peerId: "alex" },
      runTurn,
    });

    expect(runCount).toBe(1);
    expect(first.text).toBe("ok");
    expect(second.idempotencyHit).toBe(true);
  });

  it("rejects same idempotency key with different payload", async () => {
    const dir = await createTempSessionsDir();
    const store = new SessionStore(dir);
    const idempotencyStore = new InMemoryGatewayIdempotencyStore();
    const runTurn = async (params) => ({
      text: "ok",
      messages: [...params.messages, { role: "assistant", content: "ok" }],
      usage: {
        estimatedInputTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
    });

    await handleMessage({
      client: {},
      text: "hello",
      systemPrompt: "prompt",
      tools: [],
      executeTool: async () => "unused",
      sessionStore: store,
      idempotencyStore,
      idempotencyKey: "idem-1",
      routing: { agentId: "main", scope: "peer", channelId: "web", peerId: "alex" },
      runTurn,
    });

    await expect(
      handleMessage({
        client: {},
        text: "different text",
        systemPrompt: "prompt",
        tools: [],
        executeTool: async () => "unused",
        sessionStore: store,
        idempotencyStore,
        idempotencyKey: "idem-1",
        routing: {
          agentId: "main",
          scope: "peer",
          channelId: "web",
          peerId: "alex",
        },
        runTurn,
      }),
    ).rejects.toBeInstanceOf(GatewayError);
  });
});
