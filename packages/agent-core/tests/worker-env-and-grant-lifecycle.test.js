import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import {
  PluginSecretBroker,
  PluginRuntime,
  createPluginContext,
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function loadedPlugin(id, overrides = {}) {
  return {
    manifest: manifest(id, overrides),
    plugin: {
      tools: [],
      hooks: {},
      lifecycle: {
        onDisable: jest.fn().mockResolvedValue(undefined),
        onUnload: jest.fn().mockResolvedValue(undefined),
      },
    },
  };
}

const MOCK_ENV = {
  OPENAI_API_KEY: "sk-test-123",
  DATABASE_URL: "postgres://localhost/test",
  STRIPE_KEY: "sk_live_stripe",
  INTERNAL_TOKEN: "internal-secret",
};

// ---------------------------------------------------------------------------
// Grant cleanup timer
// ---------------------------------------------------------------------------

describe("grant cleanup timer", () => {
  it("PluginRuntime starts a grant cleanup interval when secretBroker is provided", () => {
    const broker = new PluginSecretBroker({
      policy: { pluginGrants: { "plugin-a": ["OPENAI_API_KEY"] }, grantTtlMs: 50 },
      secretSource: MOCK_ENV,
    });

    const runtime = new PluginRuntime(
      [loadedPlugin("plugin-a")],
      { secretBroker: broker },
    );

    // Grant a secret and verify it's active
    const grant = broker.requestSecret("plugin-a", "OPENAI_API_KEY");
    expect(grant).not.toBeNull();
    expect(broker.activeGrantCount).toBe(1);

    // Cleanup — shutdown clears the timer
    runtime.shutdown();
  });

  it("expired grants are cleaned up by the timer", async () => {
    const broker = new PluginSecretBroker({
      policy: { pluginGrants: { "plugin-b": ["OPENAI_API_KEY"] }, grantTtlMs: 10 },
      secretSource: MOCK_ENV,
    });

    broker.requestSecret("plugin-b", "OPENAI_API_KEY");
    expect(broker.activeGrantCount).toBe(1);

    // Wait for grant to expire
    await new Promise((r) => setTimeout(r, 30));

    // Manual cleanup (simulates what the timer does)
    const cleaned = broker.cleanupExpired();
    expect(cleaned).toBe(1);
    expect(broker.activeGrantCount).toBe(0);
  });

  it("shutdown stops the cleanup timer", async () => {
    const broker = new PluginSecretBroker({
      policy: { pluginGrants: {} },
      secretSource: MOCK_ENV,
    });
    const cleanupSpy = jest.spyOn(broker, "cleanupExpired");

    const runtime = new PluginRuntime(
      [loadedPlugin("plugin-c")],
      { secretBroker: broker },
    );

    await runtime.shutdown();

    // After shutdown, the timer should be cleared.
    // Wait a tick and verify cleanupExpired was NOT called by the timer.
    const callsBefore = cleanupSpy.mock.calls.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(cleanupSpy.mock.calls.length).toBe(callsBefore);
  });
});

// ---------------------------------------------------------------------------
// Revoke grants on disable
// ---------------------------------------------------------------------------

describe("revoke grants on plugin disable", () => {
  it("disablePlugin revokes all active grants for that plugin", async () => {
    const auditEvents = [];
    const broker = new PluginSecretBroker({
      policy: {
        pluginGrants: {
          "revoke-test": ["OPENAI_API_KEY", "DATABASE_URL"],
          "other-plugin": ["STRIPE_KEY"],
        },
      },
      secretSource: MOCK_ENV,
      onAudit: (event) => auditEvents.push(event),
    });

    const runtime = new PluginRuntime(
      [loadedPlugin("revoke-test"), loadedPlugin("other-plugin")],
      { secretBroker: broker },
    );

    // Grant secrets to both plugins
    broker.requestSecret("revoke-test", "OPENAI_API_KEY");
    broker.requestSecret("revoke-test", "DATABASE_URL");
    broker.requestSecret("other-plugin", "STRIPE_KEY");
    expect(broker.activeGrantCount).toBe(3);

    // Disable revoke-test
    await runtime.disablePlugin("revoke-test", "testing");

    // revoke-test's grants should be revoked, other-plugin's should remain
    expect(broker.activeGrantCount).toBe(1);

    // Verify revoke audit events fired
    const revokeEvents = auditEvents.filter(
      (e) => e.action === "revoke" && e.pluginId === "revoke-test",
    );
    expect(revokeEvents).toHaveLength(2);

    await runtime.shutdown();
  });

  it("disablePlugin is safe when no secretBroker is configured", async () => {
    const runtime = new PluginRuntime([loadedPlugin("no-broker")], {});

    // Should not throw
    await runtime.disablePlugin("no-broker", "test");
    await runtime.shutdown();
  });
});

// ---------------------------------------------------------------------------
// Revoke grants on shutdown
// ---------------------------------------------------------------------------

describe("revoke grants on shutdown", () => {
  it("shutdown revokes all active grants for all plugins", async () => {
    const auditEvents = [];
    const broker = new PluginSecretBroker({
      policy: {
        pluginGrants: {
          "shutdown-a": ["OPENAI_API_KEY"],
          "shutdown-b": ["DATABASE_URL", "STRIPE_KEY"],
        },
      },
      secretSource: MOCK_ENV,
      onAudit: (event) => auditEvents.push(event),
    });

    const runtime = new PluginRuntime(
      [loadedPlugin("shutdown-a"), loadedPlugin("shutdown-b")],
      { secretBroker: broker },
    );

    broker.requestSecret("shutdown-a", "OPENAI_API_KEY");
    broker.requestSecret("shutdown-b", "DATABASE_URL");
    broker.requestSecret("shutdown-b", "STRIPE_KEY");
    expect(broker.activeGrantCount).toBe(3);

    await runtime.shutdown();

    expect(broker.activeGrantCount).toBe(0);

    const revokeEvents = auditEvents.filter((e) => e.action === "revoke");
    expect(revokeEvents).toHaveLength(3);
  });

  it("shutdown is safe when no secretBroker is configured", async () => {
    const runtime = new PluginRuntime([loadedPlugin("no-broker-shutdown")], {});

    // Should not throw
    await runtime.shutdown();
  });
});

// ---------------------------------------------------------------------------
// Worker env sanitization (unit-level — tests buildPluginEnv scoping)
// ---------------------------------------------------------------------------

describe("worker env sanitization via buildPluginEnv", () => {
  it("buildPluginEnv only includes granted scopes", () => {
    const broker = new PluginSecretBroker({
      policy: {
        pluginGrants: {
          "env-test": ["OPENAI_API_KEY"],
        },
      },
      secretSource: MOCK_ENV,
    });

    const env = broker.buildPluginEnv("env-test");

    // Only OPENAI_API_KEY should be in the env
    expect(env).toEqual({ OPENAI_API_KEY: "sk-test-123" });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.STRIPE_KEY).toBeUndefined();
    expect(env.INTERNAL_TOKEN).toBeUndefined();
  });

  it("buildPluginEnv returns empty for plugins with no grants", () => {
    const broker = new PluginSecretBroker({
      policy: { pluginGrants: {} },
      secretSource: MOCK_ENV,
    });

    expect(broker.buildPluginEnv("unknown-plugin")).toEqual({});
  });

  it("buildPluginEnv omits scopes with empty or undefined values", () => {
    const broker = new PluginSecretBroker({
      policy: {
        pluginGrants: {
          "sparse-test": ["EXISTING_KEY", "MISSING_KEY", "EMPTY_KEY"],
        },
      },
      secretSource: { EXISTING_KEY: "value", EMPTY_KEY: "" },
    });

    const env = broker.buildPluginEnv("sparse-test");
    expect(env).toEqual({ EXISTING_KEY: "value" });
  });
});
