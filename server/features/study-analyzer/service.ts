import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { getStudyFeatureFlags } from "../study-core/featureFlags.js";
import {
  baghdadDayStartDaysBefore,
  resolveStudyAnalyzerWindows,
} from "./dateWindows.js";
import { buildStudyAnalyzerDto } from "./calculations.js";
import { STUDY_ANALYZER_MAX_SOURCE_ROWS, STUDY_ANALYZER_LOOKBACK_DAYS } from "./constants.js";
import type {
  StudyAnalyzerDto,
  StudyAnalyzerEventRow,
  StudyAnalyzerFocusRow,
  StudyAnalyzerGroupFocusRow,
  StudyAnalyzerMasteryRow,
  StudyAnalyzerRecallRow,
  StudyAnalyzerRetentionRow,
  StudyAnalyzerSnapshot,
  StudyAnalyzerSourceSlice,
} from "./types.js";

type StudyAnalyzerDatabase = Pick<
  PrismaClient,
  | "focusSession"
  | "groupFocusParticipantSummary"
  | "studyEvent"
  | "recallAttempt"
  | "lectureMastery"
  | "lectureRetention"
  | "lecture"
>;

type SliceOptions<T> = {
  query: () => Promise<T[]>;
  queryFrom: Date;
  complete: boolean;
  timestampOf?: (row: T) => Date | null;
};

function unavailable<T>(): StudyAnalyzerSourceSlice<T> {
  return {
    available: false,
    complete: false,
    truncated: false,
    coverageStart: null,
    rows: [],
  };
}

async function readSlice<T>({
  query,
  queryFrom,
  complete,
  timestampOf,
}: SliceOptions<T>): Promise<StudyAnalyzerSourceSlice<T>> {
  try {
    const result = await query();
    const truncated = result.length > STUDY_ANALYZER_MAX_SOURCE_ROWS;
    const rows = result.slice(0, STUDY_ANALYZER_MAX_SOURCE_ROWS);
    const timestamps = timestampOf
      ? rows.map(timestampOf).filter((value): value is Date => value instanceof Date)
      : [];
    const earliestReturned = timestamps.length
      ? new Date(Math.min(...timestamps.map((value) => value.getTime())))
      : null;
    return {
      available: true,
      complete,
      truncated,
      coverageStart: truncated ? earliestReturned : queryFrom,
      rows,
    };
  } catch {
    return unavailable<T>();
  }
}

export function createStudyAnalyzerService(dependencies: {
  database?: StudyAnalyzerDatabase;
  now?: () => Date;
  getFeatureFlags?: typeof getStudyFeatureFlags;
} = {}): (userId: string) => Promise<StudyAnalyzerDto> {
  return async (userId) => {
    if (typeof userId !== "string" || userId.length === 0) {
      throw new Error("An authenticated user id is required.");
    }
    const now = dependencies.now ?? (() => new Date());
    const asOf = new Date(now().getTime());
    if (!Number.isFinite(asOf.getTime())) throw new Error("Analyzer server time is invalid.");
    const database = dependencies.database ?? getPrisma() as StudyAnalyzerDatabase;
    const flags = (dependencies.getFeatureFlags ?? getStudyFeatureFlags)();
    const { resolved: windows } = resolveStudyAnalyzerWindows(asOf);
    const calendarLookback = baghdadDayStartDaysBefore(
      asOf,
      STUDY_ANALYZER_LOOKBACK_DAYS - 1,
    );
    const queryFrom = windows.currentSemester && windows.currentSemester.from < calendarLookback
      ? windows.currentSemester.from
      : calendarLookback;
    const maximum = STUDY_ANALYZER_MAX_SOURCE_ROWS + 1;

    const [
      focus,
      groupFocus,
      mcq,
      flashcards,
      recall,
      masteryRows,
      trackedLectureCount,
      retention,
    ] = await Promise.all([
      readSlice<StudyAnalyzerFocusRow>({
        queryFrom,
        complete: flags.FOCUS_HUB_ENABLED,
        timestampOf: (row) => row.actualEndedAt,
        query: () => database.focusSession.findMany({
          where: {
            userId,
            status: { in: ["COMPLETED", "ABANDONED", "EXPIRED"] },
            startedAt: { not: null },
            actualEndedAt: { gte: queryFrom, lte: asOf },
          },
          select: {
            id: true,
            lectureId: true,
            status: true,
            startedAt: true,
            actualEndedAt: true,
            activeSeconds: true,
            lecture: { select: { mainSubject: true } },
          },
          orderBy: [{ actualEndedAt: "desc" }, { id: "desc" }],
          take: maximum,
        }),
      }),
      readSlice<StudyAnalyzerGroupFocusRow>({
        queryFrom,
        complete: flags.GROUP_FOCUS_ENABLED,
        timestampOf: (row) => row.run.runtimeEndedAt,
        query: () => database.groupFocusParticipantSummary.findMany({
          where: {
            userId,
            run: { runtimeEndedAt: { gte: queryFrom, lte: asOf } },
          },
          select: {
            id: true,
            effectiveLectureId: true,
            firstConnectedAt: true,
            verifiedFocusSeconds: true,
            effectiveLecture: { select: { mainSubject: true } },
            run: {
              select: {
                runtimeStartedAt: true,
                runtimeEndedAt: true,
                terminalReason: true,
              },
            },
          },
          orderBy: [{ run: { runtimeEndedAt: "desc" } }, { id: "desc" }],
          take: maximum,
        }),
      }),
      readSlice<StudyAnalyzerEventRow>({
        queryFrom,
        complete: flags.STUDY_EVENTS_ENABLED,
        timestampOf: (row) => row.receivedAt,
        query: () => database.studyEvent.findMany({
          where: {
            userId,
            eventType: "mcq_attempted",
            receivedAt: { gte: queryFrom, lte: asOf },
          },
          select: {
            id: true,
            eventType: true,
            source: true,
            evidenceClass: true,
            privacyClass: true,
            occurredAt: true,
            receivedAt: true,
            lectureId: true,
            mcqId: true,
            flashcardId: true,
            payload: true,
            mcq: {
              select: {
                lectureId: true,
                lecture: { select: { mainSubject: true } },
              },
            },
          },
          orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
          take: maximum,
        }),
      }),
      readSlice<StudyAnalyzerEventRow>({
        queryFrom,
        complete: flags.STUDY_EVENTS_ENABLED,
        timestampOf: (row) => row.receivedAt,
        query: () => database.studyEvent.findMany({
          where: {
            userId,
            eventType: "flashcard_reviewed",
            receivedAt: { gte: queryFrom, lte: asOf },
          },
          select: {
            id: true,
            eventType: true,
            source: true,
            evidenceClass: true,
            privacyClass: true,
            occurredAt: true,
            receivedAt: true,
            lectureId: true,
            mcqId: true,
            flashcardId: true,
            payload: true,
            flashcard: {
              select: {
                lectureId: true,
                lecture: { select: { mainSubject: true } },
              },
            },
          },
          orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
          take: maximum,
        }),
      }),
      readSlice<StudyAnalyzerRecallRow>({
        queryFrom,
        complete: flags.SPACED_RECALL_ENABLED,
        timestampOf: (row) => row.presentedAt,
        query: () => database.recallAttempt.findMany({
          where: {
            userId,
            OR: [
              { presentedAt: { gte: queryFrom, lte: asOf } },
              { answeredAt: { gte: queryFrom, lte: asOf } },
              { skippedAt: { gte: queryFrom, lte: asOf } },
              { expiredAt: { gte: queryFrom, lte: asOf } },
            ],
          },
          select: {
            id: true,
            itemType: true,
            itemId: true,
            lectureId: true,
            status: true,
            presentedAt: true,
            answeredAt: true,
            skippedAt: true,
            expiredAt: true,
            outcome: true,
            issuanceSource: true,
            evidenceClass: true,
            privacyClass: true,
          },
          orderBy: [{ presentedAt: "desc" }, { id: "desc" }],
          take: maximum,
        }),
      }),
      readSlice<StudyAnalyzerMasteryRow>({
        queryFrom: asOf,
        complete: true,
        query: () => database.lectureMastery.findMany({
          where: { userId },
          select: {
            lectureId: true,
            state: true,
            revision: true,
            ruleVersion: true,
            lastEvaluatedAt: true,
            lecture: { select: { mainSubject: true } },
          },
          orderBy: [{ lectureId: "asc" }],
          take: maximum,
        }),
      }),
      database.lectureMastery.count({ where: { userId } }).catch(() => null),
      readSlice<StudyAnalyzerRetentionRow>({
        queryFrom: asOf,
        complete: true,
        query: () => database.lectureRetention.findMany({
          where: { userId },
          select: {
            lectureId: true,
            sourceMasteryRevision: true,
            sourceMasteryRuleVersion: true,
            effectiveMasteryState: true,
            reviewState: true,
            reviewUrgencyScore: true,
            nextReviewAt: true,
            nextEvaluationAt: true,
            ruleVersion: true,
            objectiveForgettingItemCount: true,
          },
          orderBy: [{ lectureId: "asc" }],
          take: maximum,
        }),
      }),
    ]);

    const mastery = {
      ...masteryRows,
      available: masteryRows.available && trackedLectureCount !== null,
      complete: masteryRows.complete && trackedLectureCount !== null,
      trackedLectureCount,
    };
    const recallLectureIds = [...new Set(recall.rows.map((row) => row.lectureId))]
      .slice(0, STUDY_ANALYZER_MAX_SOURCE_ROWS);
    const lectureSubjects = recall.available
      ? recallLectureIds.length === 0
        ? {
            available: true,
            complete: true,
            truncated: false,
            coverageStart: queryFrom,
            rows: [],
          }
        : await readSlice({
            queryFrom,
            complete: recall.complete,
            query: () => database.lecture.findMany({
              where: { id: { in: recallLectureIds } },
              select: { id: true, mainSubject: true },
              orderBy: [{ id: "asc" }],
              take: STUDY_ANALYZER_MAX_SOURCE_ROWS + 1,
            }),
          })
      : unavailable<{ id: string; mainSubject: string | null }>();

    const snapshot: StudyAnalyzerSnapshot = {
      focus,
      groupFocus,
      mcq,
      flashcards,
      recall,
      mastery,
      retention,
      lectureSubjects,
    };
    return buildStudyAnalyzerDto(snapshot, asOf);
  };
}

export const readStudyAnalyzer = createStudyAnalyzerService();