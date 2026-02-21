export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  windowMs: number;
  retryAfterMs: number;
}

export interface FixedWindowRateLimiterOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

interface WindowState {
  startedAt: number;
  count: number;
}

export class FixedWindowRateLimiter {
  private limit: number;
  private windowMs: number;
  private readonly now: () => number;
  private readonly windows = new Map<string, WindowState>();

  public constructor(options: FixedWindowRateLimiterOptions) {
    this.limit = Math.max(1, Math.floor(options.limit));
    this.windowMs = Math.max(1000, Math.floor(options.windowMs));
    this.now = options.now ?? (() => Date.now());
  }

  public decide(key: string): RateLimitDecision {
    const now = this.now();
    const state = this.resolveWindow(key, now);

    if (state.count >= this.limit) {
      const retryAfterMs = Math.max(0, state.startedAt + this.windowMs - now);
      return {
        allowed: false,
        limit: this.limit,
        remaining: 0,
        windowMs: this.windowMs,
        retryAfterMs,
      };
    }

    state.count += 1;
    const remaining = Math.max(0, this.limit - state.count);
    return {
      allowed: true,
      limit: this.limit,
      remaining,
      windowMs: this.windowMs,
      retryAfterMs: 0,
    };
  }

  public reload(options: { limit?: number; windowMs?: number }): void {
    if (options.limit !== undefined && Number.isFinite(options.limit)) {
      this.limit = Math.max(1, Math.floor(options.limit));
    }
    if (options.windowMs !== undefined && Number.isFinite(options.windowMs)) {
      this.windowMs = Math.max(1000, Math.floor(options.windowMs));
    }
    this.windows.clear();
  }

  private resolveWindow(key: string, now: number): WindowState {
    const existing = this.windows.get(key);
    if (existing !== undefined && now - existing.startedAt < this.windowMs) {
      return existing;
    }

    const next: WindowState = {
      startedAt: now,
      count: 0,
    };
    this.windows.set(key, next);
    return next;
  }
}

export function parseRateLimitConfig(env: NodeJS.ProcessEnv = process.env): {
  limit: number;
  windowMs: number;
} {
  const limit = Number.parseInt(env.JIHN_GATEWAY_RATE_LIMIT_REQUESTS ?? "120", 10);
  const windowMs = Number.parseInt(env.JIHN_GATEWAY_RATE_LIMIT_WINDOW_MS ?? "60000", 10);

  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : 120,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60_000,
  };
}
