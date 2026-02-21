import type { PluginStatusSnapshot, PluginStatusStore } from "./types.js";

export class InMemoryPluginStatusStore implements PluginStatusStore {
  private readonly statuses = new Map<string, PluginStatusSnapshot>();

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
  }
}
