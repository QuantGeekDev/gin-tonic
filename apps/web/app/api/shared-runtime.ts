import {
  AUTH_SCOPE_IDS,
  InMemoryRateLimiter,
  parseRequestGuardConfigFromEnv,
  RequestPolicyError,
  authorizeRequest,
} from "@jihn/agent-core";

export const sharedRequestGuardConfig = parseRequestGuardConfigFromEnv(process.env);
export const sharedRequestRateLimiter = new InMemoryRateLimiter(
  sharedRequestGuardConfig.rateLimit.windowMs,
  sharedRequestGuardConfig.rateLimit.maxRequests,
);

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return null;
  }
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function readClientKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor && forwardedFor.trim().length > 0) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function enforceRequestPolicy(params: {
  request: Request;
  requiredScopes: string[];
  tenantId?: string;
}): void {
  const tenantIdHeader = params.request.headers.get("x-tenant-id")?.trim();
  authorizeRequest(sharedRequestGuardConfig, sharedRequestRateLimiter, {
    method: params.request.method,
    origin: params.request.headers.get("origin"),
    token: readBearerToken(params.request),
    clientKey: readClientKey(params.request),
    requiredScopes: params.requiredScopes,
    ...(params.tenantId !== undefined
      ? { tenantId: params.tenantId }
      : tenantIdHeader && tenantIdHeader.length > 0
        ? { tenantId: tenantIdHeader }
        : {}),
  });
}

export function mapPolicyError(error: unknown): { statusCode: number; body: Record<string, unknown> } | null {
  if (!(error instanceof RequestPolicyError)) {
    return null;
  }
  return {
    statusCode: error.statusCode,
    body: {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    },
  };
}

export const REQUEST_SCOPES = AUTH_SCOPE_IDS;
