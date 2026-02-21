import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { McpServerConfig, McpServerInput } from "./types.js";

interface McpStoreFile {
  servers: McpServerConfig[];
}

function normalizeServer(input: McpServerInput): McpServerConfig {
  return {
    id: input.id.trim(),
    url: input.url.trim(),
    ...(typeof input.name === "string" && input.name.trim().length > 0
      ? { name: input.name.trim() }
      : {}),
    ...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
    ...(input.headers !== undefined ? { headers: input.headers } : {}),
    ...(input.requestTimeoutMs !== undefined
      ? { requestTimeoutMs: Math.floor(input.requestTimeoutMs) }
      : {}),
    ...(input.auth !== undefined ? { auth: input.auth } : {}),
  };
}

export class McpServerStore {
  private readonly filePath: string;

  public constructor(filePath: string) {
    this.filePath = resolve(filePath);
  }

  private async readFileSafe(): Promise<McpStoreFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        Array.isArray((parsed as { servers?: unknown }).servers)
      ) {
        const servers = ((parsed as { servers: unknown[] }).servers ?? [])
          .filter(
            (entry): entry is McpServerConfig =>
              typeof entry === "object" && entry !== null,
          )
          .map((entry) => ({
            ...entry,
            id: String(entry.id ?? "").trim(),
            url: String(entry.url ?? "").trim(),
          }))
          .filter((entry) => entry.id.length > 0 && entry.url.length > 0);
        return { servers };
      }
      return { servers: [] };
    } catch {
      return { servers: [] };
    }
  }

  private async writeFileSafe(data: McpStoreFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  public async listServers(): Promise<McpServerConfig[]> {
    const file = await this.readFileSafe();
    return file.servers;
  }

  public async saveServers(servers: McpServerConfig[]): Promise<void> {
    await this.writeFileSafe({ servers });
  }

  public async upsertServer(input: McpServerInput): Promise<McpServerConfig[]> {
    const next = normalizeServer(input);
    const file = await this.readFileSafe();
    const others = file.servers.filter((server) => server.id !== next.id);
    const servers = [...others, next].sort((a, b) => a.id.localeCompare(b.id));
    await this.writeFileSafe({ servers });
    return servers;
  }

  public async removeServer(serverId: string): Promise<McpServerConfig[]> {
    const file = await this.readFileSafe();
    const servers = file.servers.filter((server) => server.id !== serverId);
    await this.writeFileSafe({ servers });
    return servers;
  }
}
