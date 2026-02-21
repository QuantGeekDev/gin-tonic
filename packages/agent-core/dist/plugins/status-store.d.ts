import type { PluginStatusSnapshot, PluginStatusStore } from "./types.js";
export declare class InMemoryPluginStatusStore implements PluginStatusStore {
    private readonly statuses;
    get(pluginId: string): PluginStatusSnapshot | null;
    list(): PluginStatusSnapshot[];
    update(status: PluginStatusSnapshot): void;
}
//# sourceMappingURL=status-store.d.ts.map