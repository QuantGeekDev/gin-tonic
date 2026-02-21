import { auth, type AuthResult } from "@modelcontextprotocol/sdk/client/auth.js";
import { McpToolRegistry } from "./registry.js";
import { McpServerStore } from "./store.js";
import type { McpRegistrySnapshot, McpServerInput, McpToolResolution } from "./types.js";
interface McpServerManagerInternals {
    authFlow: typeof auth;
}
export interface McpServerManagerOptions {
    store: McpServerStore;
    registry: McpToolRegistry;
    baseUrl: string;
}
export declare class McpServerManager {
    private readonly store;
    private readonly registry;
    private readonly baseUrl;
    private readonly internals;
    constructor(options: McpServerManagerOptions, internals?: Partial<McpServerManagerInternals>);
    initializeFromStore(): Promise<void>;
    addServer(input: McpServerInput): Promise<McpRegistrySnapshot>;
    removeServer(serverId: string): Promise<McpRegistrySnapshot>;
    getSnapshot(forceRefresh?: boolean): Promise<McpRegistrySnapshot>;
    listToolDefinitions(forceRefresh?: boolean): Promise<McpToolResolution>;
    beginOAuth(serverId: string): Promise<{
        authorizationUrl: string;
    }>;
    completeOAuthCallback(code: string, state: string): Promise<{
        serverId: string;
        result: AuthResult;
    }>;
    private createOAuthProvider;
}
export {};
//# sourceMappingURL=manager.d.ts.map