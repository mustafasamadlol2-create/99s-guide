import type { OwnerAnalyticsRate } from "./types.js";

/** Returns a deterministic percentage in basis points, or null for no sample. */
export function rateBps(numerator: number, denominator: number): number | null {
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new RangeError("Rate numerator must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(denominator) || denominator < 0) {
    throw new RangeError("Rate denominator must be a non-negative safe integer.");
  }
  if (denominator === 0) {
    if (numerator !== 0) throw new RangeError("A non-zero numerator requires a denominator.");
    return null;
  }
  if (numerator > denominator) {
    throw new RangeError("Rate numerator cannot exceed its denominator.");
  }

  const n = BigInt(numerator) * 10_000n;
  const d = BigInt(denominator);
  return Number((2n * n + d) / (2n * d));
}

export function rateMetric(numerator: number, denominator: number): OwnerAnalyticsRate {
  return { numerator, denominator, rateBps: rateBps(numerator, denominator) };
}