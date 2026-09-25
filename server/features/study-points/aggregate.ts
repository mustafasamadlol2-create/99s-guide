import { StudyPointsError } from "./errors.js";

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

export function safeStudyPointsAggregate(value: unknown): number {
  if (value === null || value === undefined) return 0;

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new StudyPointsError(
        "POINTS_BALANCE_OVERFLOW",
        "Study Points aggregate is outside the safe integer range.",
      );
    }
    return value;
  }

  let integer: bigint;
  if (typeof value === "bigint") {
    integer = value;
  } else if (typeof value === "string" && /^-?\d+$/u.test(value)) {
    integer = BigInt(value);
  } else {
    throw new StudyPointsError(
      "POINTS_BALANCE_OVERFLOW",
      "Study Points aggregate could not be represented as an integer.",
    );
  }

  if (integer > MAX_SAFE || integer < MIN_SAFE) {
    throw new StudyPointsError(
      "POINTS_BALANCE_OVERFLOW",
      "Study Points aggregate is outside the safe integer range.",
    );
  }
  return Number(integer);
}

export function safeStudyPointsSum(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw new StudyPointsError(
      "POINTS_BALANCE_OVERFLOW",
      "Study Points balance is outside the safe integer range.",
    );
  }
  return total;
}