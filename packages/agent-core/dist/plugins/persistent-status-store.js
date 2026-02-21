import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
export class FilePluginStatusStore {
    filePath;
    statuses = new Map();
    loaded = false;
    constructor(filePath) {
        this.filePath = filePath;
    }
    get(pluginId) {
        return this.statuses.get(pluginId) ?? null;
    }
    list() {
        return [...this.statuses.values()].sort((a, b) => a.pluginId.localeCompare(b.pluginId));
    }
    update(status) {
        this.statuses.set(status.pluginId, status);
        this.persistAsync();
    }
    async load() {
        if (this.loaded) {
            return;
        }
        try {
            const raw = await readFile(this.filePath, "utf8");
            const data = JSON.parse(raw);
            if (Array.isArray(data)) {
                for (const entry of data) {
                    if (entry && typeof entry.pluginId === "string") {
                        this.statuses.set(entry.pluginId, entry);
                    }
                }
            }
        }
        catch (error) {
            const isMissing = typeof error === "object" &&
                error !== null &&
                "code" in error &&
                error.code === "ENOENT";
            if (!isMissing) {
                throw error;
            }
        }
        this.loaded = true;
    }
    persistAsync() {
        const data = JSON.stringify(this.list(), null, 2);
        mkdir(dirname(this.filePath), { recursive: true })
            .then(() => writeFile(this.filePath, data, "utf8"))
            .catch(() => { });
    }
}
//# sourceMappingURL=persistent-status-store.js.map