import type { PluginManifest, PluginPermission } from "./types.js";
export declare class PluginPermissionError extends Error {
    readonly pluginId: string;
    readonly permission: PluginPermission;
    constructor(pluginId: string, permission: PluginPermission);
}
export declare function hasPluginPermission(manifest: PluginManifest, permission: PluginPermission): boolean;
export declare function requirePluginPermission(manifest: PluginManifest, permission: PluginPermission): void;
//# sourceMappingURL=permissions.d.ts.map