import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { OwnerAnalyticsSourceFilter, OwnerAnalyticsScope } from "./types.js";

export type OwnerAnalyticsDatabase = Pick<PrismaClient, "$queryRaw">;

export type ScopedAggregateRow = {
  scope: OwnerAnalyticsScope;
  subject_id: string | null;
  lecture_id: string | null;
};

export type OwnerAnalyticsQueryName =
  | "content"
  | "focus"
  | "group-focus"
  | "mcq"
  | "flashcards"
  | "recall"
  | "resources"
  | "active-users"
  | "current-state";

export const ELIGIBLE_STUDENTS_CTE = Prisma.sql`
  eligible_students AS (
    SELECT "id"
    FROM "User"
    WHERE "role" = 'user'
      AND "accountStatus" = 'ACTIVE'
      AND "isPrimaryOwner" = FALSE
  )
`;

export const SCOPE_SELECT = Prisma.sql`
  CASE
    WHEN GROUPING(s.subject_id) = 1 AND GROUPING(s.lecture_id) = 1 THEN 'COHORT'
    WHEN GROUPING(s.lecture_id) = 1 THEN 'SUBJECT'
    ELSE 'LECTURE'
  END AS scope,
  CASE WHEN GROUPING(s.subject_id) = 1 THEN NULL ELSE s.subject_id END AS subject_id,
  CASE WHEN GROUPING(s.lecture_id) = 1 THEN NULL ELSE s.lecture_id END AS lecture_id
`;

export const SCOPE_GROUP_BY = Prisma.sql`
  GROUP BY GROUPING SETS (
    (),
    (s.subject_id),
    (s.lecture_id, s.subject_id)
  )
`;

export function scopeHaving(filters: OwnerAnalyticsSourceFilter): Prisma.Sql {
  const subjectFilter = filters.subjectIds?.length
    ? Prisma.sql`AND s.subject_id IN (${Prisma.join([...filters.subjectIds])})`
    : Prisma.empty;
  const lectureFilter = filters.lectureIds?.length
    ? Prisma.sql`AND s.lecture_id IN (${Prisma.join([...filters.lectureIds])})`
    : Prisma.sql`AND FALSE`;
  return Prisma.sql`
    HAVING
      (GROUPING(s.subject_id) = 1 AND GROUPING(s.lecture_id) = 1)
      OR (
        GROUPING(s.lecture_id) = 1
        AND GROUPING(s.subject_id) = 0
        AND s.subject_id IS NOT NULL
        ${subjectFilter}
      )
      OR (
        GROUPING(s.lecture_id) = 0
        ${lectureFilter}
        ${subjectFilter}
      )
  `;
}

export async function queryRows<Row>(
  database: OwnerAnalyticsDatabase,
  query: Prisma.Sql,
): Promise<Row[]> {
  return database.$queryRaw<Row[]>(query);
}

export function safeAggregateInteger(value: unknown): number {
  let parsed: bigint;
  if (typeof value === "bigint") {
    parsed = value;
  } else if (typeof value === "number" && Number.isSafeInteger(value)) {
    parsed = BigInt(value);
  } else if (typeof value === "string" && /^\d+$/.test(value)) {
    parsed = BigInt(value);
  } else {
    throw new TypeError("PostgreSQL aggregate value was not a non-negative integer.");
  }
  if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("PostgreSQL aggregate value exceeds the safe integer range.");
  }
  return Number(parsed);
}

export function scopedRowQuery(
  queryName: OwnerAnalyticsQueryName,
  select: Prisma.Sql,
  from: Prisma.Sql,
  filters: OwnerAnalyticsSourceFilter,
): Prisma.Sql {
  const diagnosticTag = Prisma.raw(`/* owner-analytics:${queryName} */`);
  return Prisma.sql`
    ${diagnosticTag}
    SELECT ${SCOPE_SELECT}, ${select}
    FROM (${from}) AS s
    ${SCOPE_GROUP_BY}
    ${scopeHaving(filters)}
  `;
}