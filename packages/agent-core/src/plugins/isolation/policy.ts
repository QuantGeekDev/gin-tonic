import type {
  PluginExecutionMode,
  PluginIsolationPolicy,
  PluginManifest,
  PluginModeResolution,
  PluginPermission,
  PluginTrustTier,
} from "../types.js";
import {
  EXECUTION_MODE_STRENGTH,
  RISKY_PLUGIN_PERMISSIONS,
} from "../types.js";

/**
 * Default isolation policy.
 * - worker_thread is the default mode (per RFC R1).
 * - No plugins are allowlisted for in_process by default.
 * - Risky permissions require at least worker_thread.
 * - Community plugins default to worker_thread, first-party to worker_thread.
 */
export const DEFAULT_ISOLATION_POLICY: PluginIsolationPolicy = {
  defaultMode: "worker_thread",
  inProcessAllowlist: [],
  riskyPermissionMinimumMode: "worker_thread",
  trustTierDefaults: {
    first_party: "worker_thread",
    verified_partner: "worker_thread",
    community: "worker_thread",
  },
};

function modeStrength(mode: PluginExecutionMode): number {
  return EXECUTION_MODE_STRENGTH[mode];
}

function hasRiskyPermissions(permissions: readonly PluginPermission[]): boolean {
  return permissions.some((p) =>
    (RISKY_PLUGIN_PERMISSIONS as readonly string[]).includes(p),
  );
}

/**
 * Resolves the effective execution mode for a plugin based on its manifest
 * and the operator isolation policy.
 *
 * Resolution order:
 * 1. Start with manifest-declared mode, or policy defaultMode if absent.
 * 2. Apply trust-tier default (elevate if tier requires stronger mode).
 * 3. Apply risky-permission minimum mode (elevate if permissions require it).
 * 4. Check in_process allowlist (deny if resolved to in_process and not allowlisted).
 * 5. Never downgrade from a stronger isolation mode.
 */
export function resolvePluginExecutionMode(
  manifest: PluginManifest,
  policy: PluginIsolationPolicy = DEFAULT_ISOLATION_POLICY,
): PluginModeResolution {
  const reasons: string[] = [];
  const requestedMode = manifest.executionMode;
  const trustTier: PluginTrustTier = manifest.trustTier ?? "community";
  const permissions = manifest.permissions ?? [];

  // Step 1: Start with manifest mode or policy default
  let effective: PluginExecutionMode;
  if (requestedMode !== undefined) {
    effective = requestedMode;
    reasons.push(`manifest_requested=${requestedMode}`);
  } else {
    effective = policy.defaultMode;
    reasons.push(`default_applied=${policy.defaultMode}`);
  }

  // Step 2: Apply trust-tier default (only elevate, never downgrade)
  const tierDefault = policy.trustTierDefaults[trustTier];
  if (tierDefault !== undefined && modeStrength(tierDefault) > modeStrength(effective)) {
    reasons.push(
      `trust_tier_elevated: tier=${trustTier} required=${tierDefault} previous=${effective}`,
    );
    effective = tierDefault;
  }

  // Step 3: Apply risky-permission minimum mode (only elevate)
  if (hasRiskyPermissions(permissions)) {
    const minimum = policy.riskyPermissionMinimumMode;
    if (modeStrength(minimum) > modeStrength(effective)) {
      const riskyPerms = permissions.filter((p) =>
        (RISKY_PLUGIN_PERMISSIONS as readonly string[]).includes(p),
      );
      reasons.push(
        `risky_permissions_elevated: permissions=[${riskyPerms.join(",")}] minimum=${minimum} previous=${effective}`,
      );
      effective = minimum;
    }
  }

  // Step 4: Check in_process allowlist
  if (effective === "in_process") {
    if (!policy.inProcessAllowlist.includes(manifest.id)) {
      reasons.push(
        `in_process_denied: plugin=${manifest.id} not in allowlist`,
      );
      return {
        effectiveMode: effective,
        requestedMode,
        reasons,
        denied: true,
      };
    }
    reasons.push(`in_process_allowed: plugin=${manifest.id} on allowlist`);
  }

  return {
    effectiveMode: effective,
    requestedMode,
    reasons,
    denied: false,
  };
}
