import { describe, expect, it } from "@jest/globals";

import {
  resolvePluginExecutionMode,
  DEFAULT_ISOLATION_POLICY,
} from "../dist/plugins/isolation/policy.js";

import {
  resolveIsolationPolicyFromEnv,
  resolveCapabilityPolicyFromEnv,
  validateIsolationSetting,
  PLUGIN_ISOLATION_ENV_KEYS,
} from "../dist/plugins/isolation/settings.js";

/** Helper to build a minimal manifest for policy tests. */
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

// ---------------------------------------------------------------------------
// VAL-001: Unit tests for mode resolution policy
// ---------------------------------------------------------------------------

describe("VAL-001: mode resolution policy", () => {
  describe("default resolution", () => {
    it("absent executionMode resolves to worker_thread", () => {
      const result = resolvePluginExecutionMode(manifest("test"));
      expect(result.effectiveMode).toBe("worker_thread");
      expect(result.denied).toBe(false);
      expect(result.reasons.some((r) => r.includes("default_applied"))).toBe(true);
    });

    it("explicit worker_thread is preserved", () => {
      const result = resolvePluginExecutionMode(
        manifest("test", { executionMode: "worker_thread" }),
      );
      expect(result.effectiveMode).toBe("worker_thread");
      expect(result.denied).toBe(false);
    });

    it("explicit external_process is preserved", () => {
      const result = resolvePluginExecutionMode(
        manifest("test", { executionMode: "external_process" }),
      );
      expect(result.effectiveMode).toBe("external_process");
      expect(result.denied).toBe(false);
    });

    it("explicit container is preserved", () => {
      const result = resolvePluginExecutionMode(
        manifest("test", { executionMode: "container" }),
      );
      expect(result.effectiveMode).toBe("container");
      expect(result.denied).toBe(false);
    });
  });

  describe("in_process allowlist", () => {
    // Use a policy where trust tier allows in_process so the allowlist check fires
    const inProcessPolicy = {
      ...DEFAULT_ISOLATION_POLICY,
      trustTierDefaults: { first_party: "in_process", community: "in_process", verified_partner: "in_process" },
      inProcessAllowlist: [],
    };

    it("in_process denied when not on allowlist", () => {
      const result = resolvePluginExecutionMode(
        manifest("evil-plugin", { executionMode: "in_process" }),
        inProcessPolicy,
      );
      expect(result.denied).toBe(true);
      expect(result.reasons.some((r) => r.includes("in_process_denied"))).toBe(true);
    });

    it("in_process allowed when on allowlist", () => {
      const policy = {
        ...inProcessPolicy,
        inProcessAllowlist: ["trusted-plugin"],
      };
      const result = resolvePluginExecutionMode(
        manifest("trusted-plugin", { executionMode: "in_process" }),
        policy,
      );
      expect(result.effectiveMode).toBe("in_process");
      expect(result.denied).toBe(false);
      expect(result.reasons.some((r) => r.includes("in_process_allowed"))).toBe(true);
    });

    it("in_process denied for different plugin even with allowlist", () => {
      const policy = {
        ...inProcessPolicy,
        inProcessAllowlist: ["trusted-plugin"],
      };
      const result = resolvePluginExecutionMode(
        manifest("other-plugin", { executionMode: "in_process" }),
        policy,
      );
      expect(result.denied).toBe(true);
    });

    it("default policy elevates community in_process to worker_thread (trust tier override)", () => {
      // With default policy, community trust tier defaults to worker_thread,
      // so in_process is elevated before allowlist check
      const result = resolvePluginExecutionMode(
        manifest("community-plugin", { executionMode: "in_process" }),
      );
      expect(result.effectiveMode).toBe("worker_thread");
      expect(result.denied).toBe(false);
      expect(result.reasons.some((r) => r.includes("trust_tier_elevated"))).toBe(true);
    });
  });

  describe("trust tier defaults", () => {
    it("community plugin with no mode uses policy default", () => {
      const result = resolvePluginExecutionMode(
        manifest("community-plugin", { trustTier: "community" }),
      );
      expect(result.effectiveMode).toBe("worker_thread");
      expect(result.denied).toBe(false);
    });

    it("community trust tier elevates from in_process to worker_thread", () => {
      const policy = {
        ...DEFAULT_ISOLATION_POLICY,
        inProcessAllowlist: ["community-plugin"],
        trustTierDefaults: {
          first_party: "in_process",
          community: "worker_thread",
        },
      };
      const result = resolvePluginExecutionMode(
        manifest("community-plugin", {
          executionMode: "in_process",
          trustTier: "community",
        }),
        policy,
      );
      // Trust tier elevates from in_process to worker_thread
      expect(result.effectiveMode).toBe("worker_thread");
      expect(result.denied).toBe(false);
    });

    it("first_party with low tier default keeps requested mode", () => {
      const policy = {
        ...DEFAULT_ISOLATION_POLICY,
        inProcessAllowlist: ["first-party-plugin"],
        trustTierDefaults: {
          first_party: "in_process",
          community: "container",
        },
      };
      const result = resolvePluginExecutionMode(
        manifest("first-party-plugin", {
          executionMode: "worker_thread",
          trustTier: "first_party",
        }),
        policy,
      );
      // worker_thread is stronger than in_process tier default, so no elevation
      expect(result.effectiveMode).toBe("worker_thread");
      expect(result.denied).toBe(false);
    });

    it("missing trustTier defaults to community", () => {
      const result = resolvePluginExecutionMode(manifest("no-tier"));
      // community tier with default policy = worker_thread
      expect(result.effectiveMode).toBe("worker_thread");
    });
  });

  describe("risky permissions elevation", () => {
    it("filesystem.write elevates to risky permission minimum", () => {
      const policy = {
        ...DEFAULT_ISOLATION_POLICY,
        inProcessAllowlist: ["risky-plugin"],
        riskyPermissionMinimumMode: "external_process",
      };
      const result = resolvePluginExecutionMode(
        manifest("risky-plugin", {
          executionMode: "in_process",
          permissions: ["filesystem.write"],
        }),
        policy,
      );
      expect(result.effectiveMode).toBe("external_process");
      expect(result.denied).toBe(false);
      expect(result.reasons.some((r) => r.includes("risky_permissions_elevated"))).toBe(true);
    });

    it("network.http elevates to risky permission minimum", () => {
      const policy = {
        ...DEFAULT_ISOLATION_POLICY,
        riskyPermissionMinimumMode: "container",
      };
      const result = resolvePluginExecutionMode(
        manifest("net-plugin", {
          permissions: ["network.http"],
        }),
        policy,
      );
      expect(result.effectiveMode).toBe("container");
    });

    it("non-risky permissions do not trigger elevation", () => {
      const policy = {
        ...DEFAULT_ISOLATION_POLICY,
        riskyPermissionMinimumMode: "container",
      };
      const result = resolvePluginExecutionMode(
        manifest("safe-plugin", {
          permissions: ["memory.read", "session.read"],
        }),
        policy,
      );
      expect(result.effectiveMode).toBe("worker_thread");
    });

    it("untrusted + risky permissions cannot resolve to in_process", () => {
      const policy = {
        ...DEFAULT_ISOLATION_POLICY,
        inProcessAllowlist: ["risky"],
        riskyPermissionMinimumMode: "worker_thread",
      };
      const result = resolvePluginExecutionMode(
        manifest("risky", {
          executionMode: "in_process",
          trustTier: "community",
          permissions: ["filesystem.write"],
        }),
        policy,
      );
      // Even though on allowlist, risky permissions elevate to worker_thread
      expect(result.effectiveMode).toBe("worker_thread");
      expect(result.denied).toBe(false);
    });
  });

  describe("mode strength ordering (never downgrade)", () => {
    it("container requested is not downgraded by lower tier default", () => {
      const policy = {
        ...DEFAULT_ISOLATION_POLICY,
        trustTierDefaults: { first_party: "in_process" },
      };
      const result = resolvePluginExecutionMode(
        manifest("strong", {
          executionMode: "container",
          trustTier: "first_party",
        }),
        policy,
      );
      expect(result.effectiveMode).toBe("container");
    });

    it("external_process is not downgraded by lower risky minimum", () => {
      const policy = {
        ...DEFAULT_ISOLATION_POLICY,
        riskyPermissionMinimumMode: "worker_thread",
      };
      const result = resolvePluginExecutionMode(
        manifest("strong", {
          executionMode: "external_process",
          permissions: ["filesystem.write"],
        }),
        policy,
      );
      expect(result.effectiveMode).toBe("external_process");
    });
  });

  describe("composite scenarios (trust x permissions x allowlist)", () => {
    it("community + filesystem.write + no allowlist => denied at in_process, elevated otherwise", () => {
      const policy = {
        ...DEFAULT_ISOLATION_POLICY,
        riskyPermissionMinimumMode: "external_process",
        trustTierDefaults: { community: "worker_thread" },
      };
      const result = resolvePluginExecutionMode(
        manifest("combo", {
          trustTier: "community",
          permissions: ["filesystem.write", "memory.read"],
        }),
        policy,
      );
      // worker_thread from default -> elevated to external_process by risky perms
      expect(result.effectiveMode).toBe("external_process");
      expect(result.denied).toBe(false);
    });

    it("first_party + in_process + allowlisted + no risky perms => in_process allowed", () => {
      const policy = {
        ...DEFAULT_ISOLATION_POLICY,
        inProcessAllowlist: ["fp-safe"],
        trustTierDefaults: { first_party: "in_process" },
      };
      const result = resolvePluginExecutionMode(
        manifest("fp-safe", {
          executionMode: "in_process",
          trustTier: "first_party",
          permissions: ["memory.read"],
        }),
        policy,
      );
      expect(result.effectiveMode).toBe("in_process");
      expect(result.denied).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// VAL-001 extension: settings resolution tests
// ---------------------------------------------------------------------------

describe("VAL-001: isolation policy settings resolution", () => {
  it("resolves default policy from empty env", () => {
    const policy = resolveIsolationPolicyFromEnv({});
    expect(policy.defaultMode).toBe("worker_thread");
    expect(policy.inProcessAllowlist).toEqual([]);
    expect(policy.riskyPermissionMinimumMode).toBe("worker_thread");
  });

  it("resolves custom default mode from env", () => {
    const policy = resolveIsolationPolicyFromEnv({
      JIHN_PLUGIN_DEFAULT_MODE: "external_process",
    });
    expect(policy.defaultMode).toBe("external_process");
  });

  it("resolves in-process allowlist from env", () => {
    const policy = resolveIsolationPolicyFromEnv({
      JIHN_PLUGIN_IN_PROCESS_ALLOWLIST: "plugin-a, plugin-b , plugin-c",
    });
    expect(policy.inProcessAllowlist).toEqual(["plugin-a", "plugin-b", "plugin-c"]);
  });

  it("resolves risky permission minimum from env", () => {
    const policy = resolveIsolationPolicyFromEnv({
      JIHN_PLUGIN_RISKY_PERMISSION_MIN_MODE: "container",
    });
    expect(policy.riskyPermissionMinimumMode).toBe("container");
  });

  it("ignores invalid execution mode in env", () => {
    const policy = resolveIsolationPolicyFromEnv({
      JIHN_PLUGIN_DEFAULT_MODE: "invalid_mode",
    });
    expect(policy.defaultMode).toBe("worker_thread");
  });

  it("resolves capability policy from env", () => {
    const policy = resolveCapabilityPolicyFromEnv({
      JIHN_PLUGIN_NETWORK_ALLOWED_DOMAINS: "api.example.com,cdn.example.com",
      JIHN_PLUGIN_FS_ALLOWED_READ_PATHS: "/data,/config",
      JIHN_PLUGIN_FS_ALLOWED_WRITE_PATHS: "/tmp/plugins",
    });
    expect(policy).not.toBeUndefined();
    expect(policy.network.allowedDomains).toEqual(["api.example.com", "cdn.example.com"]);
    expect(policy.filesystem.allowedReadPaths).toEqual(["/data", "/config"]);
    expect(policy.filesystem.allowedWritePaths).toEqual(["/tmp/plugins"]);
  });

  it("returns undefined capability policy when no env vars set", () => {
    const policy = resolveCapabilityPolicyFromEnv({});
    expect(policy).toBeUndefined();
  });
});

describe("VAL-001: setting validation", () => {
  it("validates execution mode setting", () => {
    expect(validateIsolationSetting(PLUGIN_ISOLATION_ENV_KEYS.defaultMode, "worker_thread")).toBe("worker_thread");
    expect(validateIsolationSetting(PLUGIN_ISOLATION_ENV_KEYS.defaultMode, " Container ")).toBe("container");
    expect(() => validateIsolationSetting(PLUGIN_ISOLATION_ENV_KEYS.defaultMode, "invalid")).toThrow("invalid execution mode");
  });

  it("validates comma-separated list settings", () => {
    expect(validateIsolationSetting(PLUGIN_ISOLATION_ENV_KEYS.inProcessAllowlist, "a, b, c")).toBe("a,b,c");
    expect(validateIsolationSetting(PLUGIN_ISOLATION_ENV_KEYS.networkAllowedDomains, " example.com ")).toBe("example.com");
  });

  it("rejects unknown setting keys", () => {
    expect(() => validateIsolationSetting("UNKNOWN_KEY", "value")).toThrow("unknown plugin isolation setting key");
  });
});
