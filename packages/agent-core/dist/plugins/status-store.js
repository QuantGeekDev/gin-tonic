export class InMemoryPluginStatusStore {
    statuses = new Map();
    get(pluginId) {
        return this.statuses.get(pluginId) ?? null;
    }
    list() {
        return [...this.statuses.values()].sort((a, b) => a.pluginId.localeCompare(b.pluginId));
    }
    update(status) {
        this.statuses.set(status.pluginId, status);
    }
}
//# sourceMappingURL=status-store.js.map