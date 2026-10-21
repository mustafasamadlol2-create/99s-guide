import { getPrisma } from "../../services/prismaClient.js";
import { getBaghdadMetricDate, metricDateAsUtcDate } from "../study-events/date.js";

export const TODAY_STUDY_TIME_ZONE = "Asia/Baghdad";

export type TodayStudySummary = {
  timeZone: typeof TODAY_STUDY_TIME_ZONE;
  date: string;
  resetAt: string;
  focusSeconds: number;
  lecturesCompleted: number;
  mcqAttempts: number;
  flashcardReviews: number;
  videosCompleted: number;
  pointsEarned: number;
  updatedAt: string;
  sourceVersion: "today-study-v1";
};

type DailyMetricRow = {
  focusSeconds: number;
  lectureCompletions: number;
  mcqAttempts: number;
  flashcardReviews: number;
} | null;

type StudyEventRow = {
  eventType: string;
  lectureId: string | null;
  payload: unknown;
  receivedAt: Date;
};

type GroupFocusRow = { verifiedFocusSeconds: number };
type PointsAggregate = { _sum: { amount: number | null } };

export type TodayStudyDatabase = {
  studyDailyMetric: {
    findUnique(args: unknown): Promise<DailyMetricRow>;
  };
  studyEvent: {
    findMany(args: unknown): Promise<StudyEventRow[]>;
  };
  groupFocusParticipantSummary: {
    findMany(args: unknown): Promise<GroupFocusRow[]>;
  };
  videoWatchProgress: {
    count(args: unknown): Promise<number>;
  };
  studyPointsLedgerEntry: {
    aggregate(args: unknown): Promise<PointsAggregate>;
  };
};

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const value = new Date(`${dateKey}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + deltaDays);
  return value.toISOString().slice(0, 10);
}

function baghdadDayStart(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00+03:00`);
}

function safeCount(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.trunc(numberValue) : 0;
}

function focusSecondsFromEvent(row: StudyEventRow): number {
  if (row.eventType !== "focus_session_completed") return 0;
  if (!row.payload || typeof row.payload !== "object") return 0;
  return safeCount((row.payload as Record<string, unknown>).activeSeconds);
}

export function createTodayStudyService(options: {
  database?: TodayStudyDatabase;
  now?: () => Date;
} = {}) {
  const database = options.database ?? (getPrisma() as unknown as TodayStudyDatabase);
  const now = options.now ?? (() => new Date());

  return {
    async getSummary(userId: string): Promise<TodayStudySummary> {
      if (!userId || typeof userId !== "string") throw new Error("userId is required");
      const asOf = now();
      if (!Number.isFinite(asOf.getTime())) throw new Error("server time is invalid");

      const date = getBaghdadMetricDate(asOf);
      const startAt = baghdadDayStart(date);
      const resetAt = baghdadDayStart(shiftDateKey(date, 1));
      const metricDate = metricDateAsUtcDate(date);

      // Reads are intentionally fail-soft. The Today card is a private read model
      // assembled from canonical records and an existing daily metric projection.
      // One delayed projection must not blank the entire Profile card.
      const reads = await Promise.allSettled([
        database.studyDailyMetric.findUnique({
          where: { userId_metricDate: { userId, metricDate } },
          select: {
            focusSeconds: true,
            lectureCompletions: true,
            mcqAttempts: true,
            flashcardReviews: true,
          },
        }),
        database.studyEvent.findMany({
          where: {
            userId,
            receivedAt: { gte: startAt, lt: resetAt },
            eventType: {
              in: [
                "focus_session_completed",
                "lecture_completion_confirmed",
                "mcq_attempted",
                "flashcard_reviewed",
              ],
            },
          },
          select: {
            eventType: true,
            lectureId: true,
            payload: true,
            receivedAt: true,
          },
          orderBy: { receivedAt: "asc" },
        }),
        database.groupFocusParticipantSummary.findMany({
          where: {
            userId,
            verifiedFocusSeconds: { gt: 0 },
            run: { runtimeEndedAt: { gte: startAt, lt: resetAt } },
          },
          select: { verifiedFocusSeconds: true },
        }),
        database.videoWatchProgress.count({
          where: {
            userId,
            completedAt: { gte: startAt, lt: resetAt },
          },
        }),
        database.studyPointsLedgerEntry.aggregate({
          where: {
            userId,
            createdAt: { gte: startAt, lt: resetAt },
          },
          _sum: { amount: true },
        }),
      ] as const);

      if (reads.every((read) => read.status === "rejected")) {
        throw new Error("All Today study sources are unavailable.");
      }

      const metric = reads[0].status === "fulfilled" ? reads[0].value : null;
      const events = reads[1].status === "fulfilled" ? reads[1].value : [];
      const groupRows = reads[2].status === "fulfilled" ? reads[2].value : [];
      const videosCompleted = reads[3].status === "fulfilled" ? safeCount(reads[3].value) : 0;
      const pointsEarned = reads[4].status === "fulfilled"
        ? Number(reads[4].value._sum.amount ?? 0)
        : 0;

      for (const [source, read] of [
        ["daily_metric", reads[0]],
        ["study_event", reads[1]],
        ["group_focus", reads[2]],
        ["video_progress", reads[3]],
        ["points_ledger", reads[4]],
      ] as const) {
        if (read.status === "rejected") {
          console.warn(`[TodayStudy] ${source} source unavailable; continuing with fallbacks.`);
        }
      }

      let eventFocusSeconds = 0;
      let eventMcqAttempts = 0;
      let eventFlashcardReviews = 0;
      const completedLectureIds = new Set<string>();

      for (const row of events) {
        if (row.eventType === "focus_session_completed") {
          eventFocusSeconds += focusSecondsFromEvent(row);
        } else if (row.eventType === "mcq_attempted") {
          eventMcqAttempts += 1;
        } else if (row.eventType === "flashcard_reviewed") {
          eventFlashcardReviews += 1;
        } else if (row.eventType === "lecture_completion_confirmed" && row.lectureId) {
          completedLectureIds.add(row.lectureId);
        }
      }

      const groupFocusSeconds = groupRows.reduce(
        (total, row) => total + safeCount(row.verifiedFocusSeconds),
        0,
      );

      // StudyDailyMetric is the compact canonical-derived daily projection. Study
      // Events are used as a freshness fallback so a just-finished activity can
      // appear before a projection read catches up. max() avoids double-counting.
      const soloFocusSeconds = Math.max(
        safeCount(metric?.focusSeconds),
        eventFocusSeconds,
      );
      const lecturesCompleted = Math.max(
        safeCount(metric?.lectureCompletions),
        completedLectureIds.size,
      );
      const mcqAttempts = Math.max(
        safeCount(metric?.mcqAttempts),
        eventMcqAttempts,
      );
      const flashcardReviews = Math.max(
        safeCount(metric?.flashcardReviews),
        eventFlashcardReviews,
      );

      return {
        timeZone: TODAY_STUDY_TIME_ZONE,
        date,
        resetAt: resetAt.toISOString(),
        focusSeconds: soloFocusSeconds + groupFocusSeconds,
        lecturesCompleted,
        mcqAttempts,
        flashcardReviews,
        videosCompleted,
        pointsEarned: Number.isFinite(pointsEarned) ? pointsEarned : 0,
        updatedAt: asOf.toISOString(),
        sourceVersion: "today-study-v1",
      };
    },
  };
}

export const todayStudyService = createTodayStudyService();
