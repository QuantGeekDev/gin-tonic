import { describe, expect, it, jest } from "@jest/globals";
import {
  createRpcProxy,
  createRpcDispatcher,
  cleanupRpcProxy,
  createPluginContext,
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates paired in-memory channels that simulate the host<->worker boundary.
 * Messages from the proxy channel go to the dispatcher, and responses come back.
 */
function createPairedBridge(services) {
  const proxyHandlers = [];
  const requests = [];

  const proxyChannel = {
    postMessage(msg) {
      requests.push(msg);
      // Immediately dispatch to simulate synchronous message passing
      dispatch(msg);
    },
    onResponse(handler) {
      proxyHandlers.push(handler);
      return () => {
        const idx = proxyHandlers.indexOf(handler);
        if (idx >= 0) proxyHandlers.splice(idx, 1);
      };
    },
  };

  const dispatch = createRpcDispatcher(services, (response) => {
    // Deliver async to simulate real message passing
    queueMicrotask(() => {
      for (const h of proxyHandlers) h(response);
    });
  });

  return { proxyChannel, requests };
}

function manifest(id, overrides = {}) {
  return {
    id,
    name: id,
    version: "1.0.0",
    apiVersion: 1,
    entry: "index.js",
    enabled: true,
    priority: 0,
    capabilities: ["tools"],
    permissions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Worker-side context reconstruction via RPC bridge
// ---------------------------------------------------------------------------

describe("worker context reconstruction via RPC bridge", () => {
  describe("pluginId and permissions", () => {
    it("context has correct pluginId from metadata", () => {
      const { proxyChannel } = createPairedBridge({});
      const meta = {
        pluginId: "test-plugin",
        permissions: ["memory.read", "network.http"],
        manifest: manifest("test-plugin"),
        secretsSnapshot: {},
      };

      // Reconstruct context the same way the worker does
      const memory = createRpcProxy("memory", ["read", "write"], proxyChannel);
      const session = createRpcProxy("session", ["read", "write"], proxyChannel);
      const filesystem = createRpcProxy("filesystem", ["read", "write"], proxyChannel);
      const network = createRpcProxy("network", ["fetch"], proxyChannel);

      const context = {
        pluginId: meta.pluginId,
        permissions: Object.freeze([...meta.permissions]),
        memory,
        session,
        filesystem,
        network,
        secrets: { request: (scope) => meta.secretsSnapshot[scope] ?? null },
        hasPermission: (perm) => meta.permissions.includes(perm),
      };

      expect(context.pluginId).toBe("test-plugin");
      expect(context.permissions).toEqual(["memory.read", "network.http"]);

      cleanupRpcProxy(memory);
      cleanupRpcProxy(session);
      cleanupRpcProxy(filesystem);
      cleanupRpcProxy(network);
    });

    it("hasPermission returns correct results from local permissions", () => {
      const meta = {
        pluginId: "perm-check",
        permissions: ["memory.read", "filesystem.read"],
        manifest: manifest("perm-check"),
        secretsSnapshot: {},
      };

      const hasPermission = (perm) => meta.permissions.includes(perm);

      expect(hasPermission("memory.read")).toBe(true);
      expect(hasPermission("filesystem.read")).toBe(true);
      expect(hasPermission("filesystem.write")).toBe(false);
      expect(hasPermission("network.http")).toBe(false);
    });
  });

  describe("secrets from snapshot", () => {
    it("returns granted secrets from the snapshot", () => {
      const snapshot = {
        OPENAI_API_KEY: "sk-test-123",
        DATABASE_URL: "postgres://localhost/test",
      };
      const secretAccessor = {
        request: (scope) => snapshot[scope] ?? null,
      };

      expect(secretAccessor.request("OPENAI_API_KEY")).toBe("sk-test-123");
      expect(secretAccessor.request("DATABASE_URL")).toBe("postgres://localhost/test");
    });

    it("returns null for secrets not in the snapshot", () => {
      const secretAccessor = {
        request: (scope) => ({ API_KEY: "val" }[scope] ?? null),
      };

      expect(secretAccessor.request("MISSING_SECRET")).toBeNull();
      expect(secretAccessor.request("")).toBeNull();
    });
  });

  describe("memory accessor via RPC", () => {
    it("memory.read triggers RPC and returns result", async () => {
      const mockRead = jest.fn().mockResolvedValue([{ text: "found" }]);
      const { proxyChannel } = createPairedBridge({
        memory: { read: mockRead, write: jest.fn() },
      });

      const memory = createRpcProxy("memory", ["read", "write"], proxyChannel);

      const result = await memory.read("search query", { namespace: "ns1", limit: 5 });
      expect(result).toEqual([{ text: "found" }]);
      expect(mockRead).toHaveBeenCalledWith("search query", { namespace: "ns1", limit: 5 });

      cleanupRpcProxy(memory);
    });

    it("memory.write triggers RPC and returns result", async () => {
      const mockWrite = jest.fn().mockResolvedValue({ id: "mem_42" });
      const { proxyChannel } = createPairedBridge({
        memory: { read: jest.fn(), write: mockWrite },
      });

      const memory = createRpcProxy("memory", ["read", "write"], proxyChannel);

      const result = await memory.write("some text", { namespace: "default", tags: ["tag1"] });
      expect(result).toEqual({ id: "mem_42" });
      expect(mockWrite).toHaveBeenCalledWith("some text", { namespace: "default", tags: ["tag1"] });

      cleanupRpcProxy(memory);
    });
  });

  describe("session accessor via RPC", () => {
    it("session.read triggers RPC with correct args", async () => {
      const mockRead = jest.fn().mockResolvedValue([{ role: "user", text: "hello" }]);
      const { proxyChannel } = createPairedBridge({
        session: { read: mockRead, write: jest.fn() },
      });

      const session = createRpcProxy("session", ["read", "write"], proxyChannel);
      const result = await session.read("conv:main");
      expect(result).toEqual([{ role: "user", text: "hello" }]);
      expect(mockRead).toHaveBeenCalledWith("conv:main");

      cleanupRpcProxy(session);
    });

    it("session.write triggers RPC with correct args", async () => {
      const mockWrite = jest.fn().mockResolvedValue(undefined);
      const { proxyChannel } = createPairedBridge({
        session: { read: jest.fn(), write: mockWrite },
      });

      const session = createRpcProxy("session", ["read", "write"], proxyChannel);
      await session.write("conv:main", [{ role: "assistant", text: "hi" }]);
      expect(mockWrite).toHaveBeenCalledWith("conv:main", [{ role: "assistant", text: "hi" }]);

      cleanupRpcProxy(session);
    });
  });

  describe("filesystem accessor via RPC", () => {
    it("filesystem.read triggers RPC", async () => {
      const mockRead = jest.fn().mockResolvedValue("file contents");
      const { proxyChannel } = createPairedBridge({
        filesystem: { read: mockRead, write: jest.fn() },
      });

      const filesystem = createRpcProxy("filesystem", ["read", "write"], proxyChannel);
      const result = await filesystem.read("/path/to/file.txt");
      expect(result).toBe("file contents");
      expect(mockRead).toHaveBeenCalledWith("/path/to/file.txt");

      cleanupRpcProxy(filesystem);
    });

    it("filesystem.write triggers RPC", async () => {
      const mockWrite = jest.fn().mockResolvedValue(undefined);
      const { proxyChannel } = createPairedBridge({
        filesystem: { read: jest.fn(), write: mockWrite },
      });

      const filesystem = createRpcProxy("filesystem", ["read", "write"], proxyChannel);
      await filesystem.write("/output.txt", "data");
      expect(mockWrite).toHaveBeenCalledWith("/output.txt", "data");

      cleanupRpcProxy(filesystem);
    });
  });

  describe("network accessor via RPC", () => {
    it("network.fetch triggers RPC", async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 200, body: '{"ok":true}' });
      const { proxyChannel } = createPairedBridge({
        network: { fetch: mockFetch },
      });

      const network = createRpcProxy("network", ["fetch"], proxyChannel);
      const result = await network.fetch("https://api.example.com/data", { method: "GET" });
      expect(result).toEqual({ status: 200, body: '{"ok":true}' });
      expect(mockFetch).toHaveBeenCalledWith("https://api.example.com/data", { method: "GET" });

      cleanupRpcProxy(network);
    });
  });

  describe("permission denial propagation", () => {
    it("permission error from gated accessor propagates through bridge", async () => {
      const error = new Error('plugin denied-plugin is missing permission "filesystem.write"');
      error.name = "PluginPermissionError";
      const mockWrite = jest.fn().mockRejectedValue(error);
      const { proxyChannel } = createPairedBridge({
        filesystem: { read: jest.fn(), write: mockWrite },
      });

      const filesystem = createRpcProxy("filesystem", ["read", "write"], proxyChannel);

      await expect(filesystem.write("/etc/passwd", "hack")).rejects.toThrow(
        'plugin denied-plugin is missing permission "filesystem.write"',
      );

      try {
        await filesystem.write("/etc/passwd", "hack");
      } catch (e) {
        expect(e.name).toBe("PluginPermissionError");
      }

      cleanupRpcProxy(filesystem);
    });

    it("generic error propagates through bridge", async () => {
      const mockRead = jest.fn().mockRejectedValue(new TypeError("invalid argument"));
      const { proxyChannel } = createPairedBridge({
        memory: { read: mockRead, write: jest.fn() },
      });

      const memory = createRpcProxy("memory", ["read", "write"], proxyChannel);

      await expect(memory.read("bad")).rejects.toThrow("invalid argument");

      try {
        await memory.read("bad");
      } catch (e) {
        expect(e.name).toBe("TypeError");
      }

      cleanupRpcProxy(memory);
    });
  });

  describe("end-to-end with gated context", () => {
    it("RPC through gated context enforces permissions", async () => {
      const denyEvents = [];
      const onDeny = (event) => denyEvents.push(event);

      // Create a gated context with no filesystem.read permission
      const ctx = createPluginContext(
        manifest("gated-test", { permissions: ["memory.read"] }),
        {
          memory: {
            read: jest.fn().mockResolvedValue([]),
            write: jest.fn().mockResolvedValue({ id: "1" }),
          },
          filesystem: {
            read: jest.fn().mockResolvedValue("content"),
            write: jest.fn().mockResolvedValue(undefined),
          },
          onDeny,
        },
      );

      // Wire the gated context into a dispatcher
      const { proxyChannel } = createPairedBridge({
        memory: {
          read: (...args) => ctx.memory.read(...args),
          write: (...args) => ctx.memory.write(...args),
        },
        filesystem: {
          read: (...args) => ctx.filesystem.read(...args),
          write: (...args) => ctx.filesystem.write(...args),
        },
      });

      const memory = createRpcProxy("memory", ["read", "write"], proxyChannel);
      const filesystem = createRpcProxy("filesystem", ["read", "write"], proxyChannel);

      // memory.read should succeed (permission granted)
      const result = await memory.read("query");
      expect(result).toEqual([]);

      // filesystem.read should fail (no filesystem.read permission)
      await expect(filesystem.read("/some/path")).rejects.toThrow();
      expect(denyEvents.length).toBeGreaterThan(0);
      expect(denyEvents[0].pluginId).toBe("gated-test");
      expect(denyEvents[0].permission).toBe("filesystem.read");

      cleanupRpcProxy(memory);
      cleanupRpcProxy(filesystem);
    });

    it("RPC through gated context with capability policy enforces path ACLs", async () => {
      const denyEvents = [];

      const innerFs = {
        read: jest.fn().mockResolvedValue("content"),
        write: jest.fn().mockResolvedValue(undefined),
      };

      const ctx = createPluginContext(
        manifest("acl-test", { permissions: ["filesystem.read", "filesystem.write"] }),
        {
          filesystem: innerFs,
          capabilityPolicy: {
            filesystem: {
              allowedReadPaths: ["/safe/"],
              allowedWritePaths: ["/safe/output/"],
            },
          },
          onDeny: (event) => denyEvents.push(event),
        },
      );

      const { proxyChannel } = createPairedBridge({
        filesystem: {
          read: (...args) => ctx.filesystem.read(...args),
          write: (...args) => ctx.filesystem.write(...args),
        },
      });

      const filesystem = createRpcProxy("filesystem", ["read", "write"], proxyChannel);

      // Allowed read
      await expect(filesystem.read("/safe/data.txt")).resolves.toBe("content");

      // Denied read (outside allowed path)
      await expect(filesystem.read("/etc/shadow")).rejects.toThrow();
      expect(denyEvents).toHaveLength(1);
      expect(denyEvents[0].operation).toBe("read");

      // Allowed write
      await expect(filesystem.write("/safe/output/out.txt", "data")).resolves.toBeUndefined();

      // Denied write
      await expect(filesystem.write("/root/evil.sh", "#!/bin/sh")).rejects.toThrow();
      expect(denyEvents).toHaveLength(2);

      cleanupRpcProxy(filesystem);
    });

    it("audit events fire on host side for worker-initiated denials", async () => {
      const denyEvents = [];

      const ctx = createPluginContext(
        manifest("audit-test", { permissions: [] }),
        {
          network: {
            fetch: jest.fn().mockResolvedValue({ status: 200, body: "" }),
          },
          onDeny: (event) => denyEvents.push(event),
        },
      );

      const { proxyChannel } = createPairedBridge({
        network: {
          fetch: (...args) => ctx.network.fetch(...args),
        },
      });

      const network = createRpcProxy("network", ["fetch"], proxyChannel);

      // No network.http permission
      await expect(network.fetch("https://evil.com")).rejects.toThrow();

      expect(denyEvents).toHaveLength(1);
      expect(denyEvents[0]).toEqual(
        expect.objectContaining({
          pluginId: "audit-test",
          permission: "network.http",
        }),
      );

      cleanupRpcProxy(network);
    });
  });
});
