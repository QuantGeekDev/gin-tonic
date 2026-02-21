import type { PluginContext, PluginFilesystemAccessor, PluginManifest, PluginMemoryAccessor, PluginNetworkAccessor, PluginSessionAccessor } from "./types.js";
export interface PluginContextServices {
    memory?: PluginMemoryAccessor | undefined;
    session?: PluginSessionAccessor | undefined;
    filesystem?: PluginFilesystemAccessor | undefined;
    network?: PluginNetworkAccessor | undefined;
}
export declare function createPluginContext(manifest: PluginManifest, services?: PluginContextServices): PluginContext;
//# sourceMappingURL=context.d.ts.map