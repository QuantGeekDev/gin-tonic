import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GatewayError,
  handleMessage,
  McpOAuthAuthorizationRequiredError,
  McpServerManager,
  McpServerStore,
  McpToolRegistry,
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

function createFakeMcpRegistry() {
  return new McpToolRegistry(
    {
      servers: [],
      cacheTtlMs: 1,
      clientName: "test",
      clientVersion: "1",
    },
    {
      createClient: () => ({
        async connect() {},
        async listTools() {
          return { tools: [] };
        },
        async callTool() {
          return { content: [{ type: "text", text: "ok" }] };
        },
      }),
      createTransport: () => ({ sessionId: "session-1" }),
      now: () => new Date("2026-02-17T00:00:00.000Z"),
    },
  );
}

describe("cross-channel parity", () => {
  it("continues same peer-scoped session across web and cli channels", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jihn-parity-sessions-"));
    tempDirs.push(dir);
    const store = new SessionStore(dir);

    const runTurn = async (params) => ({
      text: "ok",
      messages: [...params.messages, { role: "assistant", content: "ok" }],
      usage: { estimatedInputTokens: 0, inputTokens: 0, outputTokens: 0 },
    });

    await handleMessage({
      client: {},
      text: "first",
      systemPrompt: "prompt",
      tools: [],
      executeTool: async () => "unused",
      sessionStore: store,
      routing: { agentId: "main", scope: "peer", peerId: "alex", channelId: "shared" },
      runTurn,
    });
    await handleMessage({
      client: {},
      text: "second",
      systemPrompt: "prompt",
      tools: [],
      executeTool: async () => "unused",
      sessionStore: store,
      routing: { agentId: "main", scope: "peer", peerId: "alex", channelId: "shared" },
      runTurn,
    });

    const messages = await store.load("agent:main:scope:peer:peer:alex:channel:shared");
    expect(messages).toHaveLength(4);
  });

  it("applies identical tool-policy denial semantics in web and cli", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jihn-policy-parity-"));
    tempDirs.push(dir);
    const store = new SessionStore(dir);
    const invoke = async (channelId) =>
      handleMessage({
        client: {},
        text: "run tool",
        systemPrompt: "prompt",
        tools: [{ name: "calculate", description: "calc", inputSchema: {} }],
        executeTool: async () => "unused",
        sessionStore: store,
        routing: { agentId: "main", scope: "channel-peer", peerId: "alex", channelId },
        toolPolicy: { mode: "deny", toolNames: ["calculate"] },
        runTurn: async (params) => {
          await params.executeTool("calculate", { expression: "2+2" });
          return {
            text: "nope",
            messages: params.messages,
            usage: { estimatedInputTokens: 0, inputTokens: 0, outputTokens: 0 },
          };
        },
      });

    await expect(invoke("web")).rejects.toBeInstanceOf(GatewayError);
    await expect(invoke("cli")).rejects.toBeInstanceOf(GatewayError);
  });

  it("shares MCP oauth state between two manager instances (cli/web)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jihn-mcp-parity-"));
    tempDirs.push(dir);
    const storePath = join(dir, "servers.json");
    const store = new McpServerStore(storePath);
    let pendingState = "";
    const authFlow = async (provider, options) => {
      if (!options.authorizationCode) {
        pendingState = await provider.state();
        await provider.saveCodeVerifier("verifier");
        throw new McpOAuthAuthorizationRequiredError(
          `https://auth.example.com/authorize?state=${pendingState}`,
        );
      }
      await provider.saveTokens({
        access_token: "shared-token",
        token_type: "Bearer",
      });
      return "AUTHORIZED";
    };

    const webManager = new McpServerManager(
      {
        store,
        registry: createFakeMcpRegistry(),
        baseUrl: "http://localhost:3000",
      },
      { authFlow },
    );
    await webManager.addServer({
      id: "docs",
      url: "https://mcp.example.com/mcp",
      auth: { mode: "oauth2", oauth: { scope: "mcp.tools" } },
    });
    await webManager.beginOAuth("docs");

    const cliManager = new McpServerManager(
      {
        store,
        registry: createFakeMcpRegistry(),
        baseUrl: "http://localhost:3000",
      },
      { authFlow },
    );
    await cliManager.initializeFromStore();
    await cliManager.completeOAuthCallback("code-1", pendingState);

    const saved = await store.listServers();
    expect(saved[0]?.auth?.mode).toBe("oauth2");
    if (saved[0]?.auth?.mode === "oauth2") {
      expect(saved[0].auth.oauth.accessToken).toBe("shared-token");
    }
  });
});
