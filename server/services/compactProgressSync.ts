import { Prisma, type PrismaClient } from "@prisma/client";

type ProgressRow = {
  userId: string;
  lectureId: string;
  pdfCompleted: boolean;
  notesCompleted: boolean;
  videoCompleted: boolean;
  flashcardsCompleted: boolean;
  quizCompleted: boolean;
  quizScore: number | null;
  lastAccessed: Date;
};
type SubmittedProgress = Omit<ProgressRow, "userId">;

export function normalizeCompactProgress(items: unknown[], now = new Date()): SubmittedProgress[] {
  const byLecture = new Map<string, SubmittedProgress>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const input = item as Partial<Record<keyof SubmittedProgress, unknown>>;
    const lectureId = typeof input.lectureId === "string" ? input.lectureId.trim() : "";
    if (!lectureId) continue;
    const previous = byLecture.get(lectureId);
    const timestamp = typeof input.lastAccessed === "string" ? new Date(input.lastAccessed) : now;
    const accessTime = Number.isFinite(timestamp.getTime()) && timestamp.getTime() <= now.getTime() + 60_000
      ? timestamp : now;
    const score = Number(input.quizScore);
    const hasQuiz = input.quizCompleted === true;
    const scoreWins = hasQuiz && (!previous?.quizCompleted || accessTime >= previous.lastAccessed);
    byLecture.set(lectureId, {
      lectureId,
      pdfCompleted: input.pdfCompleted === true || previous?.pdfCompleted === true,
      notesCompleted: input.notesCompleted === true || previous?.notesCompleted === true,
      videoCompleted: input.videoCompleted === true || previous?.videoCompleted === true,
      flashcardsCompleted: input.flashcardsCompleted === true || previous?.flashcardsCompleted === true,
      quizCompleted: hasQuiz || previous?.quizCompleted === true,
      quizScore: scoreWins ? (score >= 0 && score <= 100 ? Math.trunc(score) : 0) : previous?.quizScore ?? null,
      lastAccessed: previous && previous.lastAccessed > accessTime ? previous.lastAccessed : accessTime,
    });
  }
  return [...byLecture.values()];
}

export async function syncCompactProgress(
  database: Pick<PrismaClient, "$queryRaw">,
  userId: string,
  items: unknown[],
) {
  const input = normalizeCompactProgress(items);
  if (!input.length) return { progress: [], prunedLectureIds: [] };
  const rows = Prisma.join(input.map((item) => Prisma.sql`
    (${item.lectureId}::text, ${item.pdfCompleted}::boolean, ${item.notesCompleted}::boolean,
     ${item.videoCompleted}::boolean, ${item.flashcardsCompleted}::boolean, ${item.quizCompleted}::boolean,
     ${item.quizScore}::integer, (${item.lastAccessed}::timestamptz AT TIME ZONE 'UTC'))
  `));
  // The legacy mirror never manages verified completion timestamps or awards.
  // Merge completion flags atomically so reordered/replayed writes cannot clear them.
  const progress = await database.$queryRaw<ProgressRow[]>`
    INSERT INTO "LectureProgress" AS existing
      ("userId", "lectureId", "pdfCompleted", "notesCompleted", "videoCompleted",
       "flashcardsCompleted", "quizCompleted", "quizScore", "lastAccessed")
    SELECT ${userId}::text, progress.*
    FROM (VALUES ${rows}) AS progress
      ("lectureId", "pdfCompleted", "notesCompleted", "videoCompleted",
       "flashcardsCompleted", "quizCompleted", "quizScore", "lastAccessed")
    JOIN "Lecture" AS lecture ON lecture."id" = progress."lectureId"
    ORDER BY progress."lectureId"
    ON CONFLICT ("userId", "lectureId") DO UPDATE SET
      "pdfCompleted" = existing."pdfCompleted" OR EXCLUDED."pdfCompleted",
      "notesCompleted" = existing."notesCompleted" OR EXCLUDED."notesCompleted",
      "videoCompleted" = existing."videoCompleted" OR EXCLUDED."videoCompleted",
      "flashcardsCompleted" = existing."flashcardsCompleted" OR EXCLUDED."flashcardsCompleted",
      "quizCompleted" = existing."quizCompleted" OR EXCLUDED."quizCompleted",
      "quizScore" = CASE WHEN EXCLUDED."quizCompleted" AND
        (NOT existing."quizCompleted" OR EXCLUDED."lastAccessed" >= existing."lastAccessed")
        THEN EXCLUDED."quizScore" ELSE existing."quizScore" END,
      "lastAccessed" = GREATEST(existing."lastAccessed", EXCLUDED."lastAccessed")
    RETURNING "userId", "lectureId", "pdfCompleted", "notesCompleted", "videoCompleted",
      "flashcardsCompleted", "quizCompleted", "quizScore", "lastAccessed"
  `;
  const written = new Set(progress.map((row) => row.lectureId));
  return {
    progress: progress.map((row) => ({ ...row, quizScore: row.quizScore ?? 0 })),
    prunedLectureIds: input.filter((item) => !written.has(item.lectureId)).map((item) => item.lectureId),
  };
}
