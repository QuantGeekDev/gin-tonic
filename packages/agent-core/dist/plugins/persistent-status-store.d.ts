import type { PluginStatusSnapshot, PluginStatusStore } from "./types.js";
export declare class FilePluginStatusStore implements PluginStatusStore {
    private readonly filePath;
    private readonly statuses;
    private loaded;
    constructor(filePath: string);
    get(pluginId: string): PluginStatusSnapshot | null;
    list(): PluginStatusSnapshot[];
    update(status: PluginStatusSnapshot): void;
    load(): Promise<void>;
    private persistAsync;
}
//# sourceMappingURL=persistent-status-store.d.ts.map