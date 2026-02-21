import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const AUTH_SCOPE_IDS = {
  AGENT_READ: "agent:read",
  AGENT_WRITE: "agent:write",
  MCP_READ: "mcp:read",
  MCP_WRITE: "mcp:write",
  MEMORY_READ: "memory:read",
  MEMORY_WRITE: "memory:write",
  ADMIN: "admin",
} as const;

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

export class RequestPolicyError extends Error {
  public readonly code:
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "RATE_LIMITED"
    | "INVALID_ORIGIN";
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  public constructor(params: {
    code: RequestPolicyError["code"];
    message: string;
    statusCode: number;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = "RequestPolicyError";
    this.code = params.code;
    this.statusCode = params.statusCode;
    if (params.details !== undefined) {
      this.details = params.details;
    }
  }
}

interface RateLimitBucket {
  count: number;
  startedAtMs: number;
}

export class InMemoryRateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly buckets = new Map<string, RateLimitBucket>();

  public constructor(windowMs: number, maxRequests: number) {
    this.windowMs = Math.max(1_000, Math.floor(windowMs));
    this.maxRequests = Math.max(1, Math.floor(maxRequests));
  }

  public check(key: string, nowMs = Date.now()): { allowed: boolean; retryAfterMs?: number } {
    const existing = this.buckets.get(key);
    if (existing === undefined || nowMs - existing.startedAtMs >= this.windowMs) {
      this.buckets.set(key, { count: 1, startedAtMs: nowMs });
      return { allowed: true };
    }

    if (existing.count >= this.maxRequests) {
      return {
        allowed: false,
        retryAfterMs: Math.max(0, existing.startedAtMs + this.windowMs - nowMs),
      };
    }

    existing.count += 1;
    this.buckets.set(key, existing);
    return { allowed: true };
  }
}

function resolveCsv(raw: string | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

const tokenEntrySchema = z
  .string()
  .transform((entry) => {
    const [tokenRaw, scopesRaw, tenantRaw] = entry.split("|");
    const token = (tokenRaw ?? "").trim();
    const scopes =
      scopesRaw !== undefined
        ? scopesRaw
            .split(";")
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
        : [AUTH_SCOPE_IDS.ADMIN];
    const tenantId = (tenantRaw ?? "global").trim() || "global";
    return {
      token,
      scopes,
      tenantId,
    };
  })
  .refine((value) => value.token.length > 0, "token must not be empty");

function safeTokenId(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

function tokenEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function originAllowed(allowedOrigins: string[], requestOrigin: string | null): boolean {
  if (allowedOrigins.length === 0) {
    return true;
  }
  if (requestOrigin === null) {
    return false;
  }
  return allowedOrigins.includes(requestOrigin);
}

function hasScopes(principalScopes: string[], requiredScopes: string[]): boolean {
  if (requiredScopes.length === 0) {
    return true;
  }
  if (principalScopes.includes(AUTH_SCOPE_IDS.ADMIN)) {
    return true;
  }
  return requiredScopes.every((scope) => principalScopes.includes(scope));
}

export function parseRequestGuardConfigFromEnv(
  env: Record<string, string | undefined>,
): RequestGuardConfig {
  const parsedEnv = z
    .object({
      JIHN_API_AUTH_ENABLED: z.string().optional(),
      JIHN_API_ALLOWED_ORIGINS: z.string().optional(),
      JIHN_API_RATE_LIMIT_WINDOW_MS: z.string().optional(),
      JIHN_API_RATE_LIMIT_MAX_REQUESTS: z.string().optional(),
      JIHN_API_TOKENS: z.string().optional(),
    })
    .parse(env);

  const enabled = parsedEnv.JIHN_API_AUTH_ENABLED?.trim() === "1";
  const allowedOrigins = resolveCsv(env.JIHN_API_ALLOWED_ORIGINS);
  const rateLimitWindowMs = z.coerce.number().int().positive().catch(60_000).parse(
    parsedEnv.JIHN_API_RATE_LIMIT_WINDOW_MS ?? "60000",
  );
  const rateLimitMaxRequests = z.coerce.number().int().positive().catch(120).parse(
    parsedEnv.JIHN_API_RATE_LIMIT_MAX_REQUESTS ?? "120",
  );

  const tokens = resolveCsv(parsedEnv.JIHN_API_TOKENS)
    .map((entry) => tokenEntrySchema.safeParse(entry))
    .filter((result) => result.success)
    .map((result) => result.data)
    .map((entry) => ({
      token: entry.token,
      tokenId: safeTokenId(entry.token),
      scopes: entry.scopes,
      tenantId: entry.tenantId,
    }));

  return {
    enabled,
    allowedOrigins,
    tokens,
    rateLimit: {
      windowMs: Number.isFinite(rateLimitWindowMs) && rateLimitWindowMs > 0 ? rateLimitWindowMs : 60_000,
      maxRequests:
        Number.isFinite(rateLimitMaxRequests) && rateLimitMaxRequests > 0
          ? rateLimitMaxRequests
          : 120,
    },
  };
}

function resolveTenant(inputTenantId: string | undefined): string {
  const tenantId = inputTenantId?.trim();
  return tenantId && tenantId.length > 0 ? tenantId : "global";
}

function matchToken(tokens: ApiTokenPolicy[], candidate: string): ApiTokenPolicy | null {
  for (const policy of tokens) {
    if (tokenEquals(policy.token, candidate)) {
      return policy;
    }
  }
  return null;
}

export function authorizeRequest(
  config: RequestGuardConfig,
  rateLimiter: InMemoryRateLimiter,
  input: AuthorizeRequestInput,
): ApiPrincipal | null {
  if (!config.enabled) {
    return null;
  }

  const normalizedOrigin = input.origin?.trim() ?? null;
  if (!originAllowed(config.allowedOrigins, normalizedOrigin)) {
    throw new RequestPolicyError({
      code: "INVALID_ORIGIN",
      statusCode: 403,
      message: "request origin is not allowed",
      details: {
        origin: normalizedOrigin,
      },
    });
  }

  const rateLimit = rateLimiter.check(
    `${input.clientKey}:${input.method.toUpperCase()}`,
  );
  if (!rateLimit.allowed) {
    throw new RequestPolicyError({
      code: "RATE_LIMITED",
      statusCode: 429,
      message: "too many requests",
      details: {
        retryAfterMs: rateLimit.retryAfterMs ?? 0,
      },
    });
  }

  const token = input.token?.trim();
  if (!token || token.length === 0) {
    throw new RequestPolicyError({
      code: "UNAUTHORIZED",
      statusCode: 401,
      message: "missing bearer token",
    });
  }
  const matched = matchToken(config.tokens, token);
  if (matched === null) {
    throw new RequestPolicyError({
      code: "UNAUTHORIZED",
      statusCode: 401,
      message: "invalid bearer token",
    });
  }

  const requestedTenant = resolveTenant(input.tenantId);
  const principalTenant = resolveTenant(matched.tenantId);
  if (principalTenant !== "global" && principalTenant !== requestedTenant) {
    throw new RequestPolicyError({
      code: "FORBIDDEN",
      statusCode: 403,
      message: "token is not allowed for tenant",
      details: {
        tenantId: requestedTenant,
      },
    });
  }

  if (!hasScopes(matched.scopes, input.requiredScopes)) {
    throw new RequestPolicyError({
      code: "FORBIDDEN",
      statusCode: 403,
      message: "missing required scope",
      details: {
        requiredScopes: input.requiredScopes,
      },
    });
  }

  return {
    tokenId: matched.tokenId ?? safeTokenId(matched.token),
    scopes: [...matched.scopes],
    tenantId: principalTenant,
  };
}
