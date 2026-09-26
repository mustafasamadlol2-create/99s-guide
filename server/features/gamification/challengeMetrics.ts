import type { Prisma } from "@prisma/client";
import { getEligibleBaghdadDayFocusSeconds } from "../study-points/sources/consistency.js";
import { studyPointsBaghdadDate } from "../study-points/caps.js";
import { GamificationError } from "./errors.js";

export type ChallengeMetricWindowInput = {
  userId: string;
  metricId: string;
  startsAt: Date;
  endsAt: Date;
  asOf: Date;
  tx: Prisma.TransactionClient;
};

const SUPPORTED = new Set([
  "focus.completed_sessions",
  "focus.verified_seconds",
  "group_focus.completed_runs",
  "consistency.qualifying_days",
]);

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isSafeInteger(value.getTime());
}

function assertResult(value: unknown): number {
  const number = typeof value === "bigint" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0) {
    throw new GamificationError(
      "GAMIFICATION_METRIC_VALUE_INVALID",
      "Challenge metric source returned an invalid nonnegative integer.",
    );
  }
  return number;
}

function assertInput(input: ChallengeMetricWindowInput): void {
  if (!input || typeof input.userId !== "string" || input.userId.length === 0) {
    throw new GamificationError("GAMIFICATION_INVALID_INPUT", "userId is invalid.");
  }
  if (!SUPPORTED.has(input.metricId)) {
    throw new GamificationError(
      "GAMIFICATION_METRIC_NOT_FOUND",
      `Unsupported challenge metric: ${input.metricId}.`,
    );
  }
  if (!validDate(input.startsAt) || !validDate(input.endsAt) || !validDate(input.asOf)) {
    throw new GamificationError("GAMIFICATION_INVALID_INPUT", "Metric window dates are invalid.");
  }
  if (input.startsAt >= input.endsAt) {
    throw new GamificationError("GAMIFICATION_INVALID_INPUT", "Metric window must be non-empty.");
  }
  if (!input.tx) {
    throw new GamificationError("GAMIFICATION_INVALID_INPUT", "A transaction client is required.");
  }
}

function windowEnd(startsAt: Date, endsAt: Date, asOf: Date): Date {
  return new Date(Math.min(endsAt.getTime(), asOf.getTime()));
}

function baghdadDatesTouched(startsAt: Date, endExclusive: Date): string[] {
  if (startsAt >= endExclusive) return [];
  const first = studyPointsBaghdadDate(startsAt);
  const last = studyPointsBaghdadDate(new Date(endExclusive.getTime() - 1));
  const dates: string[] = [];
  const cursor = new Date(`${first}T12:00:00.000Z`);
  const finish = new Date(`${last}T12:00:00.000Z`);
  while (cursor <= finish) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export async function getChallengeMetricValueForWindow(
  input: ChallengeMetricWindowInput,
): Promise<number> {
  assertInput(input);
  const { tx, userId, metricId, startsAt, endsAt, asOf } = input;
  const end = windowEnd(startsAt, endsAt, asOf);

  if (metricId === "consistency.qualifying_days") {
    const dates = baghdadDatesTouched(startsAt, end);
    let qualifying = 0;
    for (const baghdadDate of dates) {
      const seconds = await getEligibleBaghdadDayFocusSeconds(tx, userId, baghdadDate, asOf);
      if (!Number.isSafeInteger(seconds) || seconds < 0) {
        throw new GamificationError(
          "GAMIFICATION_METRIC_VALUE_INVALID",
          "Canonical qualifying-day source returned an invalid value.",
        );
      }
      if (seconds >= 1500) qualifying += 1;
    }
    return assertResult(qualifying);
  }

  const window = { gte: startsAt, lt: end };
  if (metricId === "focus.completed_sessions" || metricId === "focus.verified_seconds") {
    const where = {
      userId,
      status: "COMPLETED",
      activeSeconds: { gt: 0 },
      actualEndedAt: window,
    };
    if (metricId === "focus.completed_sessions") {
      return assertResult(await tx.focusSession.count({ where }));
    }
    const result = await tx.focusSession.aggregate({
      where,
      _sum: { activeSeconds: true },
    });
    return assertResult(result._sum.activeSeconds);
  }

  const where = {
    userId,
    verifiedFocusSeconds: { gt: 0 },
    run: {
      runtimeStartedAt: window,
      runtimeEndedAt: window,
    },
  };
  return assertResult(await tx.groupFocusParticipantSummary.count({ where }));
}