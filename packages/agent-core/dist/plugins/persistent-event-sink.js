import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
const DEFAULT_MAX_EVENTS = 500;
export class FilePluginEventSink {
    filePath;
    maxEvents;
    events = [];
    loaded = false;
    constructor(filePath, maxEvents = DEFAULT_MAX_EVENTS) {
        this.filePath = filePath;
        this.maxEvents = maxEvents;
    }
    emit(event) {
        this.events.push(event);
        if (this.events.length > this.maxEvents) {
            this.events.splice(0, this.events.length - this.maxEvents);
        }
        this.persistAsync();
    }
    list() {
        return [...this.events];
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
                    if (entry && typeof entry.timestamp === "string" && typeof entry.name === "string") {
                        this.events.push(entry);
                    }
                }
                if (this.events.length > this.maxEvents) {
                    this.events.splice(0, this.events.length - this.maxEvents);
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
    clear() {
        this.events.splice(0, this.events.length);
        this.persistAsync();
    }
    persistAsync() {
        const data = JSON.stringify(this.events, null, 2);
        mkdir(dirname(this.filePath), { recursive: true })
            .then(() => writeFile(this.filePath, data, "utf8"))
            .catch(() => { });
    }
}
//# sourceMappingURL=persistent-event-sink.js.map