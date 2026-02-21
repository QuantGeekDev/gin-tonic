import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
function normalizeServer(input) {
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
    filePath;
    constructor(filePath) {
        this.filePath = resolve(filePath);
    }
    async readFileSafe() {
        try {
            const raw = await readFile(this.filePath, "utf8");
            const parsed = JSON.parse(raw);
            if (typeof parsed === "object" &&
                parsed !== null &&
                Array.isArray(parsed.servers)) {
                const servers = (parsed.servers ?? [])
                    .filter((entry) => typeof entry === "object" && entry !== null)
                    .map((entry) => ({
                    ...entry,
                    id: String(entry.id ?? "").trim(),
                    url: String(entry.url ?? "").trim(),
                }))
                    .filter((entry) => entry.id.length > 0 && entry.url.length > 0);
                return { servers };
            }
            return { servers: [] };
        }
        catch {
            return { servers: [] };
        }
    }
    async writeFileSafe(data) {
        await mkdir(dirname(this.filePath), { recursive: true });
        await writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    }
    async listServers() {
        const file = await this.readFileSafe();
        return file.servers;
    }
    async saveServers(servers) {
        await this.writeFileSafe({ servers });
    }
    async upsertServer(input) {
        const next = normalizeServer(input);
        const file = await this.readFileSafe();
        const others = file.servers.filter((server) => server.id !== next.id);
        const servers = [...others, next].sort((a, b) => a.id.localeCompare(b.id));
        await this.writeFileSafe({ servers });
        return servers;
    }
    async removeServer(serverId) {
        const file = await this.readFileSafe();
        const servers = file.servers.filter((server) => server.id !== serverId);
        await this.writeFileSafe({ servers });
        return servers;
    }
}
//# sourceMappingURL=store.js.map