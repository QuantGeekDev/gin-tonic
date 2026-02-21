import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPluginRuntime,
  createSharedToolRuntime,
  isPluginPermissionError,
  loadWorkspacePlugins,
  InMemoryPluginEventSink,
  InMemoryPluginStatusStore,
  FilePluginStatusStore,
  FilePluginEventSink,
  createPluginContext,
  topologicalSortPlugins,
} from "../dist/index.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

function manifest(id, priority = 0, overrides = {}) {
  return {
    id,
    name: id,
    version: "1.0.0",
    apiVersion: 1,
    entry: "index.mjs",
    enabled: true,
    priority,
    capabilities: ["prompt", "turn", "tool_intercept", "tools"],
    ...overrides,
  };
}

describe("plugin runtime", () => {
  it("runs prompt hooks in deterministic priority order", async () => {
    const runtime = createPluginRuntime([
      {
        manifest: manifest("low", 1),
        plugin: {
          hooks: {
            beforePromptCompose(event) {
              return `${event.prompt} [low]`;
            },
          },
        },
      },
      {
        manifest: manifest("high", 10),
        plugin: {
          hooks: {
            beforePromptCompose(event) {
              return `${event.prompt} [high]`;
            },
          },
        },
      },
    ]);

    const result = await runtime.applyPromptHooks("base", {
      workspaceDir: "/tmp/project",
      agentId: "main",
    });

    expect(result).toBe("base [high] [low]");
  });

  it("continues after hook timeout when onError=continue", async () => {
    const runtime = createPluginRuntime([
      {
        manifest: manifest("slow", 10, {
          hookPolicy: { timeoutMs: 5, onError: "continue" },
        }),
        plugin: {
          hooks: {
            beforePromptCompose: async () =>
              await new Promise((resolve) => setTimeout(() => resolve("never"), 50)),
          },
        },
      },
      {
        manifest: manifest("next", 1),
        plugin: {
          hooks: {
            beforePromptCompose(event) {
              return `${event.prompt} [next]`;
            },
          },
        },
      },
    ]);

    const result = await runtime.applyPromptHooks("base", {
      workspaceDir: "/tmp/project",
    });

    expect(result).toBe("base [next]");
  });

  it("fails on hook timeout when onError=fail", async () => {
    const runtime = createPluginRuntime([
      {
        manifest: manifest("strict", 10, {
          hookPolicy: { timeoutMs: 5, onError: "fail" },
        }),
        plugin: {
          hooks: {
            beforePromptCompose: async () =>
              await new Promise((resolve) => setTimeout(() => resolve("never"), 50)),
          },
        },
      },
    ]);

    await expect(
      runtime.applyPromptHooks("base", { workspaceDir: "/tmp/project" }),
    ).rejects.toThrow("plugin hook timeout");
  });

  it("exposes plugin tools through shared tool runtime", async () => {
    const runtime = createPluginRuntime([
      {
        manifest: manifest("math"),
        plugin: {
          tools: [
            {
              name: "multiply",
              description: "Multiply two numbers",
              inputSchema: {
                type: "object",
                properties: {
                  a: { type: "number" },
                  b: { type: "number" },
                },
                required: ["a", "b"],
              },
              async execute(input) {
                const a = Number(input.a ?? 0);
                const b = Number(input.b ?? 0);
                return String(a * b);
              },
            },
          ],
        },
      },
    ]);

    const shared = createSharedToolRuntime({ pluginRuntime: runtime });
    const names = shared.definitions.map((tool) => tool.name);

    expect(names).toContain("math.multiply");
    await expect(shared.execute("math.multiply", { a: 6, b: 7 })).resolves.toBe("42");
  });

  it("denies missing permission checks with typed error", () => {
    const runtime = createPluginRuntime([
      {
        manifest: manifest("guarded", 1, {
          permissions: ["memory.read"],
        }),
        plugin: {},
      },
    ]);

    expect(() => runtime.assertPermission("guarded", "memory.write")).toThrow();
    try {
      runtime.assertPermission("guarded", "memory.write");
    } catch (error) {
      expect(isPluginPermissionError(error)).toBe(true);
    }
  });

  it("opens plugin circuit breaker after repeated failures", async () => {
    const runtime = createPluginRuntime(
      [
        {
          manifest: manifest("breaker"),
          plugin: {
            hooks: {
              beforePromptCompose: () => {
                throw new Error("boom");
              },
            },
          },
        },
      ],
      {
        circuitBreaker: {
          failureThreshold: 2,
          cooldownMs: 5_000,
          timeWindowMs: 5_000,
        },
      },
    );

    await runtime.applyPromptHooks("a", { workspaceDir: "/tmp/project" });
    await runtime.applyPromptHooks("b", { workspaceDir: "/tmp/project" });
    const status = runtime.listStatuses().find((item) => item.pluginId === "breaker");
    expect(status?.state).toBe("open_circuit");
  });
});

describe("workspace plugin loading", () => {
  it("loads plugin manifests and modules from workspace/plugins", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "jihn-plugins-"));
    tempDirs.push(workspace);

    const pluginDir = join(workspace, "plugins", "echo");
    await mkdir(pluginDir, { recursive: true });

    await writeFile(
      join(pluginDir, "jihn.plugin.json"),
      JSON.stringify(
        {
          id: "echo",
          name: "Echo Plugin",
          version: "1.0.0",
          apiVersion: 1,
          entry: "index.mjs",
          enabled: true,
          priority: 5,
          capabilities: ["tools"],
        },
        null,
        2,
      ),
      "utf8",
    );

    await writeFile(
      join(pluginDir, "index.mjs"),
      `export default {
        tools: [
          {
            name: "echo",
            description: "Echo input",
            inputSchema: { type: "object", properties: { text: { type: "string" } } },
            async execute(input) {
              return String(input.text ?? "");
            }
          }
        ]
      };`,
      "utf8",
    );

    const loaded = await loadWorkspacePlugins({ workspaceDir: workspace });
    expect(loaded.issues).toHaveLength(0);
    expect(loaded.plugins).toHaveLength(1);
    expect(loaded.plugins[0]?.manifest.id).toBe("echo");

    const runtime = createPluginRuntime(loaded.plugins);
    expect(runtime.getToolDefinitions().map((tool) => tool.name)).toContain("echo.echo");
    await expect(runtime.executeTool("echo.echo", { text: "hello" })).resolves.toBe("hello");
  });

  it("rejects unsupported plugin apiVersion", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "jihn-plugins-version-"));
    tempDirs.push(workspace);

    const pluginDir = join(workspace, "plugins", "future");
    await mkdir(pluginDir, { recursive: true });

    await writeFile(
      join(pluginDir, "jihn.plugin.json"),
      JSON.stringify(
        {
          id: "future",
          name: "Future Plugin",
          version: "1.0.0",
          apiVersion: 2,
          entry: "index.mjs",
          enabled: true,
          priority: 0,
          capabilities: ["tools"],
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(join(pluginDir, "index.mjs"), "export default {};", "utf8");

    const loaded = await loadWorkspacePlugins({
      workspaceDir: workspace,
      supportedApiVersions: [1],
    });
    expect(loaded.plugins).toHaveLength(0);
    expect(loaded.issues[0]?.message).toContain("unsupported apiVersion 2");
  });

  it("runs lifecycle hooks during loading", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "jihn-plugins-lifecycle-"));
    tempDirs.push(workspace);

    const pluginDir = join(workspace, "plugins", "lifecycle");
    await mkdir(pluginDir, { recursive: true });

    await writeFile(
      join(pluginDir, "jihn.plugin.json"),
      JSON.stringify(
        {
          id: "lifecycle",
          name: "Lifecycle Plugin",
          version: "1.0.0",
          apiVersion: 1,
          entry: "index.mjs",
          enabled: true,
          priority: 0,
          capabilities: ["tools"],
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      join(pluginDir, "index.mjs"),
      `import { appendFile } from "node:fs/promises";
       export default () => ({
         lifecycle: {
           async onInstall() { await appendFile("${join(workspace, "trace.log")}", "install\\n", "utf8"); },
           async onEnable() { await appendFile("${join(workspace, "trace.log")}", "enable\\n", "utf8"); }
         }
       });`,
      "utf8",
    );

    const loaded = await loadWorkspacePlugins({ workspaceDir: workspace });
    expect(loaded.issues).toHaveLength(0);
    const trace = await readFile(join(workspace, "trace.log"), "utf8");
    expect(trace).toContain("install");
    expect(trace).toContain("enable");
  });

  it("reports missing dependencies as load issues", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "jihn-plugins-deps-"));
    tempDirs.push(workspace);

    const pluginDir = join(workspace, "plugins", "dependent");
    await mkdir(pluginDir, { recursive: true });

    await writeFile(
      join(pluginDir, "jihn.plugin.json"),
      JSON.stringify({
        id: "dependent",
        name: "Dependent",
        version: "1.0.0",
        apiVersion: 1,
        entry: "index.mjs",
        enabled: true,
        priority: 0,
        capabilities: ["tools"],
        dependencies: ["missing-plugin"],
      }, null, 2),
      "utf8",
    );
    await writeFile(join(pluginDir, "index.mjs"), "export default {};", "utf8");

    const loaded = await loadWorkspacePlugins({ workspaceDir: workspace });
    const depIssue = loaded.issues.find((i) => i.message.includes('missing dependency'));
    expect(depIssue).toBeDefined();
    expect(depIssue.message).toContain("missing-plugin");
  });
});

describe("plugin dependency topological sort", () => {
  it("sorts plugins respecting dependencies", () => {
    const entries = [
      { manifest: manifest("b", 0, { dependencies: ["a"] }), plugin: {} },
      { manifest: manifest("a", 0), plugin: {} },
    ];
    const result = topologicalSortPlugins(entries);
    expect(result.cycles).toHaveLength(0);
    expect(result.missingDeps).toHaveLength(0);
    const ids = result.sorted.map((e) => e.manifest.id);
    expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
  });

  it("detects dependency cycles", () => {
    const entries = [
      { manifest: manifest("a", 0, { dependencies: ["b"] }), plugin: {} },
      { manifest: manifest("b", 0, { dependencies: ["a"] }), plugin: {} },
    ];
    const result = topologicalSortPlugins(entries);
    expect(result.cycles.length).toBeGreaterThan(0);
  });

  it("detects missing dependencies", () => {
    const entries = [
      { manifest: manifest("a", 0, { dependencies: ["nonexistent"] }), plugin: {} },
    ];
    const result = topologicalSortPlugins(entries);
    expect(result.missingDeps).toHaveLength(1);
    expect(result.missingDeps[0].missing).toBe("nonexistent");
  });
});

describe("plugin context permission enforcement", () => {
  it("allows access when permission is declared", async () => {
    const mockMemory = {
      async read() { return [{ id: "1", text: "hello" }]; },
      async write() { return { id: "new-1" }; },
    };
    const ctx = createPluginContext(
      manifest("reader", 0, { permissions: ["memory.read", "memory.write"] }),
      { memory: mockMemory },
    );

    const results = await ctx.memory.read("test");
    expect(results).toHaveLength(1);

    const saved = await ctx.memory.write("note");
    expect(saved.id).toBe("new-1");
  });

  it("denies access when permission is missing", async () => {
    const ctx = createPluginContext(
      manifest("no-perms", 0, { permissions: [] }),
      { memory: { async read() { return []; }, async write() { return { id: "" }; } } },
    );

    await expect(ctx.memory.read("test")).rejects.toThrow("memory.read");
    await expect(ctx.memory.write("test")).rejects.toThrow("memory.write");
  });

  it("denies filesystem access without permission", async () => {
    const ctx = createPluginContext(
      manifest("no-fs", 0, { permissions: ["memory.read"] }),
      { filesystem: { async read() { return ""; }, async write() {} } },
    );

    await expect(ctx.filesystem.read("/tmp/test")).rejects.toThrow("filesystem.read");
    await expect(ctx.filesystem.write("/tmp/test", "data")).rejects.toThrow("filesystem.write");
  });

  it("denies network access without permission", async () => {
    const ctx = createPluginContext(
      manifest("no-net", 0, { permissions: [] }),
      { network: { async fetch() { return { status: 200, body: "" }; } } },
    );

    await expect(ctx.network.fetch("https://example.com")).rejects.toThrow("network.http");
  });

  it("passes context to tool execute", async () => {
    let receivedContext = null;
    const runtime = createPluginRuntime(
      [
        {
          manifest: manifest("ctx-test", 0, { permissions: ["memory.read"] }),
          plugin: {
            tools: [
              {
                name: "check",
                description: "Check context",
                inputSchema: { type: "object", properties: {} },
                async execute(input, context) {
                  receivedContext = context;
                  return "ok";
                },
              },
            ],
          },
        },
      ],
      { contextServices: {} },
    );

    await runtime.executeTool("ctx-test.check", {});
    expect(receivedContext).not.toBeNull();
    expect(receivedContext.pluginId).toBe("ctx-test");
    expect(receivedContext.hasPermission("memory.read")).toBe(true);
    expect(receivedContext.hasPermission("memory.write")).toBe(false);
  });
});

describe("event sink interface", () => {
  it("InMemoryPluginEventSink implements list()", () => {
    const sink = new InMemoryPluginEventSink();
    sink.emit({
      timestamp: new Date().toISOString(),
      name: "plugin.loaded",
      pluginId: "test",
    });
    const events = sink.list();
    expect(events).toHaveLength(1);
    expect(events[0].pluginId).toBe("test");
  });

  it("runtime listEvents uses sink.list() directly", () => {
    const sink = new InMemoryPluginEventSink();
    const runtime = createPluginRuntime(
      [{ manifest: manifest("ev-test"), plugin: {} }],
      { eventSink: sink },
    );
    const events = runtime.listEvents();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].name).toBe("plugin.loaded");
  });
});

describe("persistent storage", () => {
  it("FilePluginStatusStore persists and loads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jihn-status-"));
    tempDirs.push(dir);
    const filePath = join(dir, "status.json");

    const store1 = new FilePluginStatusStore(filePath);
    store1.update({
      pluginId: "test",
      state: "enabled",
      consecutiveFailures: 0,
      lastUpdatedAt: new Date().toISOString(),
    });

    // Give async write time to flush
    await new Promise((r) => setTimeout(r, 100));

    const store2 = new FilePluginStatusStore(filePath);
    await store2.load();
    expect(store2.get("test")).not.toBeNull();
    expect(store2.get("test").state).toBe("enabled");
  });

  it("FilePluginEventSink persists and loads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jihn-events-"));
    tempDirs.push(dir);
    const filePath = join(dir, "events.json");

    const sink1 = new FilePluginEventSink(filePath);
    sink1.emit({
      timestamp: new Date().toISOString(),
      name: "plugin.loaded",
      pluginId: "test",
    });

    await new Promise((r) => setTimeout(r, 100));

    const sink2 = new FilePluginEventSink(filePath);
    await sink2.load();
    const events = sink2.list();
    expect(events).toHaveLength(1);
    expect(events[0].pluginId).toBe("test");
  });
});

describe("plugin runtime shutdown", () => {
  it("calls onUnload lifecycle hooks during shutdown", async () => {
    let unloaded = false;
    const runtime = createPluginRuntime([
      {
        manifest: manifest("shutdownable"),
        plugin: {
          lifecycle: {
            onUnload() {
              unloaded = true;
            },
          },
        },
      },
    ]);

    await runtime.shutdown();
    expect(unloaded).toBe(true);
  });
});
