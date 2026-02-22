import { resolve, normalize } from "node:path";
import type {
  PluginCapabilityDenyCallback,
  PluginCapabilityPolicy,
  PluginContext,
  PluginFilesystemAccessor,
  PluginManifest,
  PluginMemoryAccessor,
  PluginNetworkAccessor,
  PluginPermission,
  PluginSessionAccessor,
} from "./types.js";
import {
  PluginPermissionError,
  hasPluginPermission,
} from "./permissions.js";

export interface PluginContextServices {
  memory?: PluginMemoryAccessor | undefined;
  session?: PluginSessionAccessor | undefined;
  filesystem?: PluginFilesystemAccessor | undefined;
  network?: PluginNetworkAccessor | undefined;
  capabilityPolicy?: PluginCapabilityPolicy | undefined;
  onDeny?: PluginCapabilityDenyCallback | undefined;
}

/**
 * Checks whether a resolved path falls under any of the allowed prefix paths.
 */
function isPathAllowed(targetPath: string, allowedPaths: string[]): boolean {
  const resolved = resolve(normalize(targetPath));
  return allowedPaths.some((allowed) => {
    const resolvedAllowed = resolve(normalize(allowed));
    return resolved === resolvedAllowed || resolved.startsWith(resolvedAllowed + "/");
  });
}

/**
 * Extracts the hostname from a URL string for domain allowlist matching.
 */
function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Checks whether a domain matches the allowlist.
 * Supports exact match and suffix match (e.g. "api.example.com" matches "example.com").
 */
function isDomainAllowed(hostname: string, allowedDomains: string[]): boolean {
  const lower = hostname.toLowerCase();
  return allowedDomains.some((domain) => {
    const lowerDomain = domain.toLowerCase();
    return lower === lowerDomain || lower.endsWith("." + lowerDomain);
  });
}

function emitDeny(
  onDeny: PluginCapabilityDenyCallback | undefined,
  pluginId: string,
  permission: PluginPermission,
  operation: string,
  target: string,
  reason: string,
): never {
  onDeny?.({ pluginId, permission, operation, target, reason });
  throw new PluginPermissionError(pluginId, permission);
}

function createGatedMemoryAccessor(
  pluginId: string,
  manifest: PluginManifest,
  services: PluginContextServices,
): PluginMemoryAccessor {
  const inner = services.memory;
  const policy = services.capabilityPolicy?.memory;
  const onDeny = services.onDeny;
  return {
    async read(query, options) {
      if (!hasPluginPermission(manifest, "memory.read")) {
        emitDeny(onDeny, pluginId, "memory.read", "read", query, "permission_not_declared");
      }
      if (policy?.allowedNamespaces && options?.namespace) {
        if (!policy.allowedNamespaces.includes(options.namespace)) {
          emitDeny(onDeny, pluginId, "memory.read", "read", options.namespace, "namespace_not_allowed");
        }
      }
      if (!inner) {
        throw new Error("memory service not available");
      }
      return inner.read(query, options);
    },
    async write(text, options) {
      if (!hasPluginPermission(manifest, "memory.write")) {
        emitDeny(onDeny, pluginId, "memory.write", "write", text, "permission_not_declared");
      }
      if (policy?.allowedNamespaces && options?.namespace) {
        if (!policy.allowedNamespaces.includes(options.namespace)) {
          emitDeny(onDeny, pluginId, "memory.write", "write", options.namespace, "namespace_not_allowed");
        }
      }
      if (!inner) {
        throw new Error("memory service not available");
      }
      return inner.write(text, options);
    },
  };
}

function createGatedSessionAccessor(
  pluginId: string,
  manifest: PluginManifest,
  services: PluginContextServices,
): PluginSessionAccessor {
  const inner = services.session;
  const policy = services.capabilityPolicy?.session;
  const onDeny = services.onDeny;
  return {
    async read(sessionKey) {
      if (!hasPluginPermission(manifest, "session.read")) {
        emitDeny(onDeny, pluginId, "session.read", "read", sessionKey, "permission_not_declared");
      }
      if (policy?.allowedSessionPatterns) {
        const allowed = policy.allowedSessionPatterns.some((pattern) =>
          sessionKey.startsWith(pattern),
        );
        if (!allowed) {
          emitDeny(onDeny, pluginId, "session.read", "read", sessionKey, "session_pattern_not_allowed");
        }
      }
      if (!inner) {
        throw new Error("session service not available");
      }
      return inner.read(sessionKey);
    },
    async write(sessionKey, messages) {
      if (!hasPluginPermission(manifest, "session.write")) {
        emitDeny(onDeny, pluginId, "session.write", "write", sessionKey, "permission_not_declared");
      }
      if (policy?.allowedSessionPatterns) {
        const allowed = policy.allowedSessionPatterns.some((pattern) =>
          sessionKey.startsWith(pattern),
        );
        if (!allowed) {
          emitDeny(onDeny, pluginId, "session.write", "write", sessionKey, "session_pattern_not_allowed");
        }
      }
      if (!inner) {
        throw new Error("session service not available");
      }
      return inner.write(sessionKey, messages);
    },
  };
}

function createGatedFilesystemAccessor(
  pluginId: string,
  manifest: PluginManifest,
  services: PluginContextServices,
): PluginFilesystemAccessor {
  const inner = services.filesystem;
  const policy = services.capabilityPolicy?.filesystem;
  const onDeny = services.onDeny;
  return {
    async read(path) {
      if (!hasPluginPermission(manifest, "filesystem.read")) {
        emitDeny(onDeny, pluginId, "filesystem.read", "read", path, "permission_not_declared");
      }
      if (policy?.allowedReadPaths) {
        if (!isPathAllowed(path, policy.allowedReadPaths)) {
          emitDeny(onDeny, pluginId, "filesystem.read", "read", path, "path_not_in_allowlist");
        }
      }
      if (!inner) {
        throw new Error("filesystem service not available");
      }
      return inner.read(path);
    },
    async write(path, content) {
      if (!hasPluginPermission(manifest, "filesystem.write")) {
        emitDeny(onDeny, pluginId, "filesystem.write", "write", path, "permission_not_declared");
      }
      if (policy?.allowedWritePaths) {
        if (!isPathAllowed(path, policy.allowedWritePaths)) {
          emitDeny(onDeny, pluginId, "filesystem.write", "write", path, "path_not_in_allowlist");
        }
      }
      if (!inner) {
        throw new Error("filesystem service not available");
      }
      return inner.write(path, content);
    },
  };
}

function createGatedNetworkAccessor(
  pluginId: string,
  manifest: PluginManifest,
  services: PluginContextServices,
): PluginNetworkAccessor {
  const inner = services.network;
  const policy = services.capabilityPolicy?.network;
  const onDeny = services.onDeny;
  return {
    async fetch(url, init) {
      if (!hasPluginPermission(manifest, "network.http")) {
        emitDeny(onDeny, pluginId, "network.http", "fetch", url, "permission_not_declared");
      }
      if (policy?.allowedDomains) {
        const hostname = extractHostname(url);
        if (!hostname) {
          emitDeny(onDeny, pluginId, "network.http", "fetch", url, "invalid_url");
        } else if (!isDomainAllowed(hostname, policy.allowedDomains)) {
          emitDeny(onDeny, pluginId, "network.http", "fetch", url, "domain_not_in_allowlist");
        }
      }
      if (!inner) {
        throw new Error("network service not available");
      }
      return inner.fetch(url, init);
    },
  };
}

export function createPluginContext(
  manifest: PluginManifest,
  services: PluginContextServices = {},
): PluginContext {
  const pluginId = manifest.id;
  return {
    pluginId,
    permissions: Object.freeze([...(manifest.permissions ?? [])]),
    memory: createGatedMemoryAccessor(pluginId, manifest, services),
    session: createGatedSessionAccessor(pluginId, manifest, services),
    filesystem: createGatedFilesystemAccessor(pluginId, manifest, services),
    network: createGatedNetworkAccessor(pluginId, manifest, services),
    hasPermission(permission: PluginPermission): boolean {
      return hasPluginPermission(manifest, permission);
    },
  };
}
