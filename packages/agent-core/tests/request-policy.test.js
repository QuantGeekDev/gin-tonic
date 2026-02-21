import { describe, expect, it } from "@jest/globals";

import {
  AUTH_SCOPE_IDS,
  InMemoryRateLimiter,
  RequestPolicyError,
  authorizeRequest,
  parseRequestGuardConfigFromEnv,
} from "../dist/index.js";

describe("request policy", () => {
  it("authorizes a scoped token for allowed origin", () => {
    const config = parseRequestGuardConfigFromEnv({
      JIHN_API_AUTH_ENABLED: "1",
      JIHN_API_ALLOWED_ORIGINS: "https://jihn.local",
      JIHN_API_TOKENS: "token-1|agent:read;agent:write|tenant-a",
    });
    const limiter = new InMemoryRateLimiter(60_000, 10);

    const principal = authorizeRequest(config, limiter, {
      method: "POST",
      origin: "https://jihn.local",
      token: "token-1",
      clientKey: "127.0.0.1",
      requiredScopes: [AUTH_SCOPE_IDS.AGENT_WRITE],
      tenantId: "tenant-a",
    });

    expect(principal?.tenantId).toBe("tenant-a");
    expect(principal?.scopes).toContain("agent:write");
  });

  it("rejects invalid origin", () => {
    const config = parseRequestGuardConfigFromEnv({
      JIHN_API_AUTH_ENABLED: "1",
      JIHN_API_ALLOWED_ORIGINS: "https://jihn.local",
      JIHN_API_TOKENS: "token-1|admin|global",
    });
    const limiter = new InMemoryRateLimiter(60_000, 10);

    expect(() =>
      authorizeRequest(config, limiter, {
        method: "GET",
        origin: "https://evil.example",
        token: "token-1",
        clientKey: "127.0.0.1",
        requiredScopes: [AUTH_SCOPE_IDS.AGENT_READ],
      }),
    ).toThrow(RequestPolicyError);
  });

  it("enforces rate limits", () => {
    const config = parseRequestGuardConfigFromEnv({
      JIHN_API_AUTH_ENABLED: "1",
      JIHN_API_TOKENS: "token-1|admin|global",
      JIHN_API_RATE_LIMIT_MAX_REQUESTS: "2",
      JIHN_API_RATE_LIMIT_WINDOW_MS: "60000",
    });
    const limiter = new InMemoryRateLimiter(60_000, 2);
    authorizeRequest(config, limiter, {
      method: "GET",
      origin: null,
      token: "token-1",
      clientKey: "127.0.0.1",
      requiredScopes: [AUTH_SCOPE_IDS.AGENT_READ],
    });
    authorizeRequest(config, limiter, {
      method: "GET",
      origin: null,
      token: "token-1",
      clientKey: "127.0.0.1",
      requiredScopes: [AUTH_SCOPE_IDS.AGENT_READ],
    });

    expect(() =>
      authorizeRequest(config, limiter, {
        method: "GET",
        origin: null,
        token: "token-1",
        clientKey: "127.0.0.1",
        requiredScopes: [AUTH_SCOPE_IDS.AGENT_READ],
      }),
    ).toThrow(RequestPolicyError);
  });
});
