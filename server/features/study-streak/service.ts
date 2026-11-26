import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { getBaghdadMetricDate, metricDateAsUtcDate } from "../study-events/date.js";

export const STUDY_STREAK_TIME_ZONE = "Asia/Baghdad";
export const STUDY_STREAK_HISTORY_DAYS = 365;

const ACTIVE_STUDY_EVENT_TYPES = [
  "focus_session_completed",
  "lecture_progress_recorded",
  "lecture_completion_confirmed",
  "mcq_attempted",
  "flashcard_reviewed",
  "spaced_recall_answered",
  "group_focus_round_completed",
  "group_focus_summary_completed",
] as const;
const ACTIVE_STUDY_POINT_SOURCE_TYPES = [
  "FOCUS_SESSION",
  "GROUP_FOCUS_RUN",
  "MCQ_ATTEMPT",
  "FLASHCARD_REVIEW",
  "RECALL_ATTEMPT",
  "LECTURE_RESOURCE",
  "LECTURE_COMPLETION",
] as const;
const ACTIVE_EVIDENCE_CLASSES = ["SERVER_VALIDATED", "SERVER_DERIVED", "REALTIME_VERIFIED", "ADMIN_VERIFIED"] as const;

export type StudyStreakDay = {
  date: string;
  active: boolean;
  intensity: 0 | 1 | 2 | 3 | 4;
  focusSeconds: number;
  groupFocusSeconds: number;
  sessionsCompleted: number;
  mcqAttempts: number;
  flashcardReviews: number;
  recallAttempts: number;
  lectureCompletions: number;
  progressEvents: number;
};

export type StudyStreakSummary = {
  timeZone: typeof STUDY_STREAK_TIME_ZONE;
  rangeStart: string;
  rangeEnd: string;
  currentStreakDays: number;
  longestStreakDays: number;
  activeToday: boolean;
  activeDaysLast7: number;
  activeDaysLast30: number;
  activeDaysInRange: number;
  historyDays: number;
  streakCappedByHistory: boolean;
  activityRuleVersion: "study-day-v3";
  days: StudyStreakDay[];
};

type MetricRow = {
  metricDate: Date;
  focusSeconds: number;
  sessionsCompleted: number;
  mcqAttempts: number;
  flashcardReviews: number;
  recallAttempts: number;
  lectureCompletions: number;
};

type ProgressDay = { date: string; progressEvents: bigint };
type GroupFocusDay = { date: string; verifiedFocusSeconds: bigint };
type ActivityDay = { date: string };

export type StudyStreakDatabase = Pick<PrismaClient, "$queryRaw"> & {
  studyDailyMetric: { findMany(args: unknown): Promise<MetricRow[]> };
};

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const value = new Date(`${dateKey}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + deltaDays);
  return value.toISOString().slice(0, 10);
}

function dateRange(start: string, end: string): string[] {
  const result: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    result.push(cursor);
    cursor = shiftDateKey(cursor, 1);
  }
  return result;
}

function safeCounter(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function baghdadDayStart(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00+03:00`);
}

function activityScore(day: Omit<StudyStreakDay, "active" | "intensity">): number {
  const verifiedFocusMinutes = (day.focusSeconds + day.groupFocusSeconds) / 60;
  return verifiedFocusMinutes
    + day.mcqAttempts
    + day.flashcardReviews
    + (day.recallAttempts * 2)
    + (day.lectureCompletions * 8)
    + (day.progressEvents * 3);
}

// Heatmap intensity is relative visualization only. This is not a reward, cap, or eligibility rule.
function computeIntensity(score: number, maxScore: number): 0 | 1 | 2 | 3 | 4 {
  if (score <= 0) return 0;
  if (maxScore <= 0) return 1;
  const ratio = Math.log1p(score) / Math.log1p(maxScore);
  return Math.max(1, Math.min(4, Math.ceil(ratio * 4))) as 1 | 2 | 3 | 4;
}

function consecutiveCount(active: Set<string>, anchor: string, rangeStart: string): { days: number; capped: boolean } {
  if (!active.has(anchor)) return { days: 0, capped: false };
  let days = 0;
  let cursor = anchor;
  while (cursor >= rangeStart && active.has(cursor)) {
    days += 1;
    if (cursor === rangeStart) return { days, capped: true };
    cursor = shiftDateKey(cursor, -1);
  }
  return { days, capped: false };
}

function longestRun(active: Set<string>, keys: string[]): number {
  let current = 0;
  let longest = 0;
  for (const key of keys) {
    if (active.has(key)) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

export function createStudyStreakService(options: { database?: StudyStreakDatabase; now?: () => Date } = {}) {
  const database = options.database ?? (getPrisma() as unknown as StudyStreakDatabase);
  const now = options.now ?? (() => new Date());

  return {
    async getSummary(userId: string): Promise<StudyStreakSummary> {
      if (!userId || typeof userId !== "string") throw new Error("userId is required");
      const asOf = now();
      if (!Number.isFinite(asOf.getTime())) throw new Error("server time is invalid");

      const today = getBaghdadMetricDate(asOf);
      const rangeStart = shiftDateKey(today, -(STUDY_STREAK_HISTORY_DAYS - 1));
      const keys = dateRange(rangeStart, today);
      const metricStart = metricDateAsUtcDate(rangeStart);
      const metricEnd = metricDateAsUtcDate(today);
      const instantStart = baghdadDayStart(rangeStart);
      // Prisma's timestamp columns store UTC values without a timezone. Bind
      // UTC bounds explicitly to keep the filters independent of session time.
      const fromUtc = Prisma.sql`(${instantStart}::timestamptz AT TIME ZONE 'UTC')`;
      const throughUtc = Prisma.sql`(${asOf}::timestamptz AT TIME ZONE 'UTC')`;

      // IMPORTANT: a study streak is about the day the server accepted the study
      // action, not necessarily the historical/economic effectiveAt carried by a
      // reward row. Legacy progress can legitimately create a new Points V2 row
      // today whose effectiveAt points at an older completion timestamp. Using
      // effectiveAt made a student earn points today while still seeing streak=0.
      //
      // Reads are also deliberately fail-soft. StudyDailyMetric and Group Focus
      // are projections/secondary sources; one unavailable source must never make
      // the entire streak endpoint fail and leave the Profile stuck on cached 0.
      const reads = await Promise.allSettled([
        database.studyDailyMetric.findMany({
          where: { userId, metricDate: { gte: metricStart, lte: metricEnd } },
          select: {
            metricDate: true,
            focusSeconds: true,
            sessionsCompleted: true,
            mcqAttempts: true,
            flashcardReviews: true,
            recallAttempts: true,
            lectureCompletions: true,
          },
          orderBy: { metricDate: "asc" },
        }),
        database.$queryRaw<ProgressDay[]>`
          SELECT to_char(("receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${STUDY_STREAK_TIME_ZONE}, 'YYYY-MM-DD') AS "date",
                 COUNT(*) FILTER (WHERE "eventType" = 'lecture_progress_recorded') AS "progressEvents"
          FROM "StudyEvent"
          WHERE "userId" = ${userId}
            AND "eventType" IN (${Prisma.join(ACTIVE_STUDY_EVENT_TYPES)})
            AND "evidenceClass" IN (${Prisma.join(ACTIVE_EVIDENCE_CLASSES)})
            AND "receivedAt" BETWEEN ${fromUtc} AND ${throughUtc}
          GROUP BY 1
        `,
        database.$queryRaw<GroupFocusDay[]>`
          SELECT to_char((runs."runtimeEndedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${STUDY_STREAK_TIME_ZONE}, 'YYYY-MM-DD') AS "date",
                 SUM(participant."verifiedFocusSeconds") AS "verifiedFocusSeconds"
          FROM "GroupFocusParticipantSummary" AS participant
          JOIN "GroupFocusRun" AS runs ON runs."id" = participant."runId"
          WHERE participant."userId" = ${userId}
            AND participant."verifiedFocusSeconds" > 0
            AND runs."runtimeEndedAt" BETWEEN ${fromUtc} AND ${throughUtc}
          GROUP BY 1
        `,
        database.$queryRaw<ActivityDay[]>`
          SELECT DISTINCT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${STUDY_STREAK_TIME_ZONE}, 'YYYY-MM-DD') AS "date"
          FROM "StudyPointsLedgerEntry"
          WHERE "userId" = ${userId}
            AND "amount" > 0
            AND "sourceType" IN (${Prisma.join(ACTIVE_STUDY_POINT_SOURCE_TYPES)})
            AND "createdAt" BETWEEN ${fromUtc} AND ${throughUtc}
        `,
      ] as const);

      const [metricRead, eventRead, groupRead, pointRead] = reads;
      const metrics = metricRead.status === "fulfilled" ? metricRead.value : [];
      const verifiedEvents = eventRead.status === "fulfilled" ? eventRead.value : [];
      const groupFocus = groupRead.status === "fulfilled" ? groupRead.value : [];
      const pointActivity = pointRead.status === "fulfilled" ? pointRead.value : [];

      if (reads.every((read) => read.status === "rejected")) {
        throw new Error("All study streak activity sources are unavailable.");
      }
      for (const [source, read] of [
        ["daily_metric", metricRead],
        ["study_event", eventRead],
        ["group_focus", groupRead],
        ["points_ledger", pointRead],
      ] as const) {
        if (read.status === "rejected") {
          console.warn(`[StudyStreak] ${source} source unavailable; continuing with canonical fallbacks.`);
        }
      }

      const byDate = new Map<string, Omit<StudyStreakDay, "active" | "intensity">>();
      const ensure = (date: string) => {
        const current = byDate.get(date);
        if (current) return current;
        const created = {
          date,
          focusSeconds: 0,
          groupFocusSeconds: 0,
          sessionsCompleted: 0,
          mcqAttempts: 0,
          flashcardReviews: 0,
          recallAttempts: 0,
          lectureCompletions: 0,
          progressEvents: 0,
        };
        byDate.set(date, created);
        return created;
      };

      for (const row of metrics) {
        const date = row.metricDate.toISOString().slice(0, 10);
        if (date < rangeStart || date > today) continue;
        const target = ensure(date);
        target.focusSeconds += safeCounter(row.focusSeconds);
        target.sessionsCompleted += safeCounter(row.sessionsCompleted);
        target.mcqAttempts += safeCounter(row.mcqAttempts);
        target.flashcardReviews += safeCounter(row.flashcardReviews);
        target.recallAttempts += safeCounter(row.recallAttempts);
        target.lectureCompletions += safeCounter(row.lectureCompletions);
      }

      const canonicalActivityDates = new Set<string>();

      for (const { date, progressEvents } of verifiedEvents) {
        if (date < rangeStart || date > today) continue;
        canonicalActivityDates.add(date);
        ensure(date).progressEvents += Number(progressEvents);
      }

      // Points V2 is canonical, append-only proof that a server-verified study
      // action earned credit. Use createdAt (server commit time) for the streak
      // day. effectiveAt is intentionally allowed to be historical for replay /
      // legacy-completion correctness and therefore is not a valid "studied today"
      // timestamp.
      for (const { date } of pointActivity) {
        if (date >= rangeStart && date <= today) canonicalActivityDates.add(date);
      }

      for (const { date, verifiedFocusSeconds } of groupFocus) {
        if (date >= rangeStart && date <= today) {
          ensure(date).groupFocusSeconds += Number(verifiedFocusSeconds);
        }
      }

      const scores = new Map<string, number>();
      let maxScore = 0;
      for (const key of keys) {
        const metricScore = activityScore(ensure(key));
        const score = canonicalActivityDates.has(key) ? Math.max(1, metricScore) : metricScore;
        scores.set(key, score);
        maxScore = Math.max(maxScore, score);
      }

      const days: StudyStreakDay[] = keys.map((key) => {
        const entry = ensure(key);
        const score = scores.get(key) ?? 0;
        const active = canonicalActivityDates.has(key) || score > 0;
        return { ...entry, active, intensity: active ? computeIntensity(Math.max(1, score), Math.max(1, maxScore)) : 0 };
      });
      const activeKeys = new Set(days.filter((day) => day.active).map((day) => day.date));
      const yesterday = shiftDateKey(today, -1);
      const anchor = activeKeys.has(today) ? today : activeKeys.has(yesterday) ? yesterday : null;
      const current = anchor ? consecutiveCount(activeKeys, anchor, rangeStart) : { days: 0, capped: false };
      const last7Start = shiftDateKey(today, -6);
      const last30Start = shiftDateKey(today, -29);

      return {
        timeZone: STUDY_STREAK_TIME_ZONE,
        rangeStart,
        rangeEnd: today,
        currentStreakDays: current.days,
        longestStreakDays: longestRun(activeKeys, keys),
        activeToday: activeKeys.has(today),
        activeDaysLast7: days.filter((day) => day.active && day.date >= last7Start).length,
        activeDaysLast30: days.filter((day) => day.active && day.date >= last30Start).length,
        activeDaysInRange: activeKeys.size,
        historyDays: STUDY_STREAK_HISTORY_DAYS,
        streakCappedByHistory: current.capped,
        activityRuleVersion: "study-day-v3",
        days,
      };
    },
  };
}

export const studyStreakService = createStudyStreakService();
