import type { PluginManifest, PluginPermission } from "./types.js";

export class PluginPermissionError extends Error {
  public readonly pluginId: string;
  public readonly permission: PluginPermission;

  public constructor(pluginId: string, permission: PluginPermission) {
    super(`plugin ${pluginId} is missing permission "${permission}"`);
    this.name = "PluginPermissionError";
    this.pluginId = pluginId;
    this.permission = permission;
  }
}

export function hasPluginPermission(
  manifest: PluginManifest,
  permission: PluginPermission,
): boolean {
  return (manifest.permissions ?? []).includes(permission);
}

export function requirePluginPermission(
  manifest: PluginManifest,
  permission: PluginPermission,
): void {
  if (!hasPluginPermission(manifest, permission)) {
    throw new PluginPermissionError(manifest.id, permission);
  }
}
