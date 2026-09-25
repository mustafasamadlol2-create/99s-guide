import { StudyIntegrityError } from "./errors.js";
import { INTEGRITY_LIMITS } from "./constants.js";
import type { IntegrityRateRule } from "./types.js";

export type RateWindowResult = {
  count: number;
  limit: number;
  burstAllowance: number;
  windowStartMs: number;
  windowEndMs: number;
  allowed: boolean;
};

/**
 * Fixed windows use integer milliseconds for time and seconds for policy input.
 * Count includes the current action. Exceeding a rate limit is only a bounded
 * technical observation; the explicit rule selects review or rejection and
 * does not itself prove abuse or misconduct.
 */
export function evaluateRateWindow(input: {
  nowMs: number;
  previousActionTimestampsMs: readonly number[];
  rule: Pick<
    IntegrityRateRule,
    "windowSeconds" | "maxActions" | "burstAllowance"
  >;
}): RateWindowResult {
  const { nowMs, previousActionTimestampsMs, rule } = input;
  const burstAllowance = rule.burstAllowance ?? 0;
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    !Number.isSafeInteger(rule.windowSeconds) ||
    rule.windowSeconds < 1 ||
    !Number.isSafeInteger(rule.maxActions) ||
    rule.maxActions < 1 ||
    !Number.isSafeInteger(burstAllowance) ||
    burstAllowance < 0 ||
    previousActionTimestampsMs.length > INTEGRITY_LIMITS.maxRateHistoryItems
  ) {
    throw new StudyIntegrityError(
      "INTEGRITY_INVALID_INPUT",
      "Rate window rule and clock must use bounded non-negative integer units.",
    );
  }

  const windowMs = rule.windowSeconds * 1000;
  if (
    !Number.isSafeInteger(windowMs) ||
    !Number.isSafeInteger(rule.maxActions + burstAllowance)
  ) {
    throw new StudyIntegrityError(
      "INTEGRITY_INVALID_INPUT",
      "Rate window conversion or effective action limit exceeds safe integer range.",
    );
  }
  const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
  const windowEndMs = windowStartMs + windowMs;
  if (!Number.isSafeInteger(windowEndMs)) {
    throw new StudyIntegrityError(
      "INTEGRITY_INVALID_INPUT",
      "Rate window end exceeds safe integer millisecond range.",
    );
  }

  let priorCount = 0;
  for (const timestamp of previousActionTimestampsMs) {
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new StudyIntegrityError(
        "INTEGRITY_INVALID_INPUT",
        "Rate history must contain valid non-negative integer milliseconds.",
      );
    }
    if (timestamp >= windowStartMs && timestamp <= nowMs) priorCount += 1;
  }

  const count = priorCount + 1;
  return {
    count,
    limit: rule.maxActions,
    burstAllowance,
    windowStartMs,
    windowEndMs,
    allowed: count <= rule.maxActions + burstAllowance,
  };
}