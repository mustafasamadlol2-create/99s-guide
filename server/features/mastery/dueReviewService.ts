import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { LectureMasteryError } from "./errors.js";
import {
  RETENTION_DEFAULT_REVIEW_LIMIT,
  RETENTION_MAX_REFRESH_LECTURES,
  RETENTION_MAX_REVIEW_LIMIT,
  RETENTION_RULE_VERSION,
} from "./retentionConstants.js";
import { refreshUserLectureRetention } from "./retentionRefresh.js";
import type { LectureRetentionProjection } from "./retentionTypes.js";

type CandidateRow = { lectureId: string };
type DueReviewCursor = {
  version: 1;
  afterLectureId: string | null;
  pendingLectureIds: string[];
};

export type DueLectureReview = {
  lectureId: string;
  effectiveMasteryState: LectureRetentionProjection["effectiveMasteryState"];
  reviewState: LectureRetentionProjection["reviewState"];
  reviewUrgencyScore: number;
  nextReviewAt: Date | null;
  hasActiveObjectiveForgetting: boolean;
};

export type DueLectureReviewPage = {
  items: DueLectureReview[];
  nextCursor: string | null;
};

export async function listDueLectureReviews(input: {
  userId: string;
  asOf?: Date;
  limit?: number;
  cursor?: string | null;
  database?: PrismaClient;
}): Promise<DueLectureReviewPage> {
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    throw new LectureMasteryError(
      "INVALID_INPUT",
      "Review-list user ID must be nonempty.",
    );
  }
  const limit = input.limit ?? RETENTION_DEFAULT_REVIEW_LIMIT;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > RETENTION_MAX_REVIEW_LIMIT
  ) {
    throw new LectureMasteryError(
      "INVALID_INPUT",
      `Review-list limit must be between 1 and ${RETENTION_MAX_REVIEW_LIMIT}.`,
    );
  }
  const asOf = input.asOf ? new Date(input.asOf.getTime()) : new Date();
  if (!Number.isFinite(asOf.getTime())) {
    throw new LectureMasteryError(
      "INVALID_INPUT",
      "Review-list asOf timestamp is invalid.",
    );
  }

  const database = input.database ?? getPrisma();
  const decoded = decodeCursor(input.cursor ?? null);
  const candidateLimit = Math.min(
    RETENTION_MAX_REFRESH_LECTURES,
    Math.max(limit, limit * 4),
  );
  const pendingNow = decoded.pendingLectureIds.slice(0, candidateLimit);
  const pendingRemainder = decoded.pendingLectureIds.slice(candidateLimit);
  const scanLimit = candidateLimit - pendingNow.length;
  const scan = scanLimit > 0
    ? await findCandidateLectureIds(
        database,
        input.userId,
        asOf,
        decoded.afterLectureId,
        scanLimit,
      )
    : { lectureIds: [], hasMore: false };
  const candidateIds = [...new Set([...pendingNow, ...scan.lectureIds])];
  const afterLectureId = scan.lectureIds.at(-1) ?? decoded.afterLectureId;

  if (candidateIds.length === 0) {
    return { items: [], nextCursor: null };
  }

  await refreshUserLectureRetention({
    userId: input.userId,
    lectureIds: candidateIds,
    asOf,
  });
  const projections = await database.lectureRetention.findMany({
    where: {
      userId: input.userId,
      lectureId: { in: candidateIds },
    },
  });
  const due = projections
    .filter(
      (row) =>
        row.reviewState === "DUE" ||
        row.reviewState === "OVERDUE" ||
        row.effectiveMasteryState === "NEEDS_REVIEW",
    )
    .map(
      (row): DueLectureReview => ({
        lectureId: row.lectureId,
        effectiveMasteryState: row.effectiveMasteryState,
        reviewState: row.reviewState,
        reviewUrgencyScore: row.reviewUrgencyScore,
        nextReviewAt: row.nextReviewAt,
        hasActiveObjectiveForgetting:
          row.objectiveForgettingItemCount > 0,
      }),
    )
    .sort(compareDueReviews);

  const pageItems = due.slice(0, limit);
  const unreturnedDueIds = due.slice(limit).map((item) => item.lectureId);
  const pendingNext = [...new Set([
    ...unreturnedDueIds,
    ...pendingRemainder,
  ])];
  const hasMore = pendingNext.length > 0 || scan.hasMore;

  return {
    items: pageItems,
    nextCursor: hasMore
      ? encodeCursor({
          version: 1,
          afterLectureId,
          pendingLectureIds: pendingNext,
        })
      : null,
  };
}

function compareDueReviews(
  left: DueLectureReview,
  right: DueLectureReview,
): number {
  return (
    right.reviewUrgencyScore - left.reviewUrgencyScore ||
    Number(right.hasActiveObjectiveForgetting) -
      Number(left.hasActiveObjectiveForgetting) ||
    compareNullableDates(left.nextReviewAt, right.nextReviewAt) ||
    left.lectureId.localeCompare(right.lectureId)
  );
}

function compareNullableDates(left: Date | null, right: Date | null): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return left.getTime() - right.getTime();
}

async function findCandidateLectureIds(
  database: PrismaClient,
  userId: string,
  asOf: Date,
  afterLectureId: string | null,
  limit: number,
): Promise<{ lectureIds: string[]; hasMore: boolean }> {
  const cursorPredicate = afterLectureId === null
    ? Prisma.empty
    : Prisma.sql`AND mastery."lectureId" > ${afterLectureId}`;
  const rows = await database.$queryRaw<CandidateRow[]>(Prisma.sql`
    SELECT mastery."lectureId"
    FROM "LectureMastery" AS mastery
    LEFT JOIN "LectureRetention" AS retention
      ON retention."userId" = mastery."userId"
     AND retention."lectureId" = mastery."lectureId"
    WHERE mastery."userId" = ${userId}
      ${cursorPredicate}
      AND (
        retention."id" IS NULL
        OR retention."sourceMasteryRevision" <> mastery."revision"
        OR retention."sourceMasteryRuleVersion" <> mastery."ruleVersion"
        OR retention."ruleVersion" <> ${RETENTION_RULE_VERSION}
        OR (
          retention."nextEvaluationAt" IS NOT NULL
          AND retention."nextEvaluationAt" <= ${asOf}
        )
        OR retention."reviewState" IN ('DUE', 'OVERDUE')
        OR retention."effectiveMasteryState" = 'NEEDS_REVIEW'
      )
    ORDER BY mastery."lectureId" ASC
    LIMIT ${limit + 1}
  `);
  const hasMore = rows.length > limit;
  return {
    lectureIds: rows.slice(0, limit).map((row) => row.lectureId),
    hasMore,
  };
}

function encodeCursor(cursor: DueReviewCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null): DueReviewCursor {
  if (cursor === null) {
    return { version: 1, afterLectureId: null, pendingLectureIds: [] };
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<DueReviewCursor>;
    if (
      decoded.version !== 1 ||
      (decoded.afterLectureId !== null &&
        (typeof decoded.afterLectureId !== "string" ||
          decoded.afterLectureId.length === 0)) ||
      !Array.isArray(decoded.pendingLectureIds) ||
      decoded.pendingLectureIds.length > RETENTION_MAX_REFRESH_LECTURES ||
      decoded.pendingLectureIds.some(
        (id) => typeof id !== "string" || id.length === 0,
      )
    ) {
      throw new Error("Invalid cursor shape.");
    }
    return {
      version: 1,
      afterLectureId: decoded.afterLectureId ?? null,
      pendingLectureIds: [...new Set(decoded.pendingLectureIds)],
    };
  } catch {
    throw new LectureMasteryError(
      "INVALID_INPUT",
      "Review-list cursor is invalid.",
    );
  }
}