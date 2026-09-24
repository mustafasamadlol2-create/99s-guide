import { getPrisma } from "../../services/prismaClient.js";
import { StudyEventError } from "./errors.js";
import type {
  StudyEventRepository,
  StudyEventTransaction,
} from "./types.js";

const REFERENCE_MODELS: Record<string, keyof Pick<
  StudyEventTransaction,
  "lecture" | "material" | "mcq" | "flashcard"
>> = {
  lectureId: "lecture",
  materialId: "material",
  mcqId: "mcq",
  flashcardId: "flashcard",
};

export class PrismaStudyEventRepository implements StudyEventRepository {
  async transaction<T>(
    callback: (tx: StudyEventTransaction) => Promise<T>,
  ): Promise<T> {
    return getPrisma().$transaction((tx: unknown) =>
      callback(tx as StudyEventTransaction),
    );
  }

  findByIdempotency(userId: string, idempotencyKey: string): Promise<unknown> {
    return getPrisma().studyEvent.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
  }

  async validateReference(
    tx: StudyEventTransaction,
    reference: { field: string; id: string; userId: string; lectureId?: string | null },
  ): Promise<void> {
    if (reference.field === "focusSessionId") {
      const session = await tx.focusSession.findUnique({
        where: { id: reference.id },
        select: { id: true, userId: true, lectureId: true },
      }) as { id: string; userId: string; lectureId: string } | null;
      if (!session) {
        throw new StudyEventError("CANONICAL_REFERENCE_NOT_FOUND", "Focus session does not exist.");
      }
      if (session.userId !== reference.userId) {
        throw new StudyEventError("OWNERSHIP_MISMATCH", "Focus session belongs to another user.");
      }
      if (reference.lectureId && session.lectureId !== reference.lectureId) {
        throw new StudyEventError("OWNERSHIP_MISMATCH", "Focus session does not match the linked Lecture.");
      }
      return;
    }

    const model = REFERENCE_MODELS[reference.field];
    if (!model) return;
    const found = await tx[model].findUnique({
      where: { id: reference.id },
      select: { id: true, ...(["material", "mcq", "flashcard"].includes(model) ? { lectureId: true } : {}) },
    }) as { id: string; lectureId?: string } | null;
    if (!found) {
      throw new StudyEventError(
        "CANONICAL_REFERENCE_NOT_FOUND",
        `Canonical ${reference.field} does not exist.`,
      );
    }
    if (reference.lectureId && found.lectureId && found.lectureId !== reference.lectureId) {
      throw new StudyEventError("OWNERSHIP_MISMATCH", "Canonical resource does not match the linked Lecture.");
    }
  }
}

export const studyEventRepository = new PrismaStudyEventRepository();