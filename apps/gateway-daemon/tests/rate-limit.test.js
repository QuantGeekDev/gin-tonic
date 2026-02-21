import { describe, expect, it } from "@jest/globals";

import { FixedWindowRateLimiter, parseRateLimitConfig } from "../dist/rate-limit.js";

describe("FixedWindowRateLimiter", () => {
  it("allows requests up to the configured limit and blocks after", () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter({
      limit: 2,
      windowMs: 1_000,
      now: () => now,
    });

    const first = limiter.decide("client:a");
    const second = limiter.decide("client:a");
    const third = limiter.decide("client:a");

    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(1);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBe(1000);

    now = 2_001;
    const nextWindow = limiter.decide("client:a");
    expect(nextWindow.allowed).toBe(true);
  });

  it("supports runtime reload", () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter({
      limit: 1,
      windowMs: 10_000,
      now: () => now,
    });

    expect(limiter.decide("client:b").allowed).toBe(true);
    expect(limiter.decide("client:b").allowed).toBe(false);

    limiter.reload({ limit: 3, windowMs: 2_000 });

    expect(limiter.decide("client:b").allowed).toBe(true);
    expect(limiter.decide("client:b").allowed).toBe(true);
    expect(limiter.decide("client:b").allowed).toBe(true);
    expect(limiter.decide("client:b").allowed).toBe(false);

    now = 3_100;
    expect(limiter.decide("client:b").allowed).toBe(true);
  });
});

describe("parseRateLimitConfig", () => {
  it("parses sane defaults and guards invalid input", () => {
    expect(parseRateLimitConfig({})).toEqual({
      limit: 120,
      windowMs: 60_000,
    });

    expect(
      parseRateLimitConfig({
        JIHN_GATEWAY_RATE_LIMIT_REQUESTS: "200",
        JIHN_GATEWAY_RATE_LIMIT_WINDOW_MS: "15000",
      }),
    ).toEqual({
      limit: 200,
      windowMs: 15_000,
    });

    expect(
      parseRateLimitConfig({
        JIHN_GATEWAY_RATE_LIMIT_REQUESTS: "0",
        JIHN_GATEWAY_RATE_LIMIT_WINDOW_MS: "-1",
      }),
    ).toEqual({
      limit: 120,
      windowMs: 60_000,
    });
  });
});
