import { randomBytes } from "node:crypto";

/**
 * Represents a scoped, ephemeral secret grant.
 */
export interface SecretGrant {
  /** Unique grant identifier for auditing. */
  grantId: string;
  /** Plugin that received the grant. */
  pluginId: string;
  /** Logical scope/name of the secret. */
  scope: string;
  /** The secret value. */
  value: string;
  /** When the grant was issued (ISO string). */
  issuedAt: string;
  /** When the grant expires (ISO string). */
  expiresAt: string;
}

/**
 * Audit event for secret broker operations.
 */
export interface SecretBrokerAuditEvent {
  timestamp: string;
  pluginId: string;
  action: "grant" | "deny" | "revoke" | "expired" | "access";
  scope: string;
  grantId?: string;
  reason?: string;
}

export type SecretBrokerAuditCallback = (event: SecretBrokerAuditEvent) => void;

/**
 * Policy that controls which secrets a plugin can access.
 */
export interface SecretBrokerPolicy {
  /**
   * Map of plugin ID to allowed secret scopes.
   * Scopes are logical names (e.g. "OPENAI_API_KEY", "DATABASE_URL").
   */
  pluginGrants: Record<string, string[]>;
  /**
   * Default TTL for secret grants in milliseconds.
   * Default: 5 minutes.
   */
  grantTtlMs?: number;
}

const DEFAULT_GRANT_TTL_MS = 5 * 60_000; // 5 minutes

function nowIso(): string {
  return new Date().toISOString();
}

function generateGrantId(): string {
  return `sg_${Date.now()}_${randomBytes(6).toString("hex")}`;
}

/**
 * Secret broker that issues scoped, short-lived credentials to plugins.
 * Replaces direct process.env inheritance with controlled access.
 */
export class PluginSecretBroker {
  private readonly policy: SecretBrokerPolicy;
  private readonly secretSource: Record<string, string | undefined>;
  private readonly grantTtlMs: number;
  private readonly activeGrants = new Map<string, SecretGrant>();
  private readonly onAudit: SecretBrokerAuditCallback | undefined;

  public constructor(options: {
    policy: SecretBrokerPolicy;
    secretSource?: Record<string, string | undefined>;
    onAudit?: SecretBrokerAuditCallback;
  }) {
    this.policy = options.policy;
    this.secretSource = options.secretSource ?? process.env;
    this.grantTtlMs = options.policy.grantTtlMs ?? DEFAULT_GRANT_TTL_MS;
    this.onAudit = options.onAudit;
  }

  /**
   * Request a secret for a specific scope. Returns a grant if the plugin
   * is authorized, or null if denied.
   */
  public requestSecret(pluginId: string, scope: string): SecretGrant | null {
    const allowedScopes = this.policy.pluginGrants[pluginId];
    if (!allowedScopes || !allowedScopes.includes(scope)) {
      this.onAudit?.({
        timestamp: nowIso(),
        pluginId,
        action: "deny",
        scope,
        reason: "scope_not_granted",
      });
      return null;
    }

    const value = this.secretSource[scope];
    if (value === undefined || value === "") {
      this.onAudit?.({
        timestamp: nowIso(),
        pluginId,
        action: "deny",
        scope,
        reason: "secret_not_available",
      });
      return null;
    }

    const now = Date.now();
    const grant: SecretGrant = {
      grantId: generateGrantId(),
      pluginId,
      scope,
      value,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.grantTtlMs).toISOString(),
    };

    this.activeGrants.set(grant.grantId, grant);

    this.onAudit?.({
      timestamp: grant.issuedAt,
      pluginId,
      action: "grant",
      scope,
      grantId: grant.grantId,
    });

    return grant;
  }

  /**
   * Access a previously granted secret by grant ID.
   * Returns the value if valid and not expired, null otherwise.
   */
  public accessGrant(pluginId: string, grantId: string): string | null {
    const grant = this.activeGrants.get(grantId);
    if (!grant) {
      this.onAudit?.({
        timestamp: nowIso(),
        pluginId,
        action: "deny",
        scope: "unknown",
        grantId,
        reason: "grant_not_found",
      });
      return null;
    }

    if (grant.pluginId !== pluginId) {
      this.onAudit?.({
        timestamp: nowIso(),
        pluginId,
        action: "deny",
        scope: grant.scope,
        grantId,
        reason: "grant_belongs_to_different_plugin",
      });
      return null;
    }

    if (Date.now() > Date.parse(grant.expiresAt)) {
      this.activeGrants.delete(grantId);
      this.onAudit?.({
        timestamp: nowIso(),
        pluginId,
        action: "expired",
        scope: grant.scope,
        grantId,
      });
      return null;
    }

    this.onAudit?.({
      timestamp: nowIso(),
      pluginId,
      action: "access",
      scope: grant.scope,
      grantId,
    });

    return grant.value;
  }

  /**
   * Revoke a specific grant.
   */
  public revokeGrant(grantId: string): boolean {
    const grant = this.activeGrants.get(grantId);
    if (!grant) {
      return false;
    }
    this.activeGrants.delete(grantId);
    this.onAudit?.({
      timestamp: nowIso(),
      pluginId: grant.pluginId,
      action: "revoke",
      scope: grant.scope,
      grantId,
    });
    return true;
  }

  /**
   * Revoke all grants for a specific plugin.
   */
  public revokePluginGrants(pluginId: string): number {
    let count = 0;
    for (const [grantId, grant] of this.activeGrants) {
      if (grant.pluginId === pluginId) {
        this.activeGrants.delete(grantId);
        this.onAudit?.({
          timestamp: nowIso(),
          pluginId,
          action: "revoke",
          scope: grant.scope,
          grantId,
        });
        count += 1;
      }
    }
    return count;
  }

  /**
   * Cleanup expired grants.
   */
  public cleanupExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [grantId, grant] of this.activeGrants) {
      if (now > Date.parse(grant.expiresAt)) {
        this.activeGrants.delete(grantId);
        count += 1;
      }
    }
    return count;
  }

  /**
   * Build a sanitized env object for a plugin runtime.
   * Only includes explicitly granted scopes, no raw host env passthrough.
   */
  public buildPluginEnv(pluginId: string): Record<string, string> {
    const env: Record<string, string> = {};
    const allowedScopes = this.policy.pluginGrants[pluginId] ?? [];
    for (const scope of allowedScopes) {
      const value = this.secretSource[scope];
      if (value !== undefined && value !== "") {
        env[scope] = value;
      }
    }
    return env;
  }

  /**
   * Returns the number of active grants.
   */
  public get activeGrantCount(): number {
    return this.activeGrants.size;
  }
}
