import { apiClient } from "../../core/api/apiClient";

export type MasteryState =
  | "NOT_STARTED"
  | "STARTED"
  | "LEARNING"
  | "NEEDS_REVIEW"
  | "GOOD"
  | "MASTERED";
export type ReviewState =
  | "INSUFFICIENT_EVIDENCE"
  | "FRESH"
  | "DUE_SOON"
  | "DUE"
  | "OVERDUE";

export interface MasterySummary {
  generatedAt?: string;
  sourceFreshness?: { source?: string; stale?: boolean };
  totals: Record<string, number>;
  reviewStateCounts?: Record<string, number>;
  dueReviewCount: number;
  overdueCount: number;
  subjects?: Array<{
    subjectId: string;
    trackedLectures: number;
    mastery: Record<string, number>;
    review: Record<string, number>;
  }>;
}

export interface MasteryLectureRow {
  lectureId: string;
  subjectId?: string | null;
  masteryState: MasteryState;
  effectiveMasteryState?: MasteryState;
  reviewState: ReviewState;
  nextReviewAt?: string | null;
  lastEvaluatedAt?: string | null;
}

export interface MasteryLecturePage {
  rows: MasteryLectureRow[];
  nextCursor?: string | null;
}

export interface CanonicalReview {
  lectureId: string;
  effectiveMasteryState: MasteryState;
  reviewState: "DUE" | "OVERDUE";
  nextReviewAt?: string | null;
}

export interface CanonicalReviewPage {
  items: CanonicalReview[];
  nextCursor?: string | null;
}

export interface MasteryLectureDetail extends MasteryLectureRow {
  state?: MasteryState;
  evidenceState?: MasteryState;
  effectiveState?: MasteryState;
  reviewUrgency?: ReviewState;
  evidence?: {
    objectiveAttempts?: number;
    objectiveCorrect?: number;
    objectiveAccuracyPercent?: number | null;
    flashcardReviews?: number;
    meaningfulFocusSeconds?: number;
    recallObjectiveAttempts?: number;
  };
}

async function getJson<T>(path: string): Promise<T> {
  const response = await apiClient(path, {
    method: "GET",
    cache: "no-store",
    bypassCache: true,
    ttl: 0,
    silent: true,
  });
  return response.json() as Promise<T>;
}

export const masteryApi = {
  summary: () => getJson<MasterySummary>("/api/me/mastery"),
  lectures: (options: {
    limit?: number;
    state?: string;
    reviewState?: string;
    subjectId?: string;
    cursor?: string | null;
  } = {}) => {
    const params = new URLSearchParams({ limit: String(options.limit ?? 50) });
    if (options.state) params.set("state", options.state);
    if (options.reviewState) params.set("reviewState", options.reviewState);
    if (options.subjectId) params.set("subjectId", options.subjectId);
    if (options.cursor) params.set("cursor", options.cursor);
    return getJson<MasteryLecturePage>(`/api/me/mastery/lectures?${params.toString()}`);
  },
  reviews: (cursor?: string | null) => {
    const params = new URLSearchParams({ limit: "25" });
    if (cursor) params.set("cursor", cursor);
    return getJson<CanonicalReviewPage>(`/api/me/mastery/reviews/canonical?${params.toString()}`);
  },
  lecture: (lectureId: string) =>
    getJson<MasteryLectureDetail>(`/api/me/mastery/lectures/${encodeURIComponent(lectureId)}`),
};