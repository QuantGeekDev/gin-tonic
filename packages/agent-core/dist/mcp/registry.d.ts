import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { McpRegistryOptions, McpRegistrySnapshot, McpServerConfig, McpServerOAuthState, McpToolResolution } from "./types.js";
interface McpClientLike {
    connect(transport: unknown): Promise<void>;
    listTools(params?: {
        cursor?: string;
    }): Promise<{
        tools: unknown[];
        nextCursor?: string | undefined;
    }>;
    callTool(params: {
        name: string;
        arguments?: Record<string, unknown>;
    }): Promise<unknown>;
}
interface CreateMcpRegistryInternals {
    createClient(params: {
        name: string;
        version: string;
    }): McpClientLike;
    createTransport(params: {
        server: McpServerConfig;
        requestInit?: RequestInit;
        authProvider?: OAuthClientProvider;
    }): StreamableHTTPClientTransport;
    now(): Date;
}
export declare class McpToolRegistry {
    private readonly options;
    private readonly serverStates;
    private readonly toolDefinitions;
    private readonly toolRefs;
    private lastRefreshMs;
    private readonly internals;
    private refreshPromise;
    constructor(options: McpRegistryOptions, internals?: Partial<CreateMcpRegistryInternals>);
    setServers(servers: McpServerConfig[]): void;
    getServer(serverId: string): McpServerConfig | undefined;
    listServers(): McpServerConfig[];
    findServerByPendingOAuthState(state: string): McpServerConfig | undefined;
    updateServerOAuthState(serverId: string, oauth: McpServerOAuthState): Promise<void>;
    private buildRequestInit;
    private createAuthProvider;
    private ensureConnected;
    private refreshInternal;
    private ensureFresh;
    listToolDefinitions(options?: {
        forceRefresh?: boolean;
    }): Promise<McpToolResolution>;
    executeTool(exposedName: string, input: Record<string, unknown>): Promise<string>;
    getSnapshot(options?: {
        forceRefresh?: boolean;
    }): Promise<McpRegistrySnapshot>;
}
export declare function isMcpToolName(name: string): boolean;
export {};
//# sourceMappingURL=registry.d.ts.map