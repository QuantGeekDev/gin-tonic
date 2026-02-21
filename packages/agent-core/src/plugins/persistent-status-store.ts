import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { PluginStatusSnapshot, PluginStatusStore } from "./types.js";

export class FilePluginStatusStore implements PluginStatusStore {
  private readonly filePath: string;
  private readonly statuses = new Map<string, PluginStatusSnapshot>();
  private loaded = false;

  public constructor(filePath: string) {
    this.filePath = filePath;
  }

  public get(pluginId: string): PluginStatusSnapshot | null {
    return this.statuses.get(pluginId) ?? null;
  }

  public list(): PluginStatusSnapshot[] {
    return [...this.statuses.values()].sort((a, b) =>
      a.pluginId.localeCompare(b.pluginId),
    );
  }

  public update(status: PluginStatusSnapshot): void {
    this.statuses.set(status.pluginId, status);
    this.persistAsync();
  }

  public async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    try {
      const raw = await readFile(this.filePath, "utf8");
      const data = JSON.parse(raw) as PluginStatusSnapshot[];
      if (Array.isArray(data)) {
        for (const entry of data) {
          if (entry && typeof entry.pluginId === "string") {
            this.statuses.set(entry.pluginId, entry);
          }
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

  private persistAsync(): void {
    const data = JSON.stringify(this.list(), null, 2);
    mkdir(dirname(this.filePath), { recursive: true })
      .then(() => writeFile(this.filePath, data, "utf8"))
      .catch(() => {});
  }
}
