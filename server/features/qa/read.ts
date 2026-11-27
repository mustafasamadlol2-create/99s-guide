import type { PrismaClient } from "@prisma/client";
import { recordEgress } from "../../observability/metrics.js";

type QaAnswer = {
  id: string;
  questionId: string;
  userId: string;
  userName: string;
  userAvatar: string;
  content: string;
  createdAt: string;
  upvotes: number;
  isBest: boolean;
  isBlocked: boolean;
};

export type QaQuestion = {
  id: string;
  lectureId: string;
  user_id: string;
  userName: string;
  userAvatar: string;
  content: string;
  createdAt: string;
  upvotes: number;
  isBlocked: boolean;
  answers: QaAnswer[];
};

export async function readCanonicalQaFeed(
  database: Pick<PrismaClient, "$queryRaw">,
  lectureId: string,
  viewerId: string,
): Promise<QaQuestion[]> {
  type Display = Pick<QaAnswer, "userName" | "userAvatar">;
  type Question = Omit<QaQuestion, keyof Display | "answers"> & {
    answers: Omit<QaAnswer, keyof Display>[];
  };
  type FeedRow = { question: Question | null; author: (Display & { id: string }) | null };
  // Retrieve each author's display fields once. A legacy avatar can be large,
  // so embedding it in every reply would multiply PostgreSQL transfer.
  const rows = await database.$queryRaw<FeedRow[]>`
    WITH questions AS MATERIALIZED (
      SELECT "id", "lectureId", "userId", "content", "upvotes", "createdAt"
      FROM "QaQuestion"
      WHERE "lectureId" = ${lectureId} AND NOT "isDeleted"
    ), answers AS MATERIALIZED (
      SELECT a.*
      FROM questions q
      CROSS JOIN LATERAL (
        SELECT "id", "questionId", "userId", "content", "upvotes", "isBest", "createdAt"
        FROM "QaAnswer"
        WHERE "questionId" = q."id" AND NOT "isDeleted"
        ORDER BY "createdAt", "id"
        LIMIT 200
      ) a
    ), answer_groups AS (
      SELECT a."questionId", jsonb_agg(jsonb_build_object(
        'id', a."id", 'questionId', a."questionId", 'userId', a."userId",
        'content', a."content", 'upvotes', a."upvotes", 'isBest', a."isBest",
        'createdAt', to_char(a."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'isBlocked', EXISTS (
          SELECT 1 FROM "UserBlock" b
          WHERE b."blockerId" = ${viewerId} AND b."blockedId" = a."userId"
        )
      ) ORDER BY a."createdAt", a."id") AS "answers"
      FROM answers a
      GROUP BY a."questionId"
    ), authors AS (
      SELECT "userId" FROM questions UNION SELECT "userId" FROM answers
    )
    SELECT "question", "author" FROM (
    SELECT jsonb_build_object(
      'id', q."id", 'lectureId', q."lectureId", 'user_id', q."userId",
      'content', q."content", 'upvotes', q."upvotes",
      'createdAt', to_char(q."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'isBlocked', EXISTS (
        SELECT 1 FROM "UserBlock" b
        WHERE b."blockerId" = ${viewerId} AND b."blockedId" = q."userId"
      ),
      'answers', COALESCE(reply_group."answers", '[]'::jsonb)
    ) AS "question", NULL::jsonb AS "author", q."createdAt" AS "sortDate", q."id" AS "sortId"
    FROM questions q
    LEFT JOIN answer_groups reply_group ON reply_group."questionId" = q."id"
    UNION ALL
    SELECT NULL::jsonb, jsonb_build_object(
      'id', u."id",
      'userName', COALESCE(NULLIF(u."name", ''), 'Unknown'),
      'userAvatar', COALESCE(NULLIF(u."avatarUrl", ''), u."avatar", '')
    ), NULL::timestamp, NULL::text
    FROM authors
    JOIN "User" u ON u."id" = authors."userId"
    ) AS feed
    ORDER BY "sortDate" DESC NULLS LAST, "sortId" DESC
  `;
  recordEgress("qa_postgres_result", { rows: rows.length });
  const displayById = new Map<string, Display>();
  for (const { author } of rows) {
    if (!author) continue;
    const { id, ...display } = author;
    displayById.set(id, display);
  }
  const unknown = { userName: "Unknown", userAvatar: "" };
  return rows.flatMap(({ question }) => question ? [{
    ...question,
    ...(displayById.get(question.user_id) ?? unknown),
    answers: question.answers.map((answer) => ({
      ...answer,
      ...(displayById.get(answer.userId) ?? unknown),
    })),
  }] : []);
}
