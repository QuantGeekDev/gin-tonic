import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import {
  createRpcProxy,
  createRpcDispatcher,
  cleanupRpcProxy,
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// Helpers: mock RPC channel
// ---------------------------------------------------------------------------

function createMockChannel() {
  const sent = [];
  const handlers = [];

  /** @type {import("../dist/index.js").RpcChannel} */
  const channel = {
    postMessage(msg) {
      sent.push(msg);
    },
    onResponse(handler) {
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    },
  };

  function deliverResponse(response) {
    for (const h of handlers) h(response);
  }

  return { channel, sent, handlers, deliverResponse };
}

// ---------------------------------------------------------------------------
// createRpcProxy
// ---------------------------------------------------------------------------

describe("createRpcProxy", () => {
  it("creates an object with the specified methods", () => {
    const { channel } = createMockChannel();
    const proxy = createRpcProxy("memory", ["read", "write"], channel);
    expect(typeof proxy.read).toBe("function");
    expect(typeof proxy.write).toBe("function");
  });

  it("sends a WorkerRpcRequest with correct shape on method call", () => {
    const { channel, sent } = createMockChannel();
    const proxy = createRpcProxy("memory", ["read"], channel);

    proxy.read("test-query", { limit: 5 });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: "rpc_request",
      rpcId: expect.any(String),
      service: "memory",
      method: "read",
      args: ["test-query", { limit: 5 }],
    });
  });

  it("resolves the returned promise on successful response", async () => {
    const { channel, sent, deliverResponse } = createMockChannel();
    const proxy = createRpcProxy("memory", ["read"], channel);

    const promise = proxy.read("query");
    const rpcId = sent[0].rpcId;

    deliverResponse({
      type: "rpc_response",
      rpcId,
      ok: true,
      result: [{ text: "hello" }],
    });

    const result = await promise;
    expect(result).toEqual([{ text: "hello" }]);
  });

  it("rejects the returned promise on error response", async () => {
    const { channel, sent, deliverResponse } = createMockChannel();
    const proxy = createRpcProxy("memory", ["read"], channel);

    const promise = proxy.read("query");
    const rpcId = sent[0].rpcId;

    deliverResponse({
      type: "rpc_response",
      rpcId,
      ok: false,
      error: "access denied",
      errorType: "PluginPermissionError",
    });

    await expect(promise).rejects.toThrow("access denied");

    // Check error type is preserved
    try {
      await promise;
    } catch (e) {
      expect(e.name).toBe("PluginPermissionError");
    }
  });

  it("handles multiple concurrent calls with independent rpcIds", async () => {
    const { channel, sent, deliverResponse } = createMockChannel();
    const proxy = createRpcProxy("session", ["read", "write"], channel);

    const p1 = proxy.read("key1");
    const p2 = proxy.write("key2", []);

    expect(sent).toHaveLength(2);
    expect(sent[0].rpcId).not.toBe(sent[1].rpcId);

    // Respond in reverse order
    deliverResponse({
      type: "rpc_response",
      rpcId: sent[1].rpcId,
      ok: true,
      result: undefined,
    });
    deliverResponse({
      type: "rpc_response",
      rpcId: sent[0].rpcId,
      ok: true,
      result: [{ data: "x" }],
    });

    expect(await p1).toEqual([{ data: "x" }]);
    expect(await p2).toBeUndefined();
  });

  it("ignores responses for unknown rpcIds", () => {
    const { channel, deliverResponse } = createMockChannel();
    createRpcProxy("memory", ["read"], channel);

    // Should not throw
    deliverResponse({
      type: "rpc_response",
      rpcId: "unknown_99",
      ok: true,
      result: "ignored",
    });
  });

  it("cleanupRpcProxy removes the response handler", () => {
    const { channel, handlers } = createMockChannel();
    const proxy = createRpcProxy("memory", ["read"], channel);

    expect(handlers).toHaveLength(1);
    cleanupRpcProxy(proxy);
    expect(handlers).toHaveLength(0);
  });

  it("cleanupRpcProxy is a no-op for non-proxy objects", () => {
    // Should not throw
    cleanupRpcProxy(null);
    cleanupRpcProxy({});
    cleanupRpcProxy({ __cleanup: "not a function" });
  });
});

// ---------------------------------------------------------------------------
// createRpcDispatcher
// ---------------------------------------------------------------------------

describe("createRpcDispatcher", () => {
  it("routes a request to the correct service and method", async () => {
    const mockRead = jest.fn().mockResolvedValue([{ id: "1" }]);
    const responses = [];
    const dispatch = createRpcDispatcher(
      { memory: { read: mockRead } },
      (r) => responses.push(r),
    );

    dispatch({
      type: "rpc_request",
      rpcId: "rpc_1",
      service: "memory",
      method: "read",
      args: ["query", { limit: 10 }],
    });

    // Let the async dispatch settle
    await new Promise((r) => setTimeout(r, 10));

    expect(mockRead).toHaveBeenCalledWith("query", { limit: 10 });
    expect(responses).toHaveLength(1);
    expect(responses[0]).toEqual({
      type: "rpc_response",
      rpcId: "rpc_1",
      ok: true,
      result: [{ id: "1" }],
    });
  });

  it("returns error response for unknown service", async () => {
    const responses = [];
    const dispatch = createRpcDispatcher({}, (r) => responses.push(r));

    dispatch({
      type: "rpc_request",
      rpcId: "rpc_2",
      service: "nonexistent",
      method: "read",
      args: [],
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(responses).toHaveLength(1);
    expect(responses[0].ok).toBe(false);
    expect(responses[0].error).toContain("unknown service");
  });

  it("returns error response for unknown method", async () => {
    const responses = [];
    const dispatch = createRpcDispatcher(
      { memory: { read: jest.fn() } },
      (r) => responses.push(r),
    );

    dispatch({
      type: "rpc_request",
      rpcId: "rpc_3",
      service: "memory",
      method: "delete",
      args: [],
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(responses).toHaveLength(1);
    expect(responses[0].ok).toBe(false);
    expect(responses[0].error).toContain("unknown method");
  });

  it("propagates errors with preserved error type", async () => {
    const error = new Error("forbidden path /etc/shadow");
    error.name = "PluginPermissionError";
    const mockRead = jest.fn().mockRejectedValue(error);
    const responses = [];
    const dispatch = createRpcDispatcher(
      { filesystem: { read: mockRead } },
      (r) => responses.push(r),
    );

    dispatch({
      type: "rpc_request",
      rpcId: "rpc_4",
      service: "filesystem",
      method: "read",
      args: ["/etc/shadow"],
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(responses).toHaveLength(1);
    expect(responses[0].ok).toBe(false);
    expect(responses[0].error).toBe("forbidden path /etc/shadow");
    expect(responses[0].errorType).toBe("PluginPermissionError");
  });

  it("handles non-Error thrown values", async () => {
    const mockMethod = jest.fn().mockRejectedValue("string error");
    const responses = [];
    const dispatch = createRpcDispatcher(
      { memory: { read: mockMethod } },
      (r) => responses.push(r),
    );

    dispatch({
      type: "rpc_request",
      rpcId: "rpc_5",
      service: "memory",
      method: "read",
      args: [],
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(responses).toHaveLength(1);
    expect(responses[0].ok).toBe(false);
    expect(responses[0].error).toBe("string error");
    expect(responses[0].errorType).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Round-trip: proxy <-> dispatcher
// ---------------------------------------------------------------------------

describe("round-trip: proxy <-> dispatcher", () => {
  it("completes a full call through proxy -> dispatcher -> proxy resolution", async () => {
    // Simulate two in-memory message channels
    const proxyToDispatcher = [];
    const dispatcherToProxy = [];
    const proxyHandlers = [];

    /** @type {import("../dist/index.js").RpcChannel} */
    const proxyChannel = {
      postMessage(msg) {
        proxyToDispatcher.push(msg);
      },
      onResponse(handler) {
        proxyHandlers.push(handler);
        return () => {
          const idx = proxyHandlers.indexOf(handler);
          if (idx >= 0) proxyHandlers.splice(idx, 1);
        };
      },
    };

    const mockRead = jest.fn().mockResolvedValue([{ text: "result" }]);
    const mockWrite = jest.fn().mockResolvedValue({ id: "mem_1" });

    const dispatch = createRpcDispatcher(
      { memory: { read: mockRead, write: mockWrite } },
      (response) => {
        // Simulate: dispatcher sends response back to proxy
        for (const h of proxyHandlers) h(response);
      },
    );

    const proxy = createRpcProxy("memory", ["read", "write"], proxyChannel);

    // Call proxy.read — it posts to proxyToDispatcher
    const readPromise = proxy.read("search query", { namespace: "ns1" });

    // Feed the request to the dispatcher
    expect(proxyToDispatcher).toHaveLength(1);
    dispatch(proxyToDispatcher[0]);

    const result = await readPromise;
    expect(result).toEqual([{ text: "result" }]);
    expect(mockRead).toHaveBeenCalledWith("search query", { namespace: "ns1" });
  });

  it("propagates errors end-to-end through the bridge", async () => {
    const proxyHandlers = [];
    const requests = [];

    const proxyChannel = {
      postMessage(msg) {
        requests.push(msg);
      },
      onResponse(handler) {
        proxyHandlers.push(handler);
        return () => {
          const idx = proxyHandlers.indexOf(handler);
          if (idx >= 0) proxyHandlers.splice(idx, 1);
        };
      },
    };

    const permError = new Error("plugin test-plugin is missing permission \"filesystem.write\"");
    permError.name = "PluginPermissionError";
    const mockWrite = jest.fn().mockRejectedValue(permError);

    const dispatch = createRpcDispatcher(
      { filesystem: { write: mockWrite } },
      (response) => {
        for (const h of proxyHandlers) h(response);
      },
    );

    const proxy = createRpcProxy("filesystem", ["write"], proxyChannel);
    const writePromise = proxy.write("/forbidden/path", "content");

    dispatch(requests[0]);

    await expect(writePromise).rejects.toThrow(
      "plugin test-plugin is missing permission \"filesystem.write\"",
    );

    try {
      await writePromise;
    } catch (e) {
      expect(e.name).toBe("PluginPermissionError");
    }
  });

  it("handles multiple services through a single dispatcher", async () => {
    const proxyHandlers = [];
    const requests = [];

    const proxyChannel = {
      postMessage(msg) {
        requests.push(msg);
      },
      onResponse(handler) {
        proxyHandlers.push(handler);
        return () => {
          const idx = proxyHandlers.indexOf(handler);
          if (idx >= 0) proxyHandlers.splice(idx, 1);
        };
      },
    };

    const dispatch = createRpcDispatcher(
      {
        memory: { read: jest.fn().mockResolvedValue([]) },
        session: { read: jest.fn().mockResolvedValue([{ msg: "hi" }]) },
        network: { fetch: jest.fn().mockResolvedValue({ status: 200, body: "ok" }) },
      },
      (response) => {
        for (const h of proxyHandlers) h(response);
      },
    );

    const memory = createRpcProxy("memory", ["read"], proxyChannel);
    const session = createRpcProxy("session", ["read"], proxyChannel);
    const network = createRpcProxy("network", ["fetch"], proxyChannel);

    const p1 = memory.read("q");
    const p2 = session.read("key");
    const p3 = network.fetch("https://example.com");

    // Dispatch all three
    for (const req of requests) dispatch(req);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toEqual([]);
    expect(r2).toEqual([{ msg: "hi" }]);
    expect(r3).toEqual({ status: 200, body: "ok" });
  });
});
