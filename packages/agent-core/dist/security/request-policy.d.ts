export declare const AUTH_SCOPE_IDS: {
    readonly AGENT_READ: "agent:read";
    readonly AGENT_WRITE: "agent:write";
    readonly MCP_READ: "mcp:read";
    readonly MCP_WRITE: "mcp:write";
    readonly MEMORY_READ: "memory:read";
    readonly MEMORY_WRITE: "memory:write";
    readonly ADMIN: "admin";
};
export type AuthScopeId = (typeof AUTH_SCOPE_IDS)[keyof typeof AUTH_SCOPE_IDS];
export interface ApiPrincipal {
    tokenId: string;
    scopes: string[];
    tenantId: string;
}
export interface ApiTokenPolicy {
    token: string;
    tokenId?: string;
    tenantId?: string;
    scopes: string[];
}
export interface RequestGuardConfig {
    enabled: boolean;
    allowedOrigins: string[];
    tokens: ApiTokenPolicy[];
    rateLimit: {
        windowMs: number;
        maxRequests: number;
    };
}
export interface AuthorizeRequestInput {
    method: string;
    origin: string | null;
    token: string | null;
    clientKey: string;
    requiredScopes: string[];
    tenantId?: string;
}
export declare class RequestPolicyError extends Error {
    readonly code: "UNAUTHORIZED" | "FORBIDDEN" | "RATE_LIMITED" | "INVALID_ORIGIN";
    readonly statusCode: number;
    readonly details?: Record<string, unknown>;
    constructor(params: {
        code: RequestPolicyError["code"];
        message: string;
        statusCode: number;
        details?: Record<string, unknown>;
    });
}
export declare class InMemoryRateLimiter {
    private readonly windowMs;
    private readonly maxRequests;
    private readonly buckets;
    constructor(windowMs: number, maxRequests: number);
    check(key: string, nowMs?: number): {
        allowed: boolean;
        retryAfterMs?: number;
    };
}
export declare function parseRequestGuardConfigFromEnv(env: Record<string, string | undefined>): RequestGuardConfig;
export declare function authorizeRequest(config: RequestGuardConfig, rateLimiter: InMemoryRateLimiter, input: AuthorizeRequestInput): ApiPrincipal | null;
//# sourceMappingURL=request-policy.d.ts.map