import { describe, expect, it } from "@jest/globals";

import {
  createPluginContext,
  createPluginRuntime,
  isPluginPermissionError,
  InMemoryPluginEventSink,
} from "../dist/index.js";

/** Helper to build a minimal manifest for enforcement tests. */
function manifest(id, overrides = {}) {
  return {
    id,
    name: id,
    version: "1.0.0",
    apiVersion: 1,
    entry: "index.mjs",
    enabled: true,
    priority: 0,
    capabilities: ["tools"],
    ...overrides,
  };
}

// Mock services that track calls
function mockMemory() {
  const calls = [];
  return {
    calls,
    async read(query, options) {
      calls.push({ op: "read", query, options });
      return [{ id: "1", text: "result" }];
    },
    async write(text, options) {
      calls.push({ op: "write", text, options });
      return { id: "new-1" };
    },
  };
}

function mockSession() {
  const calls = [];
  return {
    calls,
    async read(key) {
      calls.push({ op: "read", key });
      return [];
    },
    async write(key, messages) {
      calls.push({ op: "write", key, messages });
    },
  };
}

function mockFilesystem() {
  const calls = [];
  return {
    calls,
    async read(path) {
      calls.push({ op: "read", path });
      return "file content";
    },
    async write(path, content) {
      calls.push({ op: "write", path, content });
    },
  };
}

function mockNetwork() {
  const calls = [];
  return {
    calls,
    async fetch(url, init) {
      calls.push({ op: "fetch", url, init });
      return { status: 200, body: "ok" };
    },
  };
}

// ---------------------------------------------------------------------------
// VAL-002: Capability enforcement tests
// ---------------------------------------------------------------------------

describe("VAL-002: deny-by-default permission enforcement", () => {
  describe("memory access", () => {
    it("denies memory.read without permission", async () => {
      const ctx = createPluginContext(
        manifest("no-mem", { permissions: [] }),
        { memory: mockMemory() },
      );
      await expect(ctx.memory.read("test")).rejects.toThrow("memory.read");
    });

    it("denies memory.write without permission", async () => {
      const ctx = createPluginContext(
        manifest("no-mem", { permissions: ["memory.read"] }),
        { memory: mockMemory() },
      );
      await expect(ctx.memory.write("test")).rejects.toThrow("memory.write");
    });

    it("allows memory.read with permission", async () => {
      const mem = mockMemory();
      const ctx = createPluginContext(
        manifest("has-mem", { permissions: ["memory.read"] }),
        { memory: mem },
      );
      await ctx.memory.read("test");
      expect(mem.calls).toHaveLength(1);
    });
  });

  describe("session access", () => {
    it("denies session.read without permission", async () => {
      const ctx = createPluginContext(
        manifest("no-sess", { permissions: [] }),
        { session: mockSession() },
      );
      await expect(ctx.session.read("key")).rejects.toThrow("session.read");
    });

    it("denies session.write without permission", async () => {
      const ctx = createPluginContext(
        manifest("no-sess", { permissions: ["session.read"] }),
        { session: mockSession() },
      );
      await expect(ctx.session.write("key", [])).rejects.toThrow("session.write");
    });
  });

  describe("filesystem access", () => {
    it("denies filesystem.read without permission", async () => {
      const ctx = createPluginContext(
        manifest("no-fs", { permissions: [] }),
        { filesystem: mockFilesystem() },
      );
      await expect(ctx.filesystem.read("/tmp/test")).rejects.toThrow("filesystem.read");
    });

    it("denies filesystem.write without permission", async () => {
      const ctx = createPluginContext(
        manifest("no-fs", { permissions: ["filesystem.read"] }),
        { filesystem: mockFilesystem() },
      );
      await expect(ctx.filesystem.write("/tmp/test", "data")).rejects.toThrow("filesystem.write");
    });
  });

  describe("network access", () => {
    it("denies network.http without permission", async () => {
      const ctx = createPluginContext(
        manifest("no-net", { permissions: [] }),
        { network: mockNetwork() },
      );
      await expect(ctx.network.fetch("https://example.com")).rejects.toThrow("network.http");
    });

    it("allows network.http with permission and no domain policy", async () => {
      const net = mockNetwork();
      const ctx = createPluginContext(
        manifest("has-net", { permissions: ["network.http"] }),
        { network: net },
      );
      await ctx.network.fetch("https://example.com");
      expect(net.calls).toHaveLength(1);
    });
  });
});

describe("VAL-002: filesystem path ACL enforcement", () => {
  it("allows read to paths in allowlist", async () => {
    const fs = mockFilesystem();
    const ctx = createPluginContext(
      manifest("fs-acl", { permissions: ["filesystem.read"] }),
      {
        filesystem: fs,
        capabilityPolicy: {
          filesystem: { allowedReadPaths: ["/data/plugins", "/config"] },
        },
      },
    );
    await ctx.filesystem.read("/data/plugins/file.txt");
    expect(fs.calls).toHaveLength(1);
  });

  it("denies read to paths outside allowlist", async () => {
    const ctx = createPluginContext(
      manifest("fs-acl", { permissions: ["filesystem.read"] }),
      {
        filesystem: mockFilesystem(),
        capabilityPolicy: {
          filesystem: { allowedReadPaths: ["/data/plugins"] },
        },
      },
    );
    await expect(ctx.filesystem.read("/etc/passwd")).rejects.toThrow("filesystem.read");
  });

  it("denies write to paths outside allowlist", async () => {
    const ctx = createPluginContext(
      manifest("fs-acl", { permissions: ["filesystem.write"] }),
      {
        filesystem: mockFilesystem(),
        capabilityPolicy: {
          filesystem: { allowedWritePaths: ["/tmp/plugins"] },
        },
      },
    );
    await expect(ctx.filesystem.write("/etc/shadow", "bad")).rejects.toThrow("filesystem.write");
  });

  it("allows write to paths in allowlist", async () => {
    const fs = mockFilesystem();
    const ctx = createPluginContext(
      manifest("fs-acl", { permissions: ["filesystem.write"] }),
      {
        filesystem: fs,
        capabilityPolicy: {
          filesystem: { allowedWritePaths: ["/tmp/plugins"] },
        },
      },
    );
    await ctx.filesystem.write("/tmp/plugins/output.json", "{}");
    expect(fs.calls).toHaveLength(1);
  });

  it("blocks path traversal attempts", async () => {
    const ctx = createPluginContext(
      manifest("fs-acl", { permissions: ["filesystem.read"] }),
      {
        filesystem: mockFilesystem(),
        capabilityPolicy: {
          filesystem: { allowedReadPaths: ["/data/plugins"] },
        },
      },
    );
    await expect(ctx.filesystem.read("/data/plugins/../../etc/passwd")).rejects.toThrow("filesystem.read");
  });
});

describe("VAL-002: network domain allowlist enforcement", () => {
  it("allows fetch to domains in allowlist", async () => {
    const net = mockNetwork();
    const ctx = createPluginContext(
      manifest("net-acl", { permissions: ["network.http"] }),
      {
        network: net,
        capabilityPolicy: {
          network: { allowedDomains: ["api.example.com", "cdn.example.com"] },
        },
      },
    );
    await ctx.network.fetch("https://api.example.com/data");
    expect(net.calls).toHaveLength(1);
  });

  it("denies fetch to domains outside allowlist", async () => {
    const ctx = createPluginContext(
      manifest("net-acl", { permissions: ["network.http"] }),
      {
        network: mockNetwork(),
        capabilityPolicy: {
          network: { allowedDomains: ["api.example.com"] },
        },
      },
    );
    await expect(ctx.network.fetch("https://evil.com/data")).rejects.toThrow("network.http");
  });

  it("supports subdomain matching", async () => {
    const net = mockNetwork();
    const ctx = createPluginContext(
      manifest("net-acl", { permissions: ["network.http"] }),
      {
        network: net,
        capabilityPolicy: {
          network: { allowedDomains: ["example.com"] },
        },
      },
    );
    await ctx.network.fetch("https://api.example.com/data");
    expect(net.calls).toHaveLength(1);
  });

  it("denies fetch with invalid URL", async () => {
    const ctx = createPluginContext(
      manifest("net-acl", { permissions: ["network.http"] }),
      {
        network: mockNetwork(),
        capabilityPolicy: {
          network: { allowedDomains: ["example.com"] },
        },
      },
    );
    await expect(ctx.network.fetch("not-a-url")).rejects.toThrow("network.http");
  });
});

describe("VAL-002: memory namespace scoping", () => {
  it("allows access to allowed namespace", async () => {
    const mem = mockMemory();
    const ctx = createPluginContext(
      manifest("mem-ns", { permissions: ["memory.read"] }),
      {
        memory: mem,
        capabilityPolicy: {
          memory: { allowedNamespaces: ["plugin-data", "shared"] },
        },
      },
    );
    await ctx.memory.read("query", { namespace: "plugin-data" });
    expect(mem.calls).toHaveLength(1);
  });

  it("denies access to disallowed namespace", async () => {
    const ctx = createPluginContext(
      manifest("mem-ns", { permissions: ["memory.read"] }),
      {
        memory: mockMemory(),
        capabilityPolicy: {
          memory: { allowedNamespaces: ["plugin-data"] },
        },
      },
    );
    await expect(
      ctx.memory.read("query", { namespace: "system-secrets" }),
    ).rejects.toThrow("memory.read");
  });

  it("allows access when no namespace provided (no policy violation)", async () => {
    const mem = mockMemory();
    const ctx = createPluginContext(
      manifest("mem-ns", { permissions: ["memory.read"] }),
      {
        memory: mem,
        capabilityPolicy: {
          memory: { allowedNamespaces: ["plugin-data"] },
        },
      },
    );
    // No namespace in options, policy only checks when namespace is provided
    await ctx.memory.read("query");
    expect(mem.calls).toHaveLength(1);
  });
});

describe("VAL-002: session pattern guards", () => {
  it("allows access to matching session pattern", async () => {
    const sess = mockSession();
    const ctx = createPluginContext(
      manifest("sess-guard", { permissions: ["session.read"] }),
      {
        session: sess,
        capabilityPolicy: {
          session: { allowedSessionPatterns: ["agent:main:scope:peer"] },
        },
      },
    );
    await ctx.session.read("agent:main:scope:peer:peer:alex:channel:web");
    expect(sess.calls).toHaveLength(1);
  });

  it("denies access to non-matching session pattern", async () => {
    const ctx = createPluginContext(
      manifest("sess-guard", { permissions: ["session.read"] }),
      {
        session: mockSession(),
        capabilityPolicy: {
          session: { allowedSessionPatterns: ["agent:main:scope:peer"] },
        },
      },
    );
    await expect(
      ctx.session.read("agent:admin:scope:global:all"),
    ).rejects.toThrow("session.read");
  });
});

describe("VAL-002: audit events for denials", () => {
  it("emits deny callback on permission denial", async () => {
    const denyEvents = [];
    const ctx = createPluginContext(
      manifest("audit-test", { permissions: [] }),
      {
        memory: mockMemory(),
        onDeny: (event) => denyEvents.push(event),
      },
    );

    await expect(ctx.memory.read("test")).rejects.toThrow("memory.read");
    expect(denyEvents).toHaveLength(1);
    expect(denyEvents[0].pluginId).toBe("audit-test");
    expect(denyEvents[0].permission).toBe("memory.read");
    expect(denyEvents[0].reason).toBe("permission_not_declared");
  });

  it("emits deny callback on path ACL denial", async () => {
    const denyEvents = [];
    const ctx = createPluginContext(
      manifest("audit-test", { permissions: ["filesystem.read"] }),
      {
        filesystem: mockFilesystem(),
        capabilityPolicy: {
          filesystem: { allowedReadPaths: ["/safe"] },
        },
        onDeny: (event) => denyEvents.push(event),
      },
    );

    await expect(ctx.filesystem.read("/dangerous/path")).rejects.toThrow("filesystem.read");
    expect(denyEvents).toHaveLength(1);
    expect(denyEvents[0].reason).toBe("path_not_in_allowlist");
  });

  it("emits deny callback on domain allowlist denial", async () => {
    const denyEvents = [];
    const ctx = createPluginContext(
      manifest("audit-test", { permissions: ["network.http"] }),
      {
        network: mockNetwork(),
        capabilityPolicy: {
          network: { allowedDomains: ["safe.com"] },
        },
        onDeny: (event) => denyEvents.push(event),
      },
    );

    await expect(ctx.network.fetch("https://evil.com/data")).rejects.toThrow("network.http");
    expect(denyEvents).toHaveLength(1);
    expect(denyEvents[0].reason).toBe("domain_not_in_allowlist");
  });

  it("runtime event sink captures permission denials", async () => {
    const eventSink = new InMemoryPluginEventSink();
    const runtime = createPluginRuntime(
      [
        {
          manifest: manifest("sink-test", { permissions: ["memory.read"] }),
          plugin: {},
        },
      ],
      { eventSink },
    );

    expect(() => runtime.assertPermission("sink-test", "memory.write")).toThrow();

    const events = eventSink.list();
    const denied = events.filter((e) => e.name === "plugin.permission.denied");
    expect(denied.length).toBeGreaterThanOrEqual(1);
    expect(denied[0].pluginId).toBe("sink-test");
    expect(denied[0].details.permission).toBe("memory.write");
  });
});

describe("VAL-002: no silent fallback", () => {
  it("all denied operations throw PluginPermissionError", async () => {
    const ctx = createPluginContext(manifest("strict", { permissions: [] }), {
      memory: mockMemory(),
      session: mockSession(),
      filesystem: mockFilesystem(),
      network: mockNetwork(),
    });

    const ops = [
      ctx.memory.read("test"),
      ctx.memory.write("test"),
      ctx.session.read("key"),
      ctx.session.write("key", []),
      ctx.filesystem.read("/test"),
      ctx.filesystem.write("/test", "data"),
      ctx.network.fetch("https://example.com"),
    ];

    for (const op of ops) {
      try {
        await op;
        // Should never reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(isPluginPermissionError(error)).toBe(true);
      }
    }
  });
});
