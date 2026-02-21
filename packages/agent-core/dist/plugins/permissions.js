export class PluginPermissionError extends Error {
    pluginId;
    permission;
    constructor(pluginId, permission) {
        super(`plugin ${pluginId} is missing permission "${permission}"`);
        this.name = "PluginPermissionError";
        this.pluginId = pluginId;
        this.permission = permission;
    }
}
export function hasPluginPermission(manifest, permission) {
    return (manifest.permissions ?? []).includes(permission);
}
export function requirePluginPermission(manifest, permission) {
    if (!hasPluginPermission(manifest, permission)) {
        throw new PluginPermissionError(manifest.id, permission);
    }
}
//# sourceMappingURL=permissions.js.map