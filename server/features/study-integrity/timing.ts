import { INTEGRITY_LIMITS } from "./constants.js";
import { StudyIntegrityError } from "./errors.js";
import type {
  IntegrityDurationBounds,
  IntegrityObservation,
  IntegrityTimestampPolicy,
} from "./types.js";
import { createIntegrityObservation } from "./observations.js";

export type TimestampAssessment = {
  accepted: boolean;
  trustedOccurredAt: Date;
  observations: IntegrityObservation[];
};

export function isValidIntegrityInstant(value: unknown): value is Date {
  return (
    value instanceof Date &&
    Number.isSafeInteger(value.getTime()) &&
    value.getTime() >= 0
  );
}

/**
 * Temporal validation uses integer milliseconds; action durations use seconds.
 * Server-authoritative actions always use receivedAt and ignore device time.
 */
export function assessIntegrityTimestamp(input: {
  occurredAt: Date;
  receivedAt: Date;
  policy: IntegrityTimestampPolicy;
}): TimestampAssessment {
  if (!isValidIntegrityInstant(input.receivedAt)) {
    throw new StudyIntegrityError(
      "INTEGRITY_INVALID_INPUT",
      "Server receivedAt must be a valid non-negative millisecond instant.",
    );
  }

  const receivedAtMs = input.receivedAt.getTime();
  const receivedAt = new Date(receivedAtMs);
  if (
    input.policy.authority === "SERVER" ||
    input.policy.replaceWithServerTime ||
    !input.policy.acceptClientTimestamp
  ) {
    return {
      accepted: true,
      trustedOccurredAt: receivedAt,
      observations: [],
    };
  }

  if (!isValidIntegrityInstant(input.occurredAt)) {
    return {
      accepted: false,
      trustedOccurredAt: receivedAt,
      observations: [
        createIntegrityObservation("TIMING_IMPOSSIBLE", {
          reason: "invalid_client_timestamp",
        }),
      ],
    };
  }

  const occurredAtMs = input.occurredAt.getTime();
  const maxPastMs = input.policy.maxPastMs ?? INTEGRITY_LIMITS.clientPastWindowMs;
  const maxFutureMs =
    input.policy.maxFutureMs ?? INTEGRITY_LIMITS.clientFutureSkewMs;
  if (
    !Number.isSafeInteger(maxPastMs) ||
    maxPastMs < 0 ||
    !Number.isSafeInteger(maxFutureMs) ||
    maxFutureMs < 0
  ) {
    throw new StudyIntegrityError(
      "INTEGRITY_INVALID_INPUT",
      "Timestamp policy bounds must be non-negative safe integer milliseconds.",
    );
  }

  if (occurredAtMs > receivedAtMs) {
    const futureSkewMs = occurredAtMs - receivedAtMs;
    if (futureSkewMs > maxFutureMs) {
      return {
        accepted: false,
        trustedOccurredAt: receivedAt,
        observations: [
          createIntegrityObservation("TIMESTAMP_TOO_FAR_FUTURE", {
            futureSkewMs,
            maxFutureSkewMs: maxFutureMs,
          }),
        ],
      };
    }
    if (input.policy.clampSmallFutureSkew) {
      return {
        accepted: true,
        trustedOccurredAt: receivedAt,
        observations: [
          createIntegrityObservation("TIMESTAMP_NEAR_BOUNDARY", {
            futureSkewMs,
            maxFutureSkewMs: maxFutureMs,
          }),
        ],
      };
    }
  }

  if (occurredAtMs < receivedAtMs) {
    const ageMs = receivedAtMs - occurredAtMs;
    if (ageMs > maxPastMs) {
      return {
        accepted: false,
        trustedOccurredAt: receivedAt,
        observations: [
          createIntegrityObservation("TIMESTAMP_TOO_FAR_PAST", {
            ageMs,
            maxPastMs,
          }),
        ],
      };
    }
    if (
      maxPastMs - ageMs <= INTEGRITY_LIMITS.timestampBoundaryReviewMs
    ) {
      return {
        accepted: true,
        trustedOccurredAt: new Date(occurredAtMs),
        observations: [
          createIntegrityObservation("TIMESTAMP_NEAR_BOUNDARY", {
            ageMs,
            maxPastMs,
          }),
        ],
      };
    }
  }

  return {
    accepted: true,
    trustedOccurredAt: new Date(occurredAtMs),
    observations: [],
  };
}

export function validateDurationSeconds(input: {
  durationSeconds: number;
  bounds?: IntegrityDurationBounds;
}): { valid: boolean; observation?: IntegrityObservation } {
  const { durationSeconds, bounds } = input;
  if (
    !Number.isSafeInteger(durationSeconds) ||
    durationSeconds < 0 ||
    (bounds?.minSeconds !== undefined &&
      (!Number.isSafeInteger(bounds.minSeconds) || bounds.minSeconds < 0)) ||
    (bounds?.maxSeconds !== undefined &&
      (!Number.isSafeInteger(bounds.maxSeconds) || bounds.maxSeconds < 0)) ||
    (bounds?.minSeconds !== undefined &&
      bounds?.maxSeconds !== undefined &&
      bounds.minSeconds > bounds.maxSeconds) ||
    (bounds?.minSeconds !== undefined && durationSeconds < bounds.minSeconds) ||
    (bounds?.maxSeconds !== undefined && durationSeconds > bounds.maxSeconds)
  ) {
    return {
      valid: false,
      observation: createIntegrityObservation("TIMING_IMPOSSIBLE", {
        durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
        minimumSeconds: bounds?.minSeconds ?? null,
        maximumSeconds: bounds?.maxSeconds ?? null,
      }),
    };
  }
  return { valid: true };
}