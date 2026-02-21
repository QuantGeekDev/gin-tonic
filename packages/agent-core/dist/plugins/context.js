import { PluginPermissionError, hasPluginPermission, } from "./permissions.js";
function createGatedMemoryAccessor(pluginId, manifest, services) {
    const inner = services.memory;
    return {
        async read(query, options) {
            if (!hasPluginPermission(manifest, "memory.read")) {
                throw new PluginPermissionError(pluginId, "memory.read");
            }
            if (!inner) {
                throw new Error("memory service not available");
            }
            return inner.read(query, options);
        },
        async write(text, options) {
            if (!hasPluginPermission(manifest, "memory.write")) {
                throw new PluginPermissionError(pluginId, "memory.write");
            }
            if (!inner) {
                throw new Error("memory service not available");
            }
            return inner.write(text, options);
        },
    };
}
function createGatedSessionAccessor(pluginId, manifest, services) {
    const inner = services.session;
    return {
        async read(sessionKey) {
            if (!hasPluginPermission(manifest, "session.read")) {
                throw new PluginPermissionError(pluginId, "session.read");
            }
            if (!inner) {
                throw new Error("session service not available");
            }
            return inner.read(sessionKey);
        },
        async write(sessionKey, messages) {
            if (!hasPluginPermission(manifest, "session.write")) {
                throw new PluginPermissionError(pluginId, "session.write");
            }
            if (!inner) {
                throw new Error("session service not available");
            }
            return inner.write(sessionKey, messages);
        },
    };
}
function createGatedFilesystemAccessor(pluginId, manifest, services) {
    const inner = services.filesystem;
    return {
        async read(path) {
            if (!hasPluginPermission(manifest, "filesystem.read")) {
                throw new PluginPermissionError(pluginId, "filesystem.read");
            }
            if (!inner) {
                throw new Error("filesystem service not available");
            }
            return inner.read(path);
        },
        async write(path, content) {
            if (!hasPluginPermission(manifest, "filesystem.write")) {
                throw new PluginPermissionError(pluginId, "filesystem.write");
            }
            if (!inner) {
                throw new Error("filesystem service not available");
            }
            return inner.write(path, content);
        },
    };
}
function createGatedNetworkAccessor(pluginId, manifest, services) {
    const inner = services.network;
    return {
        async fetch(url, init) {
            if (!hasPluginPermission(manifest, "network.http")) {
                throw new PluginPermissionError(pluginId, "network.http");
            }
            if (!inner) {
                throw new Error("network service not available");
            }
            return inner.fetch(url, init);
        },
    };
}
export function createPluginContext(manifest, services = {}) {
    const pluginId = manifest.id;
    return {
        pluginId,
        permissions: Object.freeze([...(manifest.permissions ?? [])]),
        memory: createGatedMemoryAccessor(pluginId, manifest, services),
        session: createGatedSessionAccessor(pluginId, manifest, services),
        filesystem: createGatedFilesystemAccessor(pluginId, manifest, services),
        network: createGatedNetworkAccessor(pluginId, manifest, services),
        hasPermission(permission) {
            return hasPluginPermission(manifest, permission);
        },
    };
}
//# sourceMappingURL=context.js.map