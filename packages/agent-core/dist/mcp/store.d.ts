import type { McpServerConfig, McpServerInput } from "./types.js";
export declare class McpServerStore {
    private readonly filePath;
    constructor(filePath: string);
    private readFileSafe;
    private writeFileSafe;
    listServers(): Promise<McpServerConfig[]>;
    saveServers(servers: McpServerConfig[]): Promise<void>;
    upsertServer(input: McpServerInput): Promise<McpServerConfig[]>;
    removeServer(serverId: string): Promise<McpServerConfig[]>;
}
//# sourceMappingURL=store.d.ts.map