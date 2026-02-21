import { describe, expect, it } from "@jest/globals";

import { McpToolRegistry } from "../dist/index.js";

function createFakeClient() {
  return {
    async connect() {},
    async listTools() {
      return {
        tools: [
          {
            name: "search",
            description: "search docs",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
            },
          },
        ],
      };
    },
    async callTool(params) {
      return {
        content: [{ type: "text", text: `ok:${params.name}` }],
      };
    },
  };
}

describe("McpToolRegistry", () => {
  it("lists exposed tool definitions and executes remote tools", async () => {
    const registry = new McpToolRegistry(
      {
        servers: [{ id: "docs", url: "https://mcp.example.com/mcp" }],
      },
      {
        createClient: () => createFakeClient(),
        createTransport: () => ({ sessionId: "session-1" }),
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    );

    const listed = await registry.listToolDefinitions({ forceRefresh: true });
    expect(listed.toolDefinitions).toHaveLength(1);
    expect(listed.toolDefinitions[0]?.name).toBe("mcp__docs__search");

    const output = await registry.executeTool("mcp__docs__search", {
      query: "hello",
    });
    expect(output).toBe("ok:search");

    const snapshot = await registry.getSnapshot();
    expect(snapshot.servers[0]?.connected).toBe(true);
    expect(snapshot.servers[0]?.toolCount).toBe(1);
  });
});
