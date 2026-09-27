import { getPrisma } from "../../services/prismaClient.js";
import {
  fetchPrivateReadJson,
  logPrivateReadFallback,
} from "../../services/privateD1Read.js";
import { Prisma } from "@prisma/client";
import { refreshUserLectureRetention } from "./retentionRefresh.js";
import { RETENTION_RULE_VERSION } from "./retentionConstants.js";
import { MASTERY_STATES, type MasteryState } from "../study-core/constants.js";
import {
  lectureMasteryD1Payload,
  lectureRetentionD1Payload,
} from "./d1Projection.js";

const REVIEWS = ["INSUFFICIENT_EVIDENCE", "FRESH", "DUE_SOON", "DUE", "OVERDUE"] as const;
type ReviewState = (typeof REVIEWS)[number];
type CacheRow = Record<string, any>;

export type MasterySummary = {
  lectureId: string; subjectId: string | null; state: string; effectiveState: string;
  reviewState: string; nextReviewAt: string | null; lastEvaluatedAt: string;
  objectiveAttempts?: number; objectiveAccuracyPercent?: number | null; flashcardReviews?: number;
};
export type Dashboard = {
  generatedAt: string;
  sourceFreshness: { source: "D1" | "POSTGRESQL"; stale: boolean };
  totals: Record<string, any>; reviewStateCounts: Record<string, number>;
  dueReviewCount: number; overdueCount: number;
  subjects: Array<{
    subjectId: string;
    trackedLectures: number;
    mastery: Record<string, number>;
    review: { dueSoon: number; due: number; overdue: number };
  }>;
  review: Record<string, number>;
  dueReviews: MasterySummary[];
};

function cacheEnabled() {
  const on = (name: string) => ["1", "true", "yes", "on"].includes(String(process.env[name] ?? "").trim().toLowerCase());
  return on("MASTERY_D1_PROJECTION_ENABLED") && on("MASTERY_D1_READ_ENABLED");
}
function cacheTimeStale(payload: any): boolean {
  if (payload?.counts?.min_next_evaluation_at == null) return false;
  const nextEvaluationAt = Date.parse(payload.counts.min_next_evaluation_at);
  return Number.isFinite(nextEvaluationAt) && nextEvaluationAt <= Date.now();
}
function logMasteryFallback(scope: string, error: unknown): void {
  const reason = error instanceof Error ? error.message.split(":")[0] : "";
  logPrivateReadFallback(
    reason.startsWith("MASTERY_D1_") ? reason : `MASTERY_D1_READ_UNAVAILABLE:${scope}`,
    error,
  );
}
function rowSummary(row: CacheRow): MasterySummary {
  return {
    lectureId: String(row.lecture_id ?? row.lectureId), subjectId: row.subject_id ?? row.subjectId ?? null,
    state: String(row.state ?? row.effective_mastery_state),
    effectiveState: String(row.effective_mastery_state ?? row.state),
    reviewState: String(row.review_state ?? row.reviewState ?? "INSUFFICIENT_EVIDENCE"),
    nextReviewAt: row.next_review_at ?? row.nextReviewAt ?? null,
    lastEvaluatedAt: String(row.last_evaluated_at ?? row.lastEvaluatedAt ?? row.updated_at ?? ""),
  };
}
export function masterySummaryDto(row: CacheRow): any {
  const attempts = Number(row.objective_attempt_count ?? 0);
  const summary = rowSummary(row);
  return { lectureId: summary.lectureId, subjectId: summary.subjectId, masteryState: String(row.state ?? row.effective_mastery_state),
    effectiveMasteryState: summary.effectiveState, reviewState: summary.reviewState, nextReviewAt: summary.nextReviewAt,
    lastEvaluatedAt: summary.lastEvaluatedAt,
    objectiveAttempts: attempts, objectiveAccuracyPercent: attempts ? Number(row.objective_correct_count ?? 0) / attempts * 100 : null,
    flashcardReviews: Number(row.flashcard_review_count ?? 0) };
}
const dtoRow = masterySummaryDto;
export function validMasteryCacheShape(payload: any, userId: string): payload is any {
  if (!payload || payload.schema_version !== "mastery-private-cache-v1" || !payload.state ||
      payload.state.user_id !== userId) return false;
  if (!payload.counts || payload.counts.mastery_count === undefined ||
      payload.counts.retention_count === undefined ||
      payload.counts.unsupported_rule_count === undefined) return false;
  if (payload.state.deleted_at != null || payload.state.deletion_revision != null && !/^\d+$/.test(String(payload.state.deletion_revision))) return false;
  if (!/^\d+$/.test(String(payload.state.mastery_watermark ?? "")) || !/^\d+$/.test(String(payload.state.retention_watermark ?? ""))) return false;
  if (payload.counts.min_next_evaluation_at != null) {
    const nextEvaluationAt = Date.parse(payload.counts.min_next_evaluation_at);
    if (!Number.isFinite(nextEvaluationAt) || nextEvaluationAt <= Date.now()) return false;
  }
  const rows = payload.rows === undefined ? payload.due : payload.rows;
  if (!Array.isArray(rows)) return false;
  const states = new Set(MASTERY_STATES);
  const rowsValid = rows.every((r: any) =>
    r && r.user_id === userId && typeof (r.lecture_id ?? r.lectureId) === "string" && typeof r.state === "string" &&
    states.has(r.state) && REVIEWS.includes(r.review_state) &&
    ((r.subject_id ?? r.subjectId) == null || typeof (r.subject_id ?? r.subjectId) === "string") &&
    Number.isInteger(Number(r.objective_attempt_count ?? 0)) &&
    Number.isInteger(Number(r.objective_correct_count ?? 0)) &&
    Number.isInteger(Number(r.flashcard_review_count ?? 0)));
  if (!rowsValid) return false;
  return payload.rows !== undefined || (!!payload.totals && Array.isArray(payload.subjectAggregates));
}
const validCache = validMasteryCacheShape;
function summarize(rows: MasterySummary[], source: "D1" | "POSTGRESQL", stale = false): Dashboard {
  const counts: Record<string, number> = Object.fromEntries(MASTERY_STATES.map(s => [s, 0]));
  const reviews: Record<string, number> = Object.fromEntries(REVIEWS.map(s => [s, 0]));
  const subjects = new Map<string, {
    trackedLectures: number;
    mastery: Record<string, number>;
    review: { dueSoon: number; due: number; overdue: number };
  }>();
  const stateKeys: Record<string, string> = {
    NOT_STARTED: "notStarted", STARTED: "started", LEARNING: "learning",
    NEEDS_REVIEW: "needsReview", GOOD: "good", MASTERED: "mastered",
  };
  for (const row of rows) {
    if (counts[row.state] !== undefined) counts[row.state]++;
    if (reviews[row.reviewState] !== undefined) reviews[row.reviewState]++;
    if (row.subjectId) {
      const item = subjects.get(row.subjectId) ?? {
        trackedLectures: 0,
        mastery: { notStarted: 0, started: 0, learning: 0, needsReview: 0, good: 0, mastered: 0 },
        review: { dueSoon: 0, due: 0, overdue: 0 },
      };
      item.trackedLectures++;
      const stateKey = stateKeys[row.state];
      if (stateKey) item.mastery[stateKey]++;
      if (row.reviewState === "DUE_SOON") item.review.dueSoon++;
      if (row.reviewState === "DUE") item.review.due++;
      if (row.reviewState === "OVERDUE") item.review.overdue++;
      subjects.set(row.subjectId, item);
    }
  }
  const due = rows.filter(r => r.effectiveState === "NEEDS_REVIEW" && (r.reviewState === "DUE" || r.reviewState === "OVERDUE"))
    .sort((a, b) => (a.nextReviewAt ?? "").localeCompare(b.nextReviewAt ?? "")).slice(0, 10);
  return {
    generatedAt: new Date().toISOString(), sourceFreshness: { source, stale },
    totals: {
      total: rows.length, trackedLectures: rows.length,
      notStarted: counts.NOT_STARTED, started: counts.STARTED, learning: counts.LEARNING,
      needsReview: counts.NEEDS_REVIEW, good: counts.GOOD, mastered: counts.MASTERED,
      recentlyEvaluatedCount: rows.filter(r => {
        const age = Date.now() - Date.parse(r.lastEvaluatedAt);
        return Number.isFinite(age) && age >= 0 && age <= 7 * 86400000;
      }).length,
    },
    reviewStateCounts: reviews,
    dueReviewCount: rows.filter(r => r.effectiveState === "NEEDS_REVIEW" && (r.reviewState === "DUE" || r.reviewState === "OVERDUE")).length,
    overdueCount: rows.filter(r => r.effectiveState === "NEEDS_REVIEW" && r.reviewState === "OVERDUE").length,
    subjects: [...subjects].sort(([a], [b]) => a.localeCompare(b)).map(([subjectId, value]) => ({ subjectId, ...value })),
    review: {
      insufficientEvidence: reviews.INSUFFICIENT_EVIDENCE, fresh: reviews.FRESH,
      dueSoon: reviews.DUE_SOON, due: reviews.DUE, overdue: reviews.OVERDUE,
      dueReviewCount: rows.filter(r => r.effectiveState === "NEEDS_REVIEW" && (r.reviewState === "DUE" || r.reviewState === "OVERDUE")).length,
      overdueCount: rows.filter(r => r.effectiveState === "NEEDS_REVIEW" && r.reviewState === "OVERDUE").length,
    },
    dueReviews: due.map((r: any) => dtoRow({ lecture_id: r.lectureId, subject_id: r.subjectId, state: r.state,
      effective_mastery_state: r.effectiveState, review_state: r.reviewState, next_review_at: r.nextReviewAt,
      last_evaluated_at: r.lastEvaluatedAt, objective_attempt_count: r.objectiveAttempts,
      objective_correct_count: r.objectiveAccuracyPercent && r.objectiveAttempts ? r.objectiveAccuracyPercent * r.objectiveAttempts / 100 : 0,
      flashcard_review_count: r.flashcardReviews })),
  };
}
function foldSubjects(rows: any[]) {
  const grouped = new Map<string, any>();
  for (const row of rows) {
    if (row.subject_id == null) continue;
    const id = String(row.subject_id);
    const value = grouped.get(id) ?? { subjectId: id, trackedLectures: 0,
      mastery: { notStarted: 0, started: 0, learning: 0, needsReview: 0, good: 0, mastered: 0 },
      review: { dueSoon: 0, due: 0, overdue: 0 } };
    value.trackedLectures += Number(row.count ?? 0);
    const mastery = parseCounts(row.mastery_state_counts);
    value.mastery.notStarted += Number(mastery.NOT_STARTED ?? 0);
    value.mastery.started += Number(mastery.STARTED ?? 0);
    value.mastery.learning += Number(mastery.LEARNING ?? 0);
    value.mastery.needsReview += Number(mastery.NEEDS_REVIEW ?? 0);
    value.mastery.good += Number(mastery.GOOD ?? 0);
    value.mastery.mastered += Number(mastery.MASTERED ?? 0);
    const review = parseCounts(row.review_state_counts);
    value.review.dueSoon += Number(review.DUE_SOON ?? 0);
    value.review.due += Number(review.DUE ?? 0);
    value.review.overdue += Number(review.OVERDUE ?? 0);
    grouped.set(id, value);
  }
  return [...grouped.values()].sort((a, b) => a.subjectId.localeCompare(b.subjectId));
}
function parseCounts(value: unknown): Record<string, number> {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, number>
    : {};
}

async function validateCanonical(userId: string, payload: any): Promise<void> {
  const db: any = getPrisma();
  const state = await db.masteryD1ProjectionState.findUnique({ where: { userId } });
  const wm = (v: any) => BigInt(v ?? 0).toString();
  if (!state || wm(payload.state.mastery_watermark) !== wm(state.masteryWatermark) ||
      wm(payload.state.retention_watermark) !== wm(state.retentionWatermark) ||
      payload.state.deleted_at != null) throw new Error("MASTERY_D1_WATERMARK_MISMATCH");
  const mastery = await db.lectureMastery.count({ where: { userId } });
  const retention = await db.lectureRetention.count({ where: { userId } });
  if (Number(payload.counts?.mastery_count) !== mastery || Number(payload.counts?.retention_count) !== retention ||
      Number(payload.counts?.unsupported_rule_count ?? 0) !== 0) throw new Error("MASTERY_D1_COUNT_MISMATCH");
  const stale = await db.lectureRetention.findFirst({ where: { userId, nextEvaluationAt: { lte: new Date() } }, select: { lectureId: true } });
  if (stale) throw new Error("MASTERY_D1_TIME_STALE");
  // JSON key matching is deliberately done in SQL: Prisma's JSON equality varies by connector.
  const pending: any[] = await db.$queryRaw(Prisma.sql`SELECT "id" FROM "PrivateD1SyncOutbox" WHERE "entity" IN ('LectureMastery','LectureRetention') AND (("key"->>'user_id') = ${userId} OR ("data"->>'user_id') = ${userId}) LIMIT 1`);
  if (pending.length) throw new Error("MASTERY_D1_PENDING_OUTBOX");
}
async function cachePayload(path: string, userId: string, params: any): Promise<any> {
  const payload = await fetchPrivateReadJson<any>(path, { userId, ...params });
  if (cacheTimeStale(payload)) throw new Error("MASTERY_D1_TIME_STALE");
  if (!validCache(payload, userId)) throw new Error("MASTERY_D1_SCHEMA_INVALID");
  await validateCanonical(userId, payload);
  return payload;
}

async function postgresRows(userId: string, filter?: { subjectId?: string; state?: string; reviewState?: string }) {
  const db = getPrisma();
  const mastery = await db.lectureMastery.findMany({
    where: { userId, ...(filter?.state ? { state: filter.state } : {}) },
    select: { lectureId: true, state: true, lastEvaluatedAt: true, revision: true, ruleVersion: true,
      objectiveAttemptCount: true, objectiveCorrectCount: true, flashcardReviewCount: true },
  });
  const ids = mastery.map((r: any) => r.lectureId);
  const lectures = ids.length ? await db.lecture.findMany({ where: { id: { in: ids } }, select: { id: true, mainSubject: true } }) : [];
  const byLecture = new Map(lectures.map((l: any) => [l.id, l.mainSubject]));
  const retention = ids.length ? await db.lectureRetention.findMany({ where: { userId, lectureId: { in: ids } } }) : [];
  const byRetention = new Map<string, any>(retention.map((r: any) => [r.lectureId, r] as [string, any]));
  const staleIds = mastery.filter((m: any) => {
    const r = byRetention.get(m.lectureId);
    return !r || r.sourceMasteryRevision !== m.revision || r.sourceMasteryRuleVersion !== m.ruleVersion ||
      (r.nextEvaluationAt && r.nextEvaluationAt <= new Date()) || r.ruleVersion !== RETENTION_RULE_VERSION;
  }).map((m: any) => m.lectureId);
  for (let i = 0; i < staleIds.length; i += 100) await refreshUserLectureRetention({ userId, lectureIds: staleIds.slice(i, i + 100) });
  const refreshed = staleIds.length ? await db.lectureRetention.findMany({ where: { userId, lectureId: { in: ids } } }) : retention;
  const allRetention = new Map<string, any>(refreshed.map((r: any) => [r.lectureId, r] as [string, any]));
  return mastery.map((m: any) => {
    const r = allRetention.get(m.lectureId);
    return { lectureId: m.lectureId, subjectId: byLecture.get(m.lectureId) ?? null, state: m.state,
      effectiveState: r?.effectiveMasteryState ?? m.state, reviewState: r?.reviewState ?? "INSUFFICIENT_EVIDENCE",
      nextReviewAt: r?.nextReviewAt?.toISOString() ?? null, lastEvaluatedAt: m.lastEvaluatedAt.toISOString(),
      objectiveAttempts: m.objectiveAttemptCount, objectiveAccuracyPercent: m.objectiveAttemptCount ? m.objectiveCorrectCount / m.objectiveAttemptCount * 100 : null,
      flashcardReviews: m.flashcardReviewCount };
  }).filter((r: MasterySummary) => !filter?.subjectId || r.subjectId === filter.subjectId)
    .filter((r: MasterySummary) => !filter?.reviewState || r.reviewState === filter.reviewState);
}

export async function readMasteryDashboard(userId: string): Promise<Dashboard> {
  if (cacheEnabled()) {
    try {
      const payload = await cachePayload("/internal/private-read/mastery-dashboard", userId, {});
      if (validCache(payload, userId)) {
        if (!payload.rows) {
          const due = (payload.due as CacheRow[]).map(dtoRow);
          const byState = parseCounts(payload.totals.byState);
          const reviewStateCounts = parseCounts(payload.counts.review_state_counts);
          const dueReviewCount = Number(payload.counts.due_review_count ?? due.length);
          const overdueCount = Number(payload.counts.overdue_count ?? due.filter(r => r.reviewState === "OVERDUE").length);
          const review = {
            insufficientEvidence: Number(reviewStateCounts.INSUFFICIENT_EVIDENCE ?? 0),
            fresh: Number(reviewStateCounts.FRESH ?? 0),
            dueSoon: Number(reviewStateCounts.DUE_SOON ?? 0),
            due: Number(reviewStateCounts.DUE ?? 0),
            overdue: Number(reviewStateCounts.OVERDUE ?? 0),
            dueReviewCount,
            overdueCount,
          };
          return {
            generatedAt: new Date().toISOString(), sourceFreshness: { source: "D1", stale: false },
            totals: {
              total: Number(payload.totals.total ?? payload.counts.mastery_count),
              trackedLectures: Number(payload.counts.mastery_count),
              notStarted: Number(byState.NOT_STARTED ?? 0),
              started: Number(byState.STARTED ?? 0),
              learning: Number(byState.LEARNING ?? 0),
              needsReview: Number(byState.NEEDS_REVIEW ?? 0),
              good: Number(byState.GOOD ?? 0),
              mastered: Number(byState.MASTERED ?? 0),
              recentlyEvaluatedCount: Number(payload.counts.recently_evaluated_count ?? 0),
            },
            reviewStateCounts,
            dueReviewCount,
            overdueCount,
            subjects: foldSubjects(payload.subjectAggregates ?? []),
            review,
            dueReviews: due.slice(0, 10),
          };
        }
        return summarize(payload.rows.map(rowSummary), "D1");
      }
      throw new Error("malformed mastery cache payload");
    } catch (e) { logMasteryFallback("dashboard", e); }
  }
  return summarize(await postgresRows(userId), "POSTGRESQL");
}

/** Cache-first detail read. The returned shape intentionally mirrors the legacy
 * detail endpoint, while omitting projection scores and raw evidence. */
export async function readMasteryLectureDetail(userId: string, lectureId: string): Promise<any> {
  if (cacheEnabled()) {
    try {
      const raw = await fetchPrivateReadJson<any>("/internal/private-read/mastery-lecture", { userId, lectureId });
      if (cacheTimeStale(raw)) throw new Error("MASTERY_D1_TIME_STALE");
      if (!validMasteryCacheShape({ ...raw, rows: [] }, userId)) {
        throw new Error("MASTERY_D1_SCHEMA_MISMATCH");
      }
      await validateCanonical(userId, raw);
      const d1Mastery = raw.mastery;
      const d1Retention = raw.retention;
      if (!d1Mastery || !d1Retention ||
          d1Mastery.user_id !== userId || d1Mastery.lecture_id !== lectureId ||
          d1Retention.user_id !== userId || d1Retention.lecture_id !== lectureId) {
        throw new Error("MASTERY_D1_ROW_MISSING");
      }
      const db: any = getPrisma();
      const [mastery, retention, lecture] = await Promise.all([
        db.lectureMastery.findFirst({ where: { userId, lectureId } }),
        db.lectureRetention.findFirst({ where: { userId, lectureId } }),
        db.lecture.findUnique({ where: { id: lectureId }, select: { mainSubject: true } }),
      ]);
      if (!mastery || !retention || !lecture) throw new Error("MASTERY_D1_CANONICAL_ROW_MISSING");
      if (!sameProjection(lectureMasteryD1Payload(mastery, lecture.mainSubject ?? null), d1Mastery) ||
          !sameProjection(lectureRetentionD1Payload(retention), d1Retention)) {
        throw new Error("MASTERY_D1_ROW_MISMATCH");
      }
      const attempts = Number(d1Mastery.objective_attempt_count ?? 0);
      return {
        lectureId, state: d1Mastery.state, evidenceState: d1Mastery.state,
        effectiveState: d1Retention.effective_mastery_state,
        reviewState: d1Retention.review_state, reviewUrgency: d1Retention.review_state,
        nextReviewAt: d1Retention.next_review_at ?? null,
        ruleVersion: d1Mastery.rule_version, retentionRuleVersion: d1Retention.rule_version,
        lastEvaluatedAt: d1Mastery.last_evaluated_at,
        retentionLastEvaluatedAt: d1Retention.last_evaluated_at,
        evidence: {
          objectiveAttempts: attempts,
          objectiveCorrect: Number(d1Mastery.objective_correct_count ?? 0),
          objectiveAccuracyPercent: attempts ? Number(d1Mastery.objective_correct_count ?? 0) / attempts * 100 : null,
          flashcardReviews: Number(d1Mastery.flashcard_review_count ?? 0),
          meaningfulFocusSeconds: Number(d1Mastery.meaningful_focus_seconds ?? 0),
          recallObjectiveAttempts: Number(d1Mastery.recall_objective_attempt_count ?? 0),
        },
      };
    } catch (e) { logMasteryFallback("lecture", e); }
  }
  return null;
}
function sameProjection(expected: Record<string, unknown>, actual: CacheRow): boolean {
  return Object.entries(expected).every(([key, value]) => {
    const normalize = (candidate: unknown) => {
      if (candidate instanceof Date) return candidate.toISOString();
      if (key.endsWith("_at") && typeof candidate === "string") {
        const time = Date.parse(candidate);
        return Number.isFinite(time) ? new Date(time).toISOString() : candidate;
      }
      return candidate;
    };
    return JSON.stringify(normalize(value) ?? null) === JSON.stringify(normalize(actual[key]) ?? null);
  });
}
export async function readMasteryLectures(userId: string, options: { state?: string; reviewState?: string; subjectId?: string; limit: number; cursor?: string }) {
  if (cacheEnabled()) {
    try {
      const payload = await cachePayload("/internal/private-read/mastery-lectures", userId, options);
      return { rows: payload.rows.map(dtoRow), nextCursor: payload.nextCursor ?? payload.next_cursor ?? null };
    } catch (e) { logMasteryFallback("lectures", e); }
  }
  const filter = { state: options.state, reviewState: options.reviewState, subjectId: options.subjectId };
  const rows = await postgresRows(userId, filter);
  rows.sort((a, b) => a.lectureId.localeCompare(b.lectureId));
  const start = options.cursor ? rows.findIndex(r => r.lectureId > options.cursor) : 0;
  if (options.cursor && start < 0) return { rows: [], nextCursor: null };
  const page = rows.slice(start, start + options.limit);
  return { rows: page.map((r: any) => dtoRow({ lecture_id: r.lectureId, subject_id: r.subjectId, state: r.state,
    effective_mastery_state: r.effectiveState, review_state: r.reviewState, next_review_at: r.nextReviewAt,
    last_evaluated_at: r.lastEvaluatedAt, objective_attempt_count: r.objectiveAttempts,
    objective_correct_count: r.objectiveAccuracyPercent && r.objectiveAttempts ? r.objectiveAccuracyPercent * r.objectiveAttempts / 100 : 0,
    flashcard_review_count: r.flashcardReviews })), nextCursor: rows.length > start + options.limit ? page.at(-1)?.lectureId ?? null : null };
}
export async function readMasteryReviews(userId: string, options: { reviewState?: string; subjectId?: string; limit: number; cursor?: string }) {
  if (cacheEnabled()) {
    try {
      const payload = await cachePayload("/internal/private-read/mastery-reviews", userId, options);
      return { rows: payload.rows.map(dtoRow), nextCursor: payload.nextCursor ?? payload.next_cursor ?? null };
    } catch (e) { logMasteryFallback("reviews", e); }
  }
  const rows = (await postgresRows(userId, { subjectId: options.subjectId }))
    .filter(r => r.effectiveState === "NEEDS_REVIEW" && (r.reviewState === "DUE" || r.reviewState === "OVERDUE"))
    .filter(r => !options.reviewState || r.reviewState === options.reviewState)
    .sort((a, b) => a.lectureId.localeCompare(b.lectureId));
  const start = options.cursor ? rows.findIndex(r => r.lectureId > options.cursor) : 0;
  if (options.cursor && start < 0) return { rows: [], nextCursor: null };
  const page = rows.slice(start, start + options.limit);
  return { rows: page.map((r: any) => dtoRow({ lecture_id: r.lectureId, subject_id: r.subjectId, state: r.state, effective_mastery_state: r.effectiveState, review_state: r.reviewState, next_review_at: r.nextReviewAt, last_evaluated_at: r.lastEvaluatedAt, objective_attempt_count: r.objectiveAttempts, flashcard_review_count: r.flashcardReviews })), nextCursor: rows.length > start + options.limit ? page.at(-1)?.lectureId ?? null : null };
}