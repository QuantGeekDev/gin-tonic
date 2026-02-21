import type { ToolDefinition } from "../tools.js";
export interface McpServerOAuthState {
    clientId?: string;
    clientSecret?: string;
    scope?: string;
    redirectUrl?: string;
    codeVerifier?: string;
    pendingState?: string;
    lastAuthorizationUrl?: string;
    tokenType?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: string;
}
export type McpServerAuth = {
    mode: "none";
} | {
    mode: "bearer";
    token: string;
} | {
    mode: "oauth2";
    oauth: McpServerOAuthState;
};
export interface McpServerConfig {
    id: string;
    url: string;
    name?: string;
    enabled?: boolean;
    headers?: Record<string, string>;
    requestTimeoutMs?: number;
    sessionId?: string;
    auth?: McpServerAuth;
}
export interface McpRegistryOptions {
    servers: McpServerConfig[];
    cacheTtlMs?: number;
    clientName?: string;
    clientVersion?: string;
}
export interface McpServerStateSnapshot {
    id: string;
    name?: string;
    url: string;
    enabled: boolean;
    connected: boolean;
    sessionId?: string;
    lastRefreshAt?: string;
    toolCount: number;
    authMode: "none" | "bearer" | "oauth2";
    authorized: boolean;
    error?: string;
}
export interface McpToolSnapshot {
    exposedName: string;
    serverId: string;
    remoteName: string;
    description: string;
}
export interface McpRegistrySnapshot {
    servers: McpServerStateSnapshot[];
    tools: McpToolSnapshot[];
    generatedAt: string;
}
export interface McpToolResolution {
    toolDefinitions: ToolDefinition[];
}
export interface McpServerInput {
    id: string;
    url: string;
    name?: string;
    enabled?: boolean;
    headers?: Record<string, string>;
    requestTimeoutMs?: number;
    auth?: McpServerAuth;
}
//# sourceMappingURL=types.d.ts.map