export interface FocusClock {
  /** Monotonic milliseconds, independent of the device wall clock when supported. */
  monotonicNow(): number;
}

export interface FocusClockHost {
  performance?: {
    now?: () => number;
  };
  wallNow?: () => number;
}

const MAX_WALL_FALLBACK_STEP_MS = 2_000;

function createClampedWallClockFallback(wallNow: () => number): FocusClock {
  let previousWallTime = wallNow();
  let monotonicTime = 0;
  return {
    monotonicNow() {
      const currentWallTime = wallNow();
      const elapsed = currentWallTime - previousWallTime;
      previousWallTime = currentWallTime;
      if (Number.isFinite(elapsed) && elapsed > 0) {
        monotonicTime += Math.min(elapsed, MAX_WALL_FALLBACK_STEP_MS);
      }
      return monotonicTime;
    },
  };
}

/**
 * Prefer the platform monotonic clock. The wall clock is isolated here as a
 * clamped last-resort fallback for runtimes that do not expose performance.now().
 */
export function createFocusClock(host?: FocusClockHost): FocusClock {
  if (host) {
    const performanceNow = host.performance?.now;
    if (typeof performanceNow === "function") {
      const performanceObject = host.performance;
      return { monotonicNow: () => performanceNow.call(performanceObject) };
    }
    const wallNow = host.wallNow ?? (() => Date.now());
    return createClampedWallClockFallback(wallNow);
  }

  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return { monotonicNow: () => performance.now() };
  }
  return createClampedWallClockFallback(() => Date.now());
}

export function isValidServerTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    Number.isFinite(Date.parse(value));
}