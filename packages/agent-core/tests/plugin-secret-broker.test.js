import { describe, expect, it } from "@jest/globals";

import {
  PluginSecretBroker,
  createPluginContext,
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// VAL-003: Secret leakage tests
// ---------------------------------------------------------------------------

const MOCK_ENV = {
  OPENAI_API_KEY: "sk-test-openai-key-12345",
  ANTHROPIC_API_KEY: "sk-ant-test-key-67890",
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  JIHN_LLM_PROVIDER: "anthropic",
  SECRET_INTERNAL_TOKEN: "internal-only-token",
};

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

describe("VAL-003: secret broker - grant and deny", () => {
  it("denies secret access when plugin has no grants", () => {
    const broker = new PluginSecretBroker({
      policy: { pluginGrants: {} },
      secretSource: MOCK_ENV,
    });
    const grant = broker.requestSecret("untrusted-plugin", "OPENAI_API_KEY");
    expect(grant).toBeNull();
  });

  it("grants secret access when plugin scope matches", () => {
    const broker = new PluginSecretBroker({
      policy: {
        pluginGrants: {
          "trusted-plugin": ["OPENAI_API_KEY"],
        },
      },
      secretSource: MOCK_ENV,
    });
    const grant = broker.requestSecret("trusted-plugin", "OPENAI_API_KEY");
    expect(grant).not.toBeNull();
    expect(grant.value).toBe("sk-test-openai-key-12345");
    expect(grant.pluginId).toBe("trusted-plugin");
    expect(grant.scope).toBe("OPENAI_API_KEY");
    expect(grant.grantId).toMatch(/^sg_/);
  });

  it("denies access to scope not in plugin grants", () => {
    const broker = new PluginSecretBroker({
      policy: {
        pluginGrants: {
          "limited-plugin": ["JIHN_LLM_PROVIDER"],
        },
      },
      secretSource: MOCK_ENV,
    });
    const grant = broker.requestSecret("limited-plugin", "DATABASE_URL");
    expect(grant).toBeNull();
  });

  it("denies access when secret value does not exist", () => {
    const broker = new PluginSecretBroker({
      policy: {
        pluginGrants: {
          "plugin-a": ["NONEXISTENT_KEY"],
        },
      },
      secretSource: MOCK_ENV,
    });
    const grant = broker.requestSecret("plugin-a", "NONEXISTENT_KEY");
    expect(grant).toBeNull();
  });
});

describe("VAL-003: secret broker - grant lifecycle", () => {
  it("grants expire after TTL", () => {
    const broker = new PluginSecretBroker({
      policy: {
        pluginGrants: { "test-plugin": ["OPENAI_API_KEY"] },
        grantTtlMs: 1, // 1ms TTL for testing
      },
      secretSource: MOCK_ENV,
    });

    const grant = broker.requestSecret("test-plugin", "OPENAI_API_KEY");
    expect(grant).not.toBeNull();

    // Wait for expiration
    const startTime = Date.now();
    while (Date.now() - startTime < 5) {
      // spin
    }

    const value = broker.accessGrant("test-plugin", grant.grantId);
    expect(value).toBeNull();
  });

  it("valid grant can be accessed before expiry", () => {
    const broker = new PluginSecretBroker({
      policy: {
        pluginGrants: { "test-plugin": ["OPENAI_API_KEY"] },
        grantTtlMs: 60_000, // 60s TTL
      },
      secretSource: MOCK_ENV,
    });

    const grant = broker.requestSecret("test-plugin", "OPENAI_API_KEY");
    const value = broker.accessGrant("test-plugin", grant.grantId);
    expect(value).toBe("sk-test-openai-key-12345");
  });

  it("grant cannot be accessed by different plugin", () => {
    const broker = new PluginSecretBroker({
      policy: {
        pluginGrants: {
          "plugin-a": ["OPENAI_API_KEY"],
          "plugin-b": ["OPENAI_API_KEY"],
        },
      },
      secretSource: MOCK_ENV,
    });

    const grant = broker.requestSecret("plugin-a", "OPENAI_API_KEY");
    const value = broker.accessGrant("plugin-b", grant.grantId);
    expect(value).toBeNull();
  });

  it("revoked grant cannot be accessed", () => {
    const broker = new PluginSecretBroker({
      policy: {
        pluginGrants: { "test-plugin": ["OPENAI_API_KEY"] },
      },
      secretSource: MOCK_ENV,
    });

    const grant = broker.requestSecret("test-plugin", "OPENAI_API_KEY");
    const revoked = broker.revokeGrant(grant.grantId);
    expect(revoked).toBe(true);

    const value = broker.accessGrant("test-plugin", grant.grantId);
    expect(value).toBeNull();
  });

  it("revokePluginGrants revokes all grants for a plugin", () => {
    const broker = new PluginSecretBroker({
      policy: {
        pluginGrants: {
          "multi-secret": ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
        },
      },
      secretSource: MOCK_ENV,
    });

    broker.requestSecret("multi-secret", "OPENAI_API_KEY");
    broker.requestSecret("multi-secret", "ANTHROPIC_API_KEY");
    expect(broker.activeGrantCount).toBe(2);

    const count = broker.revokePluginGrants("multi-secret");
    expect(count).toBe(2);
    expect(broker.activeGrantCount).toBe(0);
  });
});

describe("VAL-003: no raw secret exposure on default path", () => {
  it("default plugin context secrets accessor denies all requests", () => {
    const ctx = createPluginContext(manifest("default-plugin"), {});
    const value = ctx.secrets.request("OPENAI_API_KEY");
    expect(value).toBeNull();
  });

  it("plugin context without explicit secret service denies access", () => {
    const ctx = createPluginContext(
      manifest("secure-plugin", {
        permissions: ["memory.read", "network.http"],
      }),
      {},
    );
    // Even with other permissions, secrets are denied by default
    expect(ctx.secrets.request("DATABASE_URL")).toBeNull();
    expect(ctx.secrets.request("SECRET_INTERNAL_TOKEN")).toBeNull();
  });
});

describe("VAL-003: only scoped tokens visible", () => {
  it("buildPluginEnv only includes granted scopes", () => {
    const broker = new PluginSecretBroker({
      policy: {
        pluginGrants: {
          "scoped-plugin": ["JIHN_LLM_PROVIDER"],
        },
      },
      secretSource: MOCK_ENV,
    });

    const env = broker.buildPluginEnv("scoped-plugin");
    expect(env.JIHN_LLM_PROVIDER).toBe("anthropic");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.SECRET_INTERNAL_TOKEN).toBeUndefined();
  });

  it("buildPluginEnv returns empty object for unganted plugin", () => {
    const broker = new PluginSecretBroker({
      policy: { pluginGrants: {} },
      secretSource: MOCK_ENV,
    });

    const env = broker.buildPluginEnv("unknown-plugin");
    expect(Object.keys(env)).toHaveLength(0);
  });
});

describe("VAL-003: audit events", () => {
  it("emits audit events for all operations", () => {
    const events = [];
    const broker = new PluginSecretBroker({
      policy: {
        pluginGrants: {
          "audited-plugin": ["OPENAI_API_KEY"],
        },
        grantTtlMs: 60_000,
      },
      secretSource: MOCK_ENV,
      onAudit: (event) => events.push(event),
    });

    // Denied access
    broker.requestSecret("audited-plugin", "DATABASE_URL");
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("deny");
    expect(events[0].reason).toBe("scope_not_granted");

    // Successful grant
    const grant = broker.requestSecret("audited-plugin", "OPENAI_API_KEY");
    expect(events).toHaveLength(2);
    expect(events[1].action).toBe("grant");
    expect(events[1].grantId).toBe(grant.grantId);

    // Access grant
    broker.accessGrant("audited-plugin", grant.grantId);
    expect(events).toHaveLength(3);
    expect(events[2].action).toBe("access");

    // Revoke
    broker.revokeGrant(grant.grantId);
    expect(events).toHaveLength(4);
    expect(events[3].action).toBe("revoke");
  });

  it("emits deny event when non-owner accesses grant", () => {
    const events = [];
    const broker = new PluginSecretBroker({
      policy: {
        pluginGrants: {
          "owner": ["OPENAI_API_KEY"],
        },
      },
      secretSource: MOCK_ENV,
      onAudit: (event) => events.push(event),
    });

    const grant = broker.requestSecret("owner", "OPENAI_API_KEY");
    broker.accessGrant("impostor", grant.grantId);

    const denyEvent = events.find(
      (e) => e.action === "deny" && e.reason === "grant_belongs_to_different_plugin",
    );
    expect(denyEvent).toBeDefined();
    expect(denyEvent.pluginId).toBe("impostor");
  });
});

describe("VAL-003: secret broker with plugin context integration", () => {
  it("plugin context with broker-backed secret accessor can access scoped secrets", () => {
    const broker = new PluginSecretBroker({
      policy: {
        pluginGrants: {
          "context-plugin": ["OPENAI_API_KEY"],
        },
      },
      secretSource: MOCK_ENV,
    });

    // Create a secret accessor backed by the broker
    const secretAccessor = {
      request(scope) {
        const grant = broker.requestSecret("context-plugin", scope);
        return grant?.value ?? null;
      },
    };

    const ctx = createPluginContext(
      manifest("context-plugin", { permissions: ["network.http"] }),
      { secrets: secretAccessor },
    );

    expect(ctx.secrets.request("OPENAI_API_KEY")).toBe("sk-test-openai-key-12345");
    expect(ctx.secrets.request("DATABASE_URL")).toBeNull();
  });
});
