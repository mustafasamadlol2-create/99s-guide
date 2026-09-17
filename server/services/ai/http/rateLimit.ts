import {
  AI_HTTP_MAX_ACTIVE_GLOBAL,
  AI_HTTP_MAX_ACTIVE_PER_ADMIN,
  AI_HTTP_MAX_RATE_ENTRIES,
  AI_HTTP_RATE_MAX_REQUESTS,
  AI_HTTP_RATE_WINDOW_MS,
} from "./limits.js";

export interface AIRateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface RateEntry {
  count: number;
  windowStartedAt: number;
  lastSeenAt: number;
}

export class AIAdminRateLimiter {
  private readonly entries = new Map<string, RateEntry>();

  constructor(
    private readonly maxRequests = AI_HTTP_RATE_MAX_REQUESTS,
    private readonly windowMs = AI_HTTP_RATE_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  check(adminId: string): AIRateLimitDecision {
    const now = this.now();
    this.prune(now);
    const current = this.entries.get(adminId);
    if (!current || now - current.windowStartedAt >= this.windowMs) {
      this.entries.set(adminId, { count: 1, windowStartedAt: now, lastSeenAt: now });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    current.lastSeenAt = now;
    if (current.count >= this.maxRequests) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((this.windowMs - (now - current.windowStartedAt)) / 1000)),
      };
    }
    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.lastSeenAt >= this.windowMs) this.entries.delete(key);
    }
    if (this.entries.size < AI_HTTP_MAX_RATE_ENTRIES) return;
    const oldest = [...this.entries.entries()]
      .sort(([, left], [, right]) => left.lastSeenAt - right.lastSeenAt)
      .slice(0, Math.max(1, this.entries.size - AI_HTTP_MAX_RATE_ENTRIES + 1));
    for (const [key] of oldest) this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}

export interface AIConcurrencyLease {
  release(): void;
}

export class AIAdminConcurrencyGate {
  private readonly activeByAdmin = new Map<string, number>();
  private activeGlobal = 0;

  constructor(
    private readonly maxPerAdmin = AI_HTTP_MAX_ACTIVE_PER_ADMIN,
    private readonly maxGlobal = AI_HTTP_MAX_ACTIVE_GLOBAL,
  ) {}

  tryAcquire(adminId: string): AIConcurrencyLease | null {
    const activeForAdmin = this.activeByAdmin.get(adminId) ?? 0;
    if (activeForAdmin >= this.maxPerAdmin || this.activeGlobal >= this.maxGlobal) return null;
    this.activeByAdmin.set(adminId, activeForAdmin + 1);
    this.activeGlobal += 1;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        const remaining = (this.activeByAdmin.get(adminId) ?? 1) - 1;
        if (remaining <= 0) this.activeByAdmin.delete(adminId);
        else this.activeByAdmin.set(adminId, remaining);
        this.activeGlobal = Math.max(0, this.activeGlobal - 1);
      },
    };
  }

  get activeCount(): number {
    return this.activeGlobal;
  }
}