import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { McpServerStore } from "../dist/index.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

async function createStore() {
  const dir = await mkdtemp(join(tmpdir(), "jihn-mcp-store-"));
  tempDirs.push(dir);
  return new McpServerStore(join(dir, "servers.json"));
}

describe("McpServerStore", () => {
  it("persists upsert and remove operations", async () => {
    const store = await createStore();

    await store.upsertServer({
      id: "docs",
      name: "Docs",
      url: "https://mcp.example.com/mcp",
      auth: {
        mode: "none",
      },
    });

    let servers = await store.listServers();
    expect(servers).toHaveLength(1);
    expect(servers[0]?.id).toBe("docs");

    await store.removeServer("docs");
    servers = await store.listServers();
    expect(servers).toHaveLength(0);
  });
});
