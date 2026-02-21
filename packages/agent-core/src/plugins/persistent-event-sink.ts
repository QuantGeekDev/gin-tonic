import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { PluginEvent, PluginEventSink } from "./types.js";

const DEFAULT_MAX_EVENTS = 500;

export class FilePluginEventSink implements PluginEventSink {
  private readonly filePath: string;
  private readonly maxEvents: number;
  private readonly events: PluginEvent[] = [];
  private loaded = false;

  public constructor(filePath: string, maxEvents = DEFAULT_MAX_EVENTS) {
    this.filePath = filePath;
    this.maxEvents = maxEvents;
  }

  public emit(event: PluginEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
    this.persistAsync();
  }

  public list(): PluginEvent[] {
    return [...this.events];
  }

  public async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    try {
      const raw = await readFile(this.filePath, "utf8");
      const data = JSON.parse(raw) as PluginEvent[];
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
    } catch (error) {
      const isMissing =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT";
      if (!isMissing) {
        throw error;
      }
    }
    this.loaded = true;
  }

  public clear(): void {
    this.events.splice(0, this.events.length);
    this.persistAsync();
  }

  private persistAsync(): void {
    const data = JSON.stringify(this.events, null, 2);
    mkdir(dirname(this.filePath), { recursive: true })
      .then(() => writeFile(this.filePath, data, "utf8"))
      .catch(() => {});
  }
}
