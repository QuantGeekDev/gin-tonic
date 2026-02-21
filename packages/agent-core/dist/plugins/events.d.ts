import type { PluginEvent, PluginEventSink } from "./types.js";
export declare class InMemoryPluginEventSink implements PluginEventSink {
    private readonly events;
    emit(event: PluginEvent): void;
    list(): PluginEvent[];
    clear(): void;
}
//# sourceMappingURL=events.d.ts.map