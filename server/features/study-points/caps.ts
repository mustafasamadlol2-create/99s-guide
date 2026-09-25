import type { Prisma } from "@prisma/client";
import {
  safeStudyPointsAggregate,
  safeStudyPointsSum,
} from "./aggregate.js";
import type { StudyPointsCategory } from "./constants.js";
import { isStudyPointsCategory } from "./awardRules.js";

export const STUDY_POINTS_TOTAL_DAILY_CAP = 100;

export const STUDY_POINTS_CATEGORY_DAILY_CAPS: Readonly<
  Record<StudyPointsCategory, number>
> = Object.freeze({
  FOCUS: 60,
  MASTERY: 40,
  PROGRESS: 30,
  CONSISTENCY: 5,
});

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
  const rows = await tx.studyPointsLedgerEntry.groupBy({
    by: ["category"],
    where: {
      userId,
      effectiveAt: { gte: bounds.start, lt: bounds.end },
    },
    _sum: { amount: true },
  });
  let total = 0;
  for (const row of rows) {
    if (!isStudyPointsCategory(row.category)) {
      throw new Error("Stored Study Points category is invalid.");
    }
    const amount = safeStudyPointsAggregate(row._sum.amount);
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
  return tx.studyPointsLedgerEntry.count({
    where: {
      userId,
      category: "FOCUS",
      reasonCode: "group_focus.verified_social_bonus",
      sourceType: "GROUP_FOCUS_RUN",
      amount: { gt: 0 },
      effectiveAt: { gte: bounds.start, lt: bounds.end },
    },
  });
}