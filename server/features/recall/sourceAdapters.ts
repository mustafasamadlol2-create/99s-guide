import type { RecallTransaction } from "./types.js";
import { RecallError } from "./errors.js";
import { RECALL_MCQ_OPTIONS } from "./constants.js";
import type { RecallItemType } from "./constants.js";

export interface CanonicalRecallSource {
  itemType: RecallItemType;
  itemId: string;
  lectureId: string;
  correctAnswer?: string;
}

interface McqRow {
  id: string;
  lectureId: string;
  correctAnswer: string;
}

interface FlashcardRow {
  id: string;
  lectureId: string;
}

/**
 * Locks and reads only the canonical fields required to validate and grade an
 * attempt. Question text and Flashcard content never enter the Recall record.
 */
export async function loadCanonicalRecallSource(
  tx: RecallTransaction,
  itemType: RecallItemType,
  itemId: string,
): Promise<CanonicalRecallSource> {
  if (itemType === "MCQ") {
    const rows = await tx.$queryRaw<McqRow[]>`
      SELECT "id", "lectureId", "correctAnswer"
      FROM "Mcq"
      WHERE "id" = ${itemId}
      FOR SHARE
    `;
    const item = rows[0];
    if (!item) {
      throw new RecallError("RECALL_SOURCE_NOT_FOUND", "Recall source not found.");
    }
    if (
      !RECALL_MCQ_OPTIONS.includes(
        item.correctAnswer as (typeof RECALL_MCQ_OPTIONS)[number],
      )
    ) {
      throw new RecallError(
        "RECALL_SOURCE_INVALID",
        "The MCQ answer key is not a canonical option.",
      );
    }
    await lockCanonicalLecture(tx, item.lectureId);
    return { itemType, itemId: item.id, lectureId: item.lectureId, correctAnswer: item.correctAnswer };
  }

  const rows = await tx.$queryRaw<FlashcardRow[]>`
    SELECT "id", "lectureId"
    FROM "Flashcard"
    WHERE "id" = ${itemId}
    FOR SHARE
  `;
  const item = rows[0];
  if (!item) {
    throw new RecallError("RECALL_SOURCE_NOT_FOUND", "Recall source not found.");
  }
  await lockCanonicalLecture(tx, item.lectureId);
  return { itemType, itemId: item.id, lectureId: item.lectureId };
}

async function lockCanonicalLecture(
  tx: RecallTransaction,
  lectureId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Lecture"
    WHERE "id" = ${lectureId}
    FOR KEY SHARE
  `;
  if (!rows[0]) {
    throw new RecallError("RECALL_SOURCE_NOT_FOUND", "Recall source lecture not found.");
  }
}