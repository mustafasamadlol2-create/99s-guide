import type { Prisma } from "@prisma/client";
import {
  safeStudyPointsAggregate,
  safeStudyPointsSum,
} from "./aggregate.js";
import type { StudyPointsCategory } from "./constants.js";
import { isStudyPointsCategory } from "./awardRules.js";
import { getBaghdadWeekPeriod } from "../gamification/challengePeriods.js";
import { clampStudyPointsRangeStart } from "./epoch.js";

// Points V2 uses unlimited scoring. Historical cap helpers remain in this
// module only for date/range calculations and backward-compatible imports;
// no award path enforces a category, daily, weekly, or total ceiling.
export type StudyPointsBaghdadDayBounds = {
  start: Date;
  end: Date;
};

export type StudyPointsDailyUsage = {
  byCategory: Record<StudyPointsCategory, number>;
  total: number;
};

const BAGHDAD_DATE_FORMATTER = new Intl.DateTimeFormat("en", {
  timeZone: "Asia/Baghdad",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function studyPointsBaghdadDate(at: Date): string {
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) {
    throw new TypeError("Study Points effective time is invalid.");
  }
  const parts = BAGHDAD_DATE_FORMATTER.formatToParts(at);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function studyPointsDailyCapLockKey(
  userId: string,
  baghdadDate: string,
): string {
  return `study-points:daily-cap:${JSON.stringify([userId, baghdadDate])}`;
}

export function studyPointsWeeklyCapLockKey(
  userId: string,
  startsAt: Date,
): string {
  return `study-points:weekly-cap:${JSON.stringify([userId, startsAt.toISOString()])}`;
}

export async function getStudyPointsBaghdadWeekUsage(
  tx: Prisma.TransactionClient,
  userId: string,
  asOf: Date,
  ruleVersion: string,
  reasonCode: string,
): Promise<number> {
  const period = getBaghdadWeekPeriod(asOf);
  const rangeStart = clampStudyPointsRangeStart(period.startsAt);
  if (rangeStart >= period.endsAt) return 0;
  const result = await tx.studyPointsLedgerEntry.aggregate({
    where: {
      userId,
      sourceType: "RECALL_ATTEMPT",
      category: "MASTERY",
      ruleVersion,
      reasonCode,
      effectiveAt: { gte: rangeStart, lt: period.endsAt },
    },
    _sum: { amount: true },
  });
  return safeStudyPointsAggregate(result._sum.amount);
}

export async function getStudyPointsBaghdadDailyRuleUsage(
  tx: Prisma.TransactionClient,
  userId: string,
  baghdadDate: string,
  rule: {
    category: StudyPointsCategory;
    reasonCode: string;
    ruleVersion: string;
    sourceType: string;
  },
): Promise<number> {
  const bounds = await getStudyPointsBaghdadDayBounds(tx, baghdadDate);
  const rangeStart = clampStudyPointsRangeStart(bounds.start);
  if (rangeStart >= bounds.end) return 0;
  const isLearningReward =
    rule.reasonCode === "mcq.first_verified_correct"
    || rule.reasonCode === "flashcard.first_verified_recall";
  const result = await tx.studyPointsLedgerEntry.aggregate({
    where: isLearningReward
      ? {
          userId,
          // Phase 3.1 corrected MCQ/Flashcard rewards from PROGRESS to
          // MASTERY. Count both the old and new rule rows toward the same
          // per-activity cap so the correction cannot create extra farming
          // headroom on the deployment day.
          reasonCode: rule.reasonCode,
          sourceType: rule.sourceType,
          effectiveAt: { gte: rangeStart, lt: bounds.end },
        }
      : {
          userId,
          category: rule.category,
          reasonCode: rule.reasonCode,
          ruleVersion: rule.ruleVersion,
          sourceType: rule.sourceType,
          effectiveAt: { gte: rangeStart, lt: bounds.end },
        },
    _sum: { amount: true },
  });
  return safeStudyPointsAggregate(result._sum.amount);
}

export async function getStudyPointsBaghdadDayBounds(
  tx: Prisma.TransactionClient,
  baghdadDate: string,
): Promise<StudyPointsBaghdadDayBounds> {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(baghdadDate)) {
    throw new TypeError("Study Points Baghdad date is invalid.");
  }
  const [bounds] = await tx.$queryRaw<Array<{
    start: Date;
    end: Date;
  }>>`
    SELECT
      (${baghdadDate}::date::timestamp AT TIME ZONE 'Asia/Baghdad') AS start,
      ((${baghdadDate}::date + 1)::timestamp AT TIME ZONE 'Asia/Baghdad') AS end
  `;
  if (
    !bounds
    || !(bounds.start instanceof Date)
    || !(bounds.end instanceof Date)
    || !Number.isFinite(bounds.start.getTime())
    || !Number.isFinite(bounds.end.getTime())
    || bounds.start >= bounds.end
  ) {
    throw new Error("PostgreSQL returned invalid Baghdad day bounds.");
  }
  return bounds;
}

export async function getStudyPointsDailyUsage(
  tx: Prisma.TransactionClient,
  userId: string,
  bounds: StudyPointsBaghdadDayBounds,
): Promise<StudyPointsDailyUsage> {
  const byCategory: Record<StudyPointsCategory, number> = {
    FOCUS: 0,
    MASTERY: 0,
    PROGRESS: 0,
    CONSISTENCY: 0,
  };
  const rangeStart = clampStudyPointsRangeStart(bounds.start);
  if (rangeStart >= bounds.end) return { byCategory, total: 0 };
  const rows = await tx.$queryRaw<Array<{ category: string; amount: string }>>`
    SELECT
      CASE
        WHEN "reasonCode" IN (
          'mcq.first_verified_correct',
          'flashcard.first_verified_recall',
          'mcq.set_verified_pass'
        ) THEN 'MASTERY'
        ELSE "category"
      END AS category,
      COALESCE(SUM("amount"), 0)::text AS amount
    FROM "StudyPointsLedgerEntry"
    WHERE "userId" = ${userId}
      AND "sourceType" <> 'LEGACY_POINTS_LOG'
      AND "category" <> 'LEGACY'
      AND "effectiveAt" >= ${rangeStart}
      AND "effectiveAt" < ${bounds.end}
    GROUP BY 1
  `;
  let total = 0;
  for (const row of rows) {
    if (!isStudyPointsCategory(row.category)) {
      throw new Error("Stored Study Points category is invalid.");
    }
    const amount = safeStudyPointsAggregate(row.amount);
    byCategory[row.category] = amount;
    total = safeStudyPointsSum(total, amount);
  }
  return { byCategory, total };
}

export async function getGroupSocialBonusCount(
  tx: Prisma.TransactionClient,
  userId: string,
  bounds: StudyPointsBaghdadDayBounds,
): Promise<number> {
  const rangeStart = clampStudyPointsRangeStart(bounds.start);
  if (rangeStart >= bounds.end) return 0;
  return tx.studyPointsLedgerEntry.count({
    where: {
      userId,
      category: "FOCUS",
      reasonCode: "group_focus.verified_social_bonus",
      sourceType: "GROUP_FOCUS_RUN",
      amount: { gt: 0 },
      effectiveAt: { gte: rangeStart, lt: bounds.end },
    },
  });
}