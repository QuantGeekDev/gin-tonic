import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  McpOAuthAuthorizationRequiredError,
  McpServerManager,
  McpServerStore,
  McpToolRegistry,
} from "../dist/index.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

function createFakeClient() {
  return {
    async connect() {},
    async listTools() {
      return { tools: [] };
    },
    async callTool() {
      return { content: [{ type: "text", text: "ok" }] };
    },
  };
}

async function createFixture(authFlow) {
  const dir = await mkdtemp(join(tmpdir(), "jihn-mcp-manager-"));
  tempDirs.push(dir);

  const store = new McpServerStore(join(dir, "servers.json"));
  const registry = new McpToolRegistry(
    {
      servers: [],
      cacheTtlMs: 1,
      clientName: "test",
      clientVersion: "1",
    },
    {
      createClient: () => createFakeClient(),
      createTransport: () => ({ sessionId: "s1" }),
      now: () => new Date("2026-02-17T00:00:00.000Z"),
    },
  );

  const manager = new McpServerManager(
    {
      store,
      registry,
      baseUrl: "http://localhost:3000",
    },
    {
      authFlow,
    },
  );

  return { manager, store };
}

describe("McpServerManager", () => {
  it("adds and removes servers", async () => {
    const { manager, store } = await createFixture(async () => "AUTHORIZED");

    await manager.addServer({
      id: "docs",
      name: "Docs",
      url: "https://mcp.example.com/mcp",
      auth: { mode: "none" },
    });

    let servers = await store.listServers();
    expect(servers).toHaveLength(1);
    expect(servers[0]?.id).toBe("docs");

    await manager.removeServer("docs");
    servers = await store.listServers();
    expect(servers).toHaveLength(0);
  });

  it("supports oauth begin + callback completion", async () => {
    let seenState = "";
    const { manager, store } = await createFixture(async (provider, options) => {
      if (!options.authorizationCode) {
        seenState = await provider.state();
        await provider.saveCodeVerifier("verifier");
        throw new McpOAuthAuthorizationRequiredError(
          `https://auth.example.com/authorize?state=${seenState}`,
        );
      }

      await provider.saveTokens({
        access_token: "token-1",
        token_type: "Bearer",
      });
      return "AUTHORIZED";
    });

    await manager.addServer({
      id: "research",
      url: "https://mcp.example.com/mcp",
      auth: {
        mode: "oauth2",
        oauth: {
          scope: "mcp.tools",
        },
      },
    });

    const begin = await manager.beginOAuth("research");
    expect(begin.authorizationUrl).toContain("https://auth.example.com/authorize");

    const complete = await manager.completeOAuthCallback("code-1", seenState);
    expect(complete.serverId).toBe("research");

    const servers = await store.listServers();
    expect(servers[0]?.auth?.mode).toBe("oauth2");
    if (servers[0]?.auth?.mode === "oauth2") {
      expect(servers[0].auth.oauth.accessToken).toBe("token-1");
    }
  });
});
