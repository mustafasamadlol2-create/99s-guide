import { Prisma } from "@prisma/client";
import { MASTERY_MEANINGFUL_FOCUS_SECONDS } from "../mastery/constants.js";
import { RETENTION_RULE_VERSION } from "../mastery/retentionConstants.js";
import type {
  OwnerAcademicAggregateInput,
  OwnerAnalyticsSourceFilter,
} from "./types.js";
import {
  ELIGIBLE_STUDENTS_CTE,
  queryRows,
  scopedRowQuery,
  type OwnerAnalyticsDatabase,
  type ScopedAggregateRow,
} from "./queryParts.js";

export type PopulationCountRow = { eligible_students: bigint | number };

export type ContentScopeRow = ScopedAggregateRow & {
  lecture_count: bigint | number;
};

export type FocusAggregateRow = ScopedAggregateRow & {
  meaningful_sessions: bigint | number;
  verified_study_seconds: bigint | number;
  unique_users: bigint | number;
};

export type GroupFocusAggregateRow = ScopedAggregateRow & {
  completed_runs: bigint | number;
  verified_participant_sessions: bigint | number;
  verified_focus_seconds: bigint | number;
  unique_participants: bigint | number;
};

export type McqAggregateRow = ScopedAggregateRow & {
  objective_attempts: bigint | number;
  objective_correct: bigint | number;
  objective_incorrect: bigint | number;
  unique_users: bigint | number;
  distinct_items_attempted: bigint | number;
};

export type FlashcardAggregateRow = ScopedAggregateRow & {
  meaningful_reviews: bigint | number;
  self_reported_remembered: bigint | number;
  self_reported_not_remembered: bigint | number;
  self_reported_outcomes: bigint | number;
  unique_users: bigint | number;
  distinct_cards_reviewed: bigint | number;
};

export type RecallAggregateRow = ScopedAggregateRow & {
  periodic_presented: bigint | number;
  periodic_answered: bigint | number;
  periodic_skipped: bigint | number;
  periodic_expired: bigint | number;
  objective_mcq_answered: bigint | number;
  objective_mcq_correct: bigint | number;
  objective_mcq_incorrect: bigint | number;
  flashcard_remembered: bigint | number;
  flashcard_not_remembered: bigint | number;
  unique_users: bigint | number;
  periodic_presented_users: bigint | number;
  periodic_answered_users: bigint | number;
  periodic_skipped_users: bigint | number;
  periodic_expired_users: bigint | number;
  objective_mcq_unique_users: bigint | number;
  flashcard_remembered_users: bigint | number;
  flashcard_not_remembered_users: bigint | number;
};

export type ResourceAggregateRow = ScopedAggregateRow & {
  resource_handoffs: bigint | number;
  unique_users: bigint | number;
  pdf_handoffs: bigint | number;
  video_handoffs: bigint | number;
  pdf_unique_users: bigint | number;
  video_unique_users: bigint | number;
};

export type ActiveUsersAggregateRow = ScopedAggregateRow & {
  active_users: bigint | number;
};

export type CurrentStateAggregateRow = ScopedAggregateRow & {
  mastery_rows: bigint | number;
  tracked_users: bigint | number;
  base_not_started: bigint | number;
  base_started: bigint | number;
  base_learning: bigint | number;
  base_needs_review: bigint | number;
  base_good: bigint | number;
  base_mastered: bigint | number;
  fresh_effective_not_started: bigint | number;
  fresh_effective_started: bigint | number;
  fresh_effective_learning: bigint | number;
  fresh_effective_needs_review: bigint | number;
  fresh_effective_good: bigint | number;
  fresh_effective_mastered: bigint | number;
  fresh_retention_rows: bigint | number;
  stale_retention_rows: bigint | number;
  missing_retention_rows: bigint | number;
  review_insufficient_evidence: bigint | number;
  review_fresh: bigint | number;
  review_due_soon: bigint | number;
  review_due: bigint | number;
  review_overdue: bigint | number;
  forgetting_objective: bigint | number;
  forgetting_self_reported: bigint | number;
  forgetting_mixed: bigint | number;
  forgetting_none: bigint | number;
  base_not_started_users: bigint | number;
  base_started_users: bigint | number;
  base_learning_users: bigint | number;
  base_needs_review_users: bigint | number;
  base_good_users: bigint | number;
  base_mastered_users: bigint | number;
  fresh_effective_not_started_users: bigint | number;
  fresh_effective_started_users: bigint | number;
  fresh_effective_learning_users: bigint | number;
  fresh_effective_needs_review_users: bigint | number;
  fresh_effective_good_users: bigint | number;
  fresh_effective_mastered_users: bigint | number;
  fresh_retention_users: bigint | number;
  stale_retention_users: bigint | number;
  missing_retention_users: bigint | number;
  review_insufficient_evidence_users: bigint | number;
  review_fresh_users: bigint | number;
  review_due_soon_users: bigint | number;
  review_due_users: bigint | number;
  review_overdue_users: bigint | number;
  forgetting_objective_users: bigint | number;
  forgetting_self_reported_users: bigint | number;
  forgetting_mixed_users: bigint | number;
  forgetting_none_users: bigint | number;
};

export async function aggregatePopulation(
  database: OwnerAnalyticsDatabase,
): Promise<PopulationCountRow> {
  const rows = await queryRows<PopulationCountRow>(database, Prisma.sql`
    /* owner-analytics:population */
    SELECT COUNT(*)::bigint AS eligible_students
    FROM "User"
    WHERE "role" = 'user'
      AND "accountStatus" = 'ACTIVE'
      AND "isPrimaryOwner" = FALSE
  `);
  return rows[0] ?? { eligible_students: 0n };
}

export async function aggregateContentScopes(
  database: OwnerAnalyticsDatabase,
  filters: OwnerAnalyticsSourceFilter,
): Promise<ContentScopeRow[]> {
  return queryRows<ContentScopeRow>(database, scopedRowQuery(
    "content",
    Prisma.sql`COUNT(DISTINCT s.lecture_id)::bigint AS lecture_count`,
    Prisma.sql`
      SELECT
        l."id" AS lecture_id,
        NULLIF(l."mainSubject", '') AS subject_id
      FROM "Lecture" l
    `,
    filters,
  ));
}

export async function aggregateFocus(
  database: OwnerAnalyticsDatabase,
  input: OwnerAcademicAggregateInput,
  filters: OwnerAnalyticsSourceFilter,
): Promise<FocusAggregateRow[]> {
  return queryRows<FocusAggregateRow>(database, scopedRowQuery(
    "focus",
    Prisma.sql`
      COUNT(*)::bigint AS meaningful_sessions,
      COALESCE(SUM(s.active_seconds), 0)::bigint AS verified_study_seconds,
      COUNT(DISTINCT s.user_id)::bigint AS unique_users
    `,
    Prisma.sql`
      WITH ${ELIGIBLE_STUDENTS_CTE}
      SELECT
        fs."userId" AS user_id,
        fs."lectureId" AS lecture_id,
        NULLIF(l."mainSubject", '') AS subject_id,
        fs."activeSeconds" AS active_seconds
      FROM "FocusSession" fs
      JOIN eligible_students u ON u."id" = fs."userId"
      JOIN "Lecture" l ON l."id" = fs."lectureId"
      WHERE fs."status" = 'COMPLETED'
        AND fs."activeSeconds" >= ${MASTERY_MEANINGFUL_FOCUS_SECONDS}
        AND fs."actualEndedAt" >= ${input.window.from}
        AND fs."actualEndedAt" < ${input.window.to}
    `,
    filters,
  ));
}

export async function aggregateGroupFocus(
  database: OwnerAnalyticsDatabase,
  input: OwnerAcademicAggregateInput,
  filters: OwnerAnalyticsSourceFilter,
): Promise<GroupFocusAggregateRow[]> {
  return queryRows<GroupFocusAggregateRow>(database, scopedRowQuery(
    "group-focus",
    Prisma.sql`
      COUNT(DISTINCT s.run_id) FILTER (WHERE s.terminal_reason = 'COMPLETED')::bigint AS completed_runs,
      COUNT(*)::bigint AS verified_participant_sessions,
      COALESCE(SUM(s.verified_focus_seconds), 0)::bigint AS verified_focus_seconds,
      COUNT(DISTINCT s.user_id)::bigint AS unique_participants
    `,
    Prisma.sql`
      WITH ${ELIGIBLE_STUDENTS_CTE}
      SELECT
        p."userId" AS user_id,
        p."effectiveLectureId" AS lecture_id,
        NULLIF(l."mainSubject", '') AS subject_id,
        p."verifiedFocusSeconds" AS verified_focus_seconds,
        r."id" AS run_id,
        r."terminalReason" AS terminal_reason
      FROM "GroupFocusParticipantSummary" p
      JOIN eligible_students u ON u."id" = p."userId"
      JOIN "GroupFocusRun" r ON r."id" = p."runId"
      JOIN "Lecture" l ON l."id" = p."effectiveLectureId"
      WHERE p."verifiedFocusSeconds" > 0
        AND r."runtimeEndedAt" >= ${input.window.from}
        AND r."runtimeEndedAt" < ${input.window.to}
    `,
    filters,
  ));
}

export async function aggregateMcq(
  database: OwnerAnalyticsDatabase,
  input: OwnerAcademicAggregateInput,
  filters: OwnerAnalyticsSourceFilter,
): Promise<McqAggregateRow[]> {
  return queryRows<McqAggregateRow>(database, scopedRowQuery(
    "mcq",
    Prisma.sql`
      COUNT(*)::bigint AS objective_attempts,
      COUNT(*) FILTER (WHERE s.correct_value = 'true')::bigint AS objective_correct,
      COUNT(*) FILTER (WHERE s.correct_value = 'false')::bigint AS objective_incorrect,
      COUNT(DISTINCT s.user_id)::bigint AS unique_users,
      COUNT(DISTINCT s.mcq_id)::bigint AS distinct_items_attempted
    `,
    Prisma.sql`
      WITH ${ELIGIBLE_STUDENTS_CTE}
      SELECT
        e."userId" AS user_id,
        m."lectureId" AS lecture_id,
        NULLIF(l."mainSubject", '') AS subject_id,
        e."mcqId" AS mcq_id,
        e."payload"->>'correct' AS correct_value
      FROM "StudyEvent" e
      JOIN eligible_students u ON u."id" = e."userId"
      JOIN "Mcq" m ON m."id" = e."mcqId"
      JOIN "Lecture" l ON l."id" = m."lectureId"
      WHERE e."eventType" = 'mcq_attempted'
        AND e."source" IN ('backend', 'offline_replay')
        AND e."evidenceClass" = 'SERVER_VALIDATED'
        AND e."privacyClass" = 'PRIVATE_STUDY'
        AND e."payload"->>'correct' IN ('true', 'false')
        AND e."receivedAt" >= ${input.window.from}
        AND e."receivedAt" < ${input.window.to}
    `,
    filters,
  ));
}

export async function aggregateFlashcards(
  database: OwnerAnalyticsDatabase,
  input: OwnerAcademicAggregateInput,
  filters: OwnerAnalyticsSourceFilter,
): Promise<FlashcardAggregateRow[]> {
  return queryRows<FlashcardAggregateRow>(database, scopedRowQuery(
    "flashcards",
    Prisma.sql`
      COUNT(*)::bigint AS meaningful_reviews,
      COUNT(*) FILTER (WHERE s.quality = 'AGAIN')::bigint AS self_reported_not_remembered,
      COUNT(*) FILTER (WHERE s.quality IN ('HARD', 'GOOD', 'EASY'))::bigint AS self_reported_remembered,
      COUNT(*) FILTER (WHERE s.quality IN ('AGAIN', 'HARD', 'GOOD', 'EASY'))::bigint AS self_reported_outcomes,
      COUNT(DISTINCT s.user_id)::bigint AS unique_users,
      COUNT(DISTINCT s.flashcard_id)::bigint AS distinct_cards_reviewed
    `,
    Prisma.sql`
      WITH ${ELIGIBLE_STUDENTS_CTE}
      SELECT
        e."userId" AS user_id,
        f."lectureId" AS lecture_id,
        NULLIF(l."mainSubject", '') AS subject_id,
        e."flashcardId" AS flashcard_id,
        e."payload"->>'quality' AS quality
      FROM "StudyEvent" e
      JOIN eligible_students u ON u."id" = e."userId"
      JOIN "Flashcard" f ON f."id" = e."flashcardId"
      JOIN "Lecture" l ON l."id" = f."lectureId"
      WHERE e."eventType" = 'flashcard_reviewed'
        AND e."source" IN ('backend', 'offline_replay')
        AND e."evidenceClass" = 'SERVER_VALIDATED'
        AND e."privacyClass" = 'PRIVATE_STUDY'
        AND e."receivedAt" >= ${input.window.from}
        AND e."receivedAt" < ${input.window.to}
    `,
    filters,
  ));
}

export async function aggregateRecall(
  database: OwnerAnalyticsDatabase,
  input: OwnerAcademicAggregateInput,
  filters: OwnerAnalyticsSourceFilter,
): Promise<RecallAggregateRow[]> {
  return queryRows<RecallAggregateRow>(database, scopedRowQuery(
    "recall",
    Prisma.sql`
      COUNT(*) FILTER (
        WHERE s.presented_at >= ${input.window.from} AND s.presented_at < ${input.window.to}
      )::bigint AS periodic_presented,
      COUNT(*) FILTER (
        WHERE s.status = 'ANSWERED'
          AND s.answered_at >= ${input.window.from} AND s.answered_at < ${input.window.to}
      )::bigint AS periodic_answered,
      COUNT(*) FILTER (
        WHERE s.status = 'SKIPPED'
          AND s.skipped_at >= ${input.window.from} AND s.skipped_at < ${input.window.to}
      )::bigint AS periodic_skipped,
      COUNT(*) FILTER (
        WHERE s.status = 'EXPIRED'
          AND s.expired_at >= ${input.window.from} AND s.expired_at < ${input.window.to}
      )::bigint AS periodic_expired,
      COUNT(*) FILTER (
        WHERE s.status = 'ANSWERED'
          AND s.item_type = 'MCQ'
          AND s.answered_at >= ${input.window.from} AND s.answered_at < ${input.window.to}
          AND s.evidence_class = 'SERVER_DERIVED'
          AND s.outcome IN ('CORRECT', 'INCORRECT')
      )::bigint AS objective_mcq_answered,
      COUNT(*) FILTER (
        WHERE s.status = 'ANSWERED'
          AND s.item_type = 'MCQ'
          AND s.answered_at >= ${input.window.from} AND s.answered_at < ${input.window.to}
          AND s.evidence_class = 'SERVER_DERIVED'
          AND s.outcome = 'CORRECT'
      )::bigint AS objective_mcq_correct,
      COUNT(*) FILTER (
        WHERE s.status = 'ANSWERED'
          AND s.item_type = 'MCQ'
          AND s.answered_at >= ${input.window.from} AND s.answered_at < ${input.window.to}
          AND s.evidence_class = 'SERVER_DERIVED'
          AND s.outcome = 'INCORRECT'
      )::bigint AS objective_mcq_incorrect,
      COUNT(*) FILTER (
        WHERE s.status = 'ANSWERED'
          AND s.item_type = 'FLASHCARD'
          AND s.answered_at >= ${input.window.from} AND s.answered_at < ${input.window.to}
          AND s.evidence_class = 'CLIENT_OBSERVED'
          AND s.outcome = 'SELF_REPORTED_EASY'
      )::bigint AS flashcard_remembered,
      COUNT(*) FILTER (
        WHERE s.status = 'ANSWERED'
          AND s.item_type = 'FLASHCARD'
          AND s.answered_at >= ${input.window.from} AND s.answered_at < ${input.window.to}
          AND s.evidence_class = 'CLIENT_OBSERVED'
          AND s.outcome = 'SELF_REPORTED_HARD'
      )::bigint AS flashcard_not_remembered,
      COUNT(DISTINCT s.user_id) FILTER (
        WHERE s.presented_at >= ${input.window.from} AND s.presented_at < ${input.window.to}
      )::bigint AS unique_users,
      COUNT(DISTINCT s.user_id) FILTER (
        WHERE s.presented_at >= ${input.window.from} AND s.presented_at < ${input.window.to}
      )::bigint AS periodic_presented_users,
      COUNT(DISTINCT s.user_id) FILTER (
        WHERE s.status = 'ANSWERED'
          AND s.answered_at >= ${input.window.from} AND s.answered_at < ${input.window.to}
      )::bigint AS periodic_answered_users,
      COUNT(DISTINCT s.user_id) FILTER (
        WHERE s.status = 'SKIPPED'
          AND s.skipped_at >= ${input.window.from} AND s.skipped_at < ${input.window.to}
      )::bigint AS periodic_skipped_users,
      COUNT(DISTINCT s.user_id) FILTER (
        WHERE s.status = 'EXPIRED'
          AND s.expired_at >= ${input.window.from} AND s.expired_at < ${input.window.to}
      )::bigint AS periodic_expired_users,
      COUNT(DISTINCT s.user_id) FILTER (
        WHERE s.status = 'ANSWERED'
          AND s.item_type = 'MCQ'
          AND s.answered_at >= ${input.window.from} AND s.answered_at < ${input.window.to}
          AND s.evidence_class = 'SERVER_DERIVED'
          AND s.outcome IN ('CORRECT', 'INCORRECT')
      )::bigint AS objective_mcq_unique_users,
      COUNT(DISTINCT s.user_id) FILTER (
        WHERE s.status = 'ANSWERED'
          AND s.item_type = 'FLASHCARD'
          AND s.answered_at >= ${input.window.from} AND s.answered_at < ${input.window.to}
          AND s.evidence_class = 'CLIENT_OBSERVED'
          AND s.outcome = 'SELF_REPORTED_EASY'
      )::bigint AS flashcard_remembered_users,
      COUNT(DISTINCT s.user_id) FILTER (
        WHERE s.status = 'ANSWERED'
          AND s.item_type = 'FLASHCARD'
          AND s.answered_at >= ${input.window.from} AND s.answered_at < ${input.window.to}
          AND s.evidence_class = 'CLIENT_OBSERVED'
          AND s.outcome = 'SELF_REPORTED_HARD'
      )::bigint AS flashcard_not_remembered_users
    `,
    Prisma.sql`
      WITH ${ELIGIBLE_STUDENTS_CTE}
      SELECT
        a."userId" AS user_id,
        a."lectureId" AS lecture_id,
        NULLIF(l."mainSubject", '') AS subject_id,
        a."status" AS status,
        a."itemType" AS item_type,
        a."evidenceClass" AS evidence_class,
        a."outcome" AS outcome,
        a."presentedAt" AS presented_at,
        a."answeredAt" AS answered_at,
        a."skippedAt" AS skipped_at,
        a."expiredAt" AS expired_at
      FROM "RecallAttempt" a
      JOIN eligible_students u ON u."id" = a."userId"
      JOIN "Lecture" l ON l."id" = a."lectureId"
      WHERE a."issuanceSource" = 'PERIODIC'
        AND a."privacyClass" = 'PRIVATE_STUDY'
        AND (
          (a."presentedAt" >= ${input.window.from} AND a."presentedAt" < ${input.window.to})
          OR (a."answeredAt" >= ${input.window.from} AND a."answeredAt" < ${input.window.to})
          OR (a."skippedAt" >= ${input.window.from} AND a."skippedAt" < ${input.window.to})
          OR (a."expiredAt" >= ${input.window.from} AND a."expiredAt" < ${input.window.to})
        )
    `,
    filters,
  ));
}

export async function aggregateResources(
  database: OwnerAnalyticsDatabase,
  input: OwnerAcademicAggregateInput,
  filters: OwnerAnalyticsSourceFilter,
): Promise<ResourceAggregateRow[]> {
  return queryRows<ResourceAggregateRow>(database, scopedRowQuery(
    "resources",
    Prisma.sql`
      COUNT(*)::bigint AS resource_handoffs,
      COUNT(DISTINCT s.user_id)::bigint AS unique_users,
      COUNT(*) FILTER (WHERE s.resource_type = 'PDF')::bigint AS pdf_handoffs,
      COUNT(*) FILTER (WHERE s.resource_type = 'VIDEO')::bigint AS video_handoffs,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.resource_type = 'PDF')::bigint AS pdf_unique_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.resource_type = 'VIDEO')::bigint AS video_unique_users
    `,
    Prisma.sql`
      WITH ${ELIGIBLE_STUDENTS_CTE}
      SELECT
        e."userId" AS user_id,
        e."lectureId" AS lecture_id,
        NULLIF(l."mainSubject", '') AS subject_id,
        UPPER(e."payload"->>'resourceType') AS resource_type
      FROM "StudyEvent" e
      JOIN eligible_students u ON u."id" = e."userId"
      JOIN "FocusSession" f
        ON f."id" = e."focusSessionId"
        AND f."userId" = e."userId"
        AND f."lectureId" = e."lectureId"
      JOIN "Lecture" l ON l."id" = e."lectureId"
      WHERE e."eventType" = 'focus_resource_handoff_started'
        AND e."evidenceClass" = 'CLIENT_OBSERVED'
        AND e."privacyClass" = 'PRIVATE_STUDY'
        AND e."payload"->>'status' = 'STARTED'
        AND e."payload"->>'resourceId' IS NOT NULL
        AND UPPER(e."payload"->>'resourceType') IN ('PDF', 'VIDEO')
        AND e."receivedAt" >= ${input.window.from}
        AND e."receivedAt" < ${input.window.to}
    `,
    filters,
  ));
}

export async function aggregateActiveStudyUsers(
  database: OwnerAnalyticsDatabase,
  input: OwnerAcademicAggregateInput,
  filters: OwnerAnalyticsSourceFilter,
): Promise<ActiveUsersAggregateRow[]> {
  return queryRows<ActiveUsersAggregateRow>(database, scopedRowQuery(
    "active-users",
    Prisma.sql`COUNT(DISTINCT s.user_id)::bigint AS active_users`,
    Prisma.sql`
      WITH ${ELIGIBLE_STUDENTS_CTE}
      SELECT DISTINCT activity.user_id, activity.lecture_id,
        NULLIF(l."mainSubject", '') AS subject_id
      FROM (
        SELECT fs."userId" AS user_id, fs."lectureId" AS lecture_id
        FROM "FocusSession" fs
        JOIN eligible_students u ON u."id" = fs."userId"
        WHERE fs."status" = 'COMPLETED'
          AND fs."activeSeconds" >= ${MASTERY_MEANINGFUL_FOCUS_SECONDS}
          AND fs."actualEndedAt" >= ${input.window.from}
          AND fs."actualEndedAt" < ${input.window.to}

        UNION

        SELECT p."userId" AS user_id, p."effectiveLectureId" AS lecture_id
        FROM "GroupFocusParticipantSummary" p
        JOIN eligible_students u ON u."id" = p."userId"
        JOIN "GroupFocusRun" r ON r."id" = p."runId"
        WHERE p."verifiedFocusSeconds" > 0
          AND r."runtimeEndedAt" >= ${input.window.from}
          AND r."runtimeEndedAt" < ${input.window.to}

        UNION

        SELECT e."userId" AS user_id, m."lectureId" AS lecture_id
        FROM "StudyEvent" e
        JOIN eligible_students u ON u."id" = e."userId"
        JOIN "Mcq" m ON m."id" = e."mcqId"
        WHERE e."eventType" = 'mcq_attempted'
          AND e."source" IN ('backend', 'offline_replay')
          AND e."evidenceClass" = 'SERVER_VALIDATED'
          AND e."privacyClass" = 'PRIVATE_STUDY'
          AND e."payload"->>'correct' IN ('true', 'false')
          AND e."receivedAt" >= ${input.window.from}
          AND e."receivedAt" < ${input.window.to}

        UNION

        SELECT e."userId" AS user_id, f."lectureId" AS lecture_id
        FROM "StudyEvent" e
        JOIN eligible_students u ON u."id" = e."userId"
        JOIN "Flashcard" f ON f."id" = e."flashcardId"
        WHERE e."eventType" = 'flashcard_reviewed'
          AND e."source" IN ('backend', 'offline_replay')
          AND e."evidenceClass" = 'SERVER_VALIDATED'
          AND e."privacyClass" = 'PRIVATE_STUDY'
          AND e."receivedAt" >= ${input.window.from}
          AND e."receivedAt" < ${input.window.to}

        UNION

        SELECT a."userId" AS user_id, a."lectureId" AS lecture_id
        FROM "RecallAttempt" a
        JOIN eligible_students u ON u."id" = a."userId"
        WHERE a."issuanceSource" = 'PERIODIC'
          AND a."status" = 'ANSWERED'
          AND a."privacyClass" = 'PRIVATE_STUDY'
          AND a."answeredAt" >= ${input.window.from}
          AND a."answeredAt" < ${input.window.to}
          AND (
            (a."itemType" = 'MCQ' AND a."evidenceClass" = 'SERVER_DERIVED'
              AND a."outcome" IN ('CORRECT', 'INCORRECT'))
            OR
            (a."itemType" = 'FLASHCARD' AND a."evidenceClass" = 'CLIENT_OBSERVED'
              AND a."outcome" IN ('SELF_REPORTED_HARD', 'SELF_REPORTED_EASY'))
          )
      ) AS activity
      JOIN "Lecture" l ON l."id" = activity.lecture_id
    `,
    filters,
  ));
}

export async function aggregateCurrentState(
  database: OwnerAnalyticsDatabase,
  input: OwnerAcademicAggregateInput,
  filters: OwnerAnalyticsSourceFilter,
): Promise<CurrentStateAggregateRow[]> {
  return queryRows<CurrentStateAggregateRow>(database, scopedRowQuery(
    "current-state",
    Prisma.sql`
      COUNT(*)::bigint AS mastery_rows,
      COUNT(DISTINCT s.user_id)::bigint AS tracked_users,
      COUNT(*) FILTER (WHERE s.mastery_state = 'NOT_STARTED')::bigint AS base_not_started,
      COUNT(*) FILTER (WHERE s.mastery_state = 'STARTED')::bigint AS base_started,
      COUNT(*) FILTER (WHERE s.mastery_state = 'LEARNING')::bigint AS base_learning,
      COUNT(*) FILTER (WHERE s.mastery_state = 'NEEDS_REVIEW')::bigint AS base_needs_review,
      COUNT(*) FILTER (WHERE s.mastery_state = 'GOOD')::bigint AS base_good,
      COUNT(*) FILTER (WHERE s.mastery_state = 'MASTERED')::bigint AS base_mastered,
      COUNT(*) FILTER (WHERE s.is_fresh AND s.effective_state = 'NOT_STARTED')::bigint AS fresh_effective_not_started,
      COUNT(*) FILTER (WHERE s.is_fresh AND s.effective_state = 'STARTED')::bigint AS fresh_effective_started,
      COUNT(*) FILTER (WHERE s.is_fresh AND s.effective_state = 'LEARNING')::bigint AS fresh_effective_learning,
      COUNT(*) FILTER (WHERE s.is_fresh AND s.effective_state = 'NEEDS_REVIEW')::bigint AS fresh_effective_needs_review,
      COUNT(*) FILTER (WHERE s.is_fresh AND s.effective_state = 'GOOD')::bigint AS fresh_effective_good,
      COUNT(*) FILTER (WHERE s.is_fresh AND s.effective_state = 'MASTERED')::bigint AS fresh_effective_mastered,
      COUNT(*) FILTER (WHERE s.is_fresh)::bigint AS fresh_retention_rows,
      COUNT(*) FILTER (WHERE s.retention_id IS NOT NULL AND NOT s.is_fresh)::bigint AS stale_retention_rows,
      COUNT(*) FILTER (WHERE s.retention_id IS NULL)::bigint AS missing_retention_rows,
      COUNT(*) FILTER (WHERE s.is_fresh AND s.review_state = 'INSUFFICIENT_EVIDENCE')::bigint AS review_insufficient_evidence,
      COUNT(*) FILTER (WHERE s.is_fresh AND s.review_state = 'FRESH')::bigint AS review_fresh,
      COUNT(*) FILTER (WHERE s.is_fresh AND s.review_state = 'DUE_SOON')::bigint AS review_due_soon,
      COUNT(*) FILTER (WHERE s.is_fresh AND s.review_state = 'DUE')::bigint AS review_due,
      COUNT(*) FILTER (WHERE s.is_fresh AND s.review_state = 'OVERDUE')::bigint AS review_overdue,
      COUNT(*) FILTER (WHERE s.is_fresh AND s.forgetting_kind = 'OBJECTIVE')::bigint AS forgetting_objective,
      COUNT(*) FILTER (WHERE s.is_fresh AND s.forgetting_kind = 'SELF_REPORTED')::bigint AS forgetting_self_reported,
      COUNT(*) FILTER (WHERE s.is_fresh AND s.forgetting_kind = 'MIXED')::bigint AS forgetting_mixed,
      COUNT(*) FILTER (WHERE s.is_fresh AND s.forgetting_kind = 'NONE')::bigint AS forgetting_none,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.mastery_state = 'NOT_STARTED')::bigint AS base_not_started_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.mastery_state = 'STARTED')::bigint AS base_started_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.mastery_state = 'LEARNING')::bigint AS base_learning_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.mastery_state = 'NEEDS_REVIEW')::bigint AS base_needs_review_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.mastery_state = 'GOOD')::bigint AS base_good_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.mastery_state = 'MASTERED')::bigint AS base_mastered_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.is_fresh AND s.effective_state = 'NOT_STARTED')::bigint AS fresh_effective_not_started_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.is_fresh AND s.effective_state = 'STARTED')::bigint AS fresh_effective_started_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.is_fresh AND s.effective_state = 'LEARNING')::bigint AS fresh_effective_learning_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.is_fresh AND s.effective_state = 'NEEDS_REVIEW')::bigint AS fresh_effective_needs_review_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.is_fresh AND s.effective_state = 'GOOD')::bigint AS fresh_effective_good_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.is_fresh AND s.effective_state = 'MASTERED')::bigint AS fresh_effective_mastered_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.is_fresh)::bigint AS fresh_retention_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.retention_id IS NOT NULL AND NOT s.is_fresh)::bigint AS stale_retention_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.retention_id IS NULL)::bigint AS missing_retention_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.is_fresh AND s.review_state = 'INSUFFICIENT_EVIDENCE')::bigint AS review_insufficient_evidence_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.is_fresh AND s.review_state = 'FRESH')::bigint AS review_fresh_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.is_fresh AND s.review_state = 'DUE_SOON')::bigint AS review_due_soon_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.is_fresh AND s.review_state = 'DUE')::bigint AS review_due_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.is_fresh AND s.review_state = 'OVERDUE')::bigint AS review_overdue_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.is_fresh AND s.forgetting_kind = 'OBJECTIVE')::bigint AS forgetting_objective_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.is_fresh AND s.forgetting_kind = 'SELF_REPORTED')::bigint AS forgetting_self_reported_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.is_fresh AND s.forgetting_kind = 'MIXED')::bigint AS forgetting_mixed_users,
      COUNT(DISTINCT s.user_id) FILTER (WHERE s.is_fresh AND s.forgetting_kind = 'NONE')::bigint AS forgetting_none_users
    `,
    Prisma.sql`
      WITH ${ELIGIBLE_STUDENTS_CTE}
      SELECT
        m."userId" AS user_id,
        m."lectureId" AS lecture_id,
        NULLIF(l."mainSubject", '') AS subject_id,
        m."state" AS mastery_state,
        r."id" AS retention_id,
        r."effectiveMasteryState" AS effective_state,
        r."reviewState" AS review_state,
        r."forgettingEvidenceKind" AS forgetting_kind,
        (
          r."id" IS NOT NULL
          AND r."sourceMasteryRevision" = m."revision"
          AND r."sourceMasteryRuleVersion" = m."ruleVersion"
          AND r."ruleVersion" = ${RETENTION_RULE_VERSION}
          AND (r."nextEvaluationAt" IS NULL OR r."nextEvaluationAt" > ${input.asOf})
          AND r."lastEvaluatedAt" <= ${input.asOf}
        ) IS TRUE AS is_fresh
      FROM "LectureMastery" m
      JOIN eligible_students u ON u."id" = m."userId"
      JOIN "Lecture" l ON l."id" = m."lectureId"
      LEFT JOIN "LectureRetention" r
        ON r."userId" = m."userId"
        AND r."lectureId" = m."lectureId"
    `,
    filters,
  ));
}