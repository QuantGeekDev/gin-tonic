import { type PluginManifest } from "./types.js";
export declare const PLUGIN_MANIFEST_FILENAME = "jihn.plugin.json";
export interface PluginManifestDiskEntry {
    rootDir: string;
    manifestPath: string;
    manifest: PluginManifest;
}
export declare function loadPluginManifest(pluginRootDir: string): Promise<PluginManifestDiskEntry>;
export declare function discoverPluginManifests(options?: {
    workspaceDir?: string;
    pluginsDirectoryName?: string;
}): Promise<PluginManifestDiskEntry[]>;
export declare function parsePluginManifest(input: unknown): PluginManifest;
//# sourceMappingURL=manifest.d.ts.map