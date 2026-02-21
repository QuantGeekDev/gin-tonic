import type { PluginEvent, PluginEventSink } from "./types.js";
export declare class FilePluginEventSink implements PluginEventSink {
    private readonly filePath;
    private readonly maxEvents;
    private readonly events;
    private loaded;
    constructor(filePath: string, maxEvents?: number);
    emit(event: PluginEvent): void;
    list(): PluginEvent[];
    load(): Promise<void>;
    clear(): void;
    private persistAsync;
}
//# sourceMappingURL=persistent-event-sink.d.ts.map