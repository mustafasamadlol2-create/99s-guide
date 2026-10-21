import { getPrisma } from "../../services/prismaClient.js";
import { getBaghdadMetricDate, metricDateAsUtcDate } from "../study-events/date.js";

export const STUDY_STREAK_TIME_ZONE = "Asia/Baghdad";
export const STUDY_STREAK_HISTORY_DAYS = 365;

const ACTIVE_PROGRESS_EVENT_TYPES = ["lecture_progress_recorded"] as const;
const ACTIVE_EVIDENCE_CLASSES = ["SERVER_VALIDATED", "REALTIME_VERIFIED", "ADMIN_VERIFIED"] as const;

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
  activityRuleVersion: "study-day-v1";
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

type ProgressEventRow = { occurredAt: Date };
type GroupFocusRow = { verifiedFocusSeconds: number; run: { runtimeEndedAt: Date | null } };

export type StudyStreakDatabase = {
  studyDailyMetric: { findMany(args: unknown): Promise<MetricRow[]> };
  studyEvent: { findMany(args: unknown): Promise<ProgressEventRow[]> };
  groupFocusParticipantSummary: { findMany(args: unknown): Promise<GroupFocusRow[]> };
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

      const [metrics, progressEvents, groupFocus] = await Promise.all([
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
        database.studyEvent.findMany({
          where: {
            userId,
            eventType: { in: [...ACTIVE_PROGRESS_EVENT_TYPES] },
            evidenceClass: { in: [...ACTIVE_EVIDENCE_CLASSES] },
            occurredAt: { gte: instantStart, lte: asOf },
          },
          select: { occurredAt: true },
          orderBy: { occurredAt: "asc" },
        }),
        database.groupFocusParticipantSummary.findMany({
          where: {
            userId,
            verifiedFocusSeconds: { gt: 0 },
            run: { runtimeEndedAt: { gte: instantStart, lte: asOf } },
          },
          select: { verifiedFocusSeconds: true, run: { select: { runtimeEndedAt: true } } },
        }),
      ]);

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

      for (const row of progressEvents) {
        const date = getBaghdadMetricDate(row.occurredAt);
        if (date >= rangeStart && date <= today) ensure(date).progressEvents += 1;
      }

      for (const row of groupFocus) {
        const endedAt = row.run.runtimeEndedAt;
        if (!endedAt) continue;
        const date = getBaghdadMetricDate(endedAt);
        if (date >= rangeStart && date <= today) {
          ensure(date).groupFocusSeconds += safeCounter(row.verifiedFocusSeconds);
        }
      }

      const scores = new Map<string, number>();
      let maxScore = 0;
      for (const key of keys) {
        const score = activityScore(ensure(key));
        scores.set(key, score);
        maxScore = Math.max(maxScore, score);
      }

      const days: StudyStreakDay[] = keys.map((key) => {
        const entry = ensure(key);
        const score = scores.get(key) ?? 0;
        return { ...entry, active: score > 0, intensity: computeIntensity(score, maxScore) };
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
        activityRuleVersion: "study-day-v1",
        days,
      };
    },
  };
}

export const studyStreakService = createStudyStreakService();
