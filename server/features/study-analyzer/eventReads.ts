import { Prisma, type PrismaClient } from "@prisma/client";
import { recordEgress } from "../../observability/metrics.js";
import type { StudyAnalyzerEventRow } from "./types.js";

export async function readStudyAnalyzerEvents(
  database: Pick<PrismaClient, "$queryRaw">,
  input: {
    userId: string;
    eventType: "mcq_attempted" | "flashcard_reviewed";
    from: Date;
    through: Date;
    limit: number;
  },
): Promise<StudyAnalyzerEventRow[]> {
  const mcq = input.eventType === "mcq_attempted";
  const payloadKey = mcq ? "correct" : "quality";
  const itemJoin = mcq
    ? Prisma.sql`LEFT JOIN "Mcq" item ON item."id" = e."mcqId"`
    : Prisma.sql`LEFT JOIN "Flashcard" item ON item."id" = e."flashcardId"`;
  type LinkedItem = NonNullable<StudyAnalyzerEventRow["mcq"]>;
  const rows = await database.$queryRaw<Array<StudyAnalyzerEventRow & { item: LinkedItem | null }>>`
    SELECT e."id", e."eventType", e."source", e."evidenceClass", e."privacyClass",
           e."receivedAt", e."lectureId", e."mcqId", e."flashcardId", e."payload",
           CASE WHEN item."id" IS NOT NULL THEN jsonb_build_object(
             'lectureId', item."lectureId",
             'lecture', CASE WHEN l."id" IS NOT NULL THEN jsonb_build_object('mainSubject', l."mainSubject") END
           ) END AS "item"
    FROM (
      SELECT "id", "eventType", "source", "evidenceClass", "privacyClass",
             "receivedAt", "lectureId", "mcqId", "flashcardId",
             jsonb_build_object(${payloadKey}::text, "payload"->${payloadKey}::text) AS "payload"
      FROM "StudyEvent"
      WHERE "userId" = ${input.userId} AND "eventType" = ${input.eventType}
        AND "receivedAt" BETWEEN (${input.from}::timestamptz AT TIME ZONE 'UTC')
                             AND (${input.through}::timestamptz AT TIME ZONE 'UTC')
      ORDER BY "receivedAt" DESC, "id" DESC
      LIMIT ${input.limit}
    ) e
    ${itemJoin}
    LEFT JOIN "Lecture" l ON l."id" = item."lectureId"
    ORDER BY e."receivedAt" DESC, e."id" DESC
  `;
  recordEgress("analyzer_event_result", { rows: rows.length });
  return rows.map(({ item, ...event }) => mcq ? { ...event, mcq: item } : { ...event, flashcard: item });
}
