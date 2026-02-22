import type {
  PluginCapabilityPolicy,
  PluginExecutionMode,
  PluginIsolationPolicy,
} from "../types.js";
import { PLUGIN_EXECUTION_MODES } from "../types.js";
import { DEFAULT_ISOLATION_POLICY } from "./policy.js";

/**
 * Environment variable keys for plugin isolation settings.
 */
export const PLUGIN_ISOLATION_ENV_KEYS = {
  defaultMode: "JIHN_PLUGIN_DEFAULT_MODE",
  inProcessAllowlist: "JIHN_PLUGIN_IN_PROCESS_ALLOWLIST",
  riskyPermissionMinMode: "JIHN_PLUGIN_RISKY_PERMISSION_MIN_MODE",
  networkAllowedDomains: "JIHN_PLUGIN_NETWORK_ALLOWED_DOMAINS",
  fsAllowedReadPaths: "JIHN_PLUGIN_FS_ALLOWED_READ_PATHS",
  fsAllowedWritePaths: "JIHN_PLUGIN_FS_ALLOWED_WRITE_PATHS",
} as const;

function parseExecutionMode(raw: string | undefined): PluginExecutionMode | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if ((PLUGIN_EXECUTION_MODES as readonly string[]).includes(normalized)) {
    return normalized as PluginExecutionMode;
  }
  return undefined;
}

function parseCommaSeparated(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Resolves a PluginIsolationPolicy from environment variables.
 * Falls back to DEFAULT_ISOLATION_POLICY for any unset values.
 */
export function resolveIsolationPolicyFromEnv(
  env: Record<string, string | undefined> = process.env,
): PluginIsolationPolicy {
  const defaultMode =
    parseExecutionMode(env[PLUGIN_ISOLATION_ENV_KEYS.defaultMode]) ??
    DEFAULT_ISOLATION_POLICY.defaultMode;

  const inProcessAllowlist =
    parseCommaSeparated(env[PLUGIN_ISOLATION_ENV_KEYS.inProcessAllowlist]);
  const hasAllowlist = inProcessAllowlist.length > 0;

  const riskyPermissionMinimumMode =
    parseExecutionMode(env[PLUGIN_ISOLATION_ENV_KEYS.riskyPermissionMinMode]) ??
    DEFAULT_ISOLATION_POLICY.riskyPermissionMinimumMode;

  return {
    defaultMode,
    inProcessAllowlist: hasAllowlist
      ? inProcessAllowlist
      : DEFAULT_ISOLATION_POLICY.inProcessAllowlist,
    riskyPermissionMinimumMode,
    trustTierDefaults: {
      ...DEFAULT_ISOLATION_POLICY.trustTierDefaults,
    },
  };
}

/**
 * Resolves a PluginCapabilityPolicy from environment variables.
 * Returns undefined if no policy env vars are set, meaning no additional
 * constraints beyond permission checks.
 */
export function resolveCapabilityPolicyFromEnv(
  env: Record<string, string | undefined> = process.env,
): PluginCapabilityPolicy | undefined {
  const networkDomains = parseCommaSeparated(env[PLUGIN_ISOLATION_ENV_KEYS.networkAllowedDomains]);
  const fsReadPaths = parseCommaSeparated(env[PLUGIN_ISOLATION_ENV_KEYS.fsAllowedReadPaths]);
  const fsWritePaths = parseCommaSeparated(env[PLUGIN_ISOLATION_ENV_KEYS.fsAllowedWritePaths]);

  const hasAny =
    networkDomains.length > 0 ||
    fsReadPaths.length > 0 ||
    fsWritePaths.length > 0;

  if (!hasAny) {
    return undefined;
  }

  const policy: PluginCapabilityPolicy = {};

  if (fsReadPaths.length > 0 || fsWritePaths.length > 0) {
    const fsPol: NonNullable<PluginCapabilityPolicy["filesystem"]> = {};
    if (fsReadPaths.length > 0) fsPol.allowedReadPaths = fsReadPaths;
    if (fsWritePaths.length > 0) fsPol.allowedWritePaths = fsWritePaths;
    policy.filesystem = fsPol;
  }

  if (networkDomains.length > 0) {
    policy.network = { allowedDomains: networkDomains };
  }

  return policy;
}

/**
 * Validates a raw string as a plugin isolation setting value.
 * Returns the normalized value or throws with a descriptive error.
 */
export function validateIsolationSetting(
  key: string,
  value: string,
): string {
  const normalized = value.trim();
  switch (key) {
    case PLUGIN_ISOLATION_ENV_KEYS.defaultMode:
    case PLUGIN_ISOLATION_ENV_KEYS.riskyPermissionMinMode: {
      if (!(PLUGIN_EXECUTION_MODES as readonly string[]).includes(normalized.toLowerCase())) {
        throw new Error(
          `invalid execution mode "${normalized}"; expected one of: ${PLUGIN_EXECUTION_MODES.join(", ")}`,
        );
      }
      return normalized.toLowerCase();
    }
    case PLUGIN_ISOLATION_ENV_KEYS.inProcessAllowlist:
    case PLUGIN_ISOLATION_ENV_KEYS.networkAllowedDomains:
    case PLUGIN_ISOLATION_ENV_KEYS.fsAllowedReadPaths:
    case PLUGIN_ISOLATION_ENV_KEYS.fsAllowedWritePaths: {
      // Comma-separated list; validate each entry is non-empty
      const entries = normalized.split(",").map((e) => e.trim()).filter((e) => e.length > 0);
      return entries.join(",");
    }
    default:
      throw new Error(`unknown plugin isolation setting key: ${key}`);
  }
}
