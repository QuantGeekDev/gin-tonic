import type { PluginEvent, PluginEventSink } from "./types.js";

const MAX_EVENTS = 200;

export class InMemoryPluginEventSink implements PluginEventSink {
  private readonly events: PluginEvent[] = [];

  public emit(event: PluginEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
  }

  public list(): PluginEvent[] {
    return [...this.events];
  }

  public clear(): void {
    this.events.splice(0, this.events.length);
  }
}
