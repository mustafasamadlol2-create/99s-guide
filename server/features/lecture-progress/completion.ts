import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { StudyPointsAwardEngine } from "../study-points/awardEngine.js";
import { notifyStudyPointsPostCommit } from "../study-points/postCommitHooks.js";
import type { StudyPointsAwardSourceResult } from "../study-points/awardTypes.js";

export const LECTURE_COMPLETION_RESOURCE_TYPES = ["PDF", "NOTES", "LECTURE"] as const;
export type LectureCompletionResourceType = (typeof LECTURE_COMPLETION_RESOURCE_TYPES)[number];

const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

type LectureDescriptor = {
  id: string;
  materials: Array<{ id: string; type: string }>;
  _count: { mcqs: number; flashcards: number };
};

type CompletionRequirements = {
  pdf: boolean;
  notes: boolean;
  video: boolean;
  quiz: boolean;
  flashcards: boolean;
};

type ProgressRow = {
  userId: string;
  lectureId: string;
  pdfCompleted: boolean;
  notesCompleted: boolean;
  videoCompleted: boolean;
  flashcardsCompleted: boolean;
  quizCompleted: boolean;
  quizScore: number | null;
  pdfCompletedAt: Date | null;
  notesCompletedAt: Date | null;
  videoCompletedAt: Date | null;
  flashcardsCompletedAt: Date | null;
  quizCompletedAt: Date | null;
  lectureCompletedAt: Date | null;
  lastAccessed: Date;
};

export type LectureCompletionStatus = {
  lectureId: string;
  pdfCompleted: boolean;
  notesCompleted: boolean;
  videoCompleted: boolean;
  flashcardsCompleted: boolean;
  quizCompleted: boolean;
  lectureCompleted: boolean;
  pdfCompletedAt: string | null;
  notesCompletedAt: string | null;
  videoCompletedAt: string | null;
  flashcardsCompletedAt: string | null;
  quizCompletedAt: string | null;
  lectureCompletedAt: string | null;
  readyForLectureCompletion: boolean;
  missing: Array<"PDF" | "NOTES" | "VIDEO" | "MCQ" | "FLASHCARDS">;
};

export type LectureCompletionMutationResult = {
  status: LectureCompletionStatus;
  points: {
    awarded: number;
    changed: boolean;
    replayed: boolean;
  };
  legacyAlreadyCompleted: boolean;
};

function cleanMaterialType(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function requirementsForLecture(lecture: LectureDescriptor): CompletionRequirements {
  const types = new Set(lecture.materials.map((material) => cleanMaterialType(material.type)));
  return {
    pdf: types.has("PDF"),
    notes: types.has("NOTE") || types.has("NOTES"),
    video: types.has("VIDEO"),
    quiz: lecture._count.mcqs > 0,
    flashcards: lecture._count.flashcards > 0,
  };
}

function missingForProgress(
  progress: ProgressRow | null,
  requirements: CompletionRequirements,
): LectureCompletionStatus["missing"] {
  const missing: LectureCompletionStatus["missing"] = [];
  // Completion timestamps are deliberately required here. Existing boolean
  // progress from before Points V2 remains visible to the student, but cannot
  // silently become a new competitive reward after the cutover.
  if (requirements.pdf && !progress?.pdfCompletedAt) missing.push("PDF");
  if (requirements.notes && !progress?.notesCompletedAt) missing.push("NOTES");
  if (requirements.video && !progress?.videoCompletedAt) missing.push("VIDEO");
  if (requirements.quiz && !progress?.quizCompletedAt) missing.push("MCQ");
  if (requirements.flashcards && !progress?.flashcardsCompletedAt) missing.push("FLASHCARDS");
  return missing;
}

function toStatus(
  lecture: LectureDescriptor,
  progress: ProgressRow | null,
): LectureCompletionStatus {
  const requirements = requirementsForLecture(lecture);
  const missing = missingForProgress(progress, requirements);
  const hasAnyStudyResource = Object.values(requirements).some(Boolean);
  return {
    lectureId: lecture.id,
    pdfCompleted: !!progress?.pdfCompleted,
    notesCompleted: !!progress?.notesCompleted,
    videoCompleted: !!progress?.videoCompleted,
    flashcardsCompleted: !!progress?.flashcardsCompleted,
    quizCompleted: !!progress?.quizCompleted,
    lectureCompleted: !!progress?.lectureCompletedAt,
    pdfCompletedAt: progress?.pdfCompletedAt?.toISOString() ?? null,
    notesCompletedAt: progress?.notesCompletedAt?.toISOString() ?? null,
    videoCompletedAt: progress?.videoCompletedAt?.toISOString() ?? null,
    flashcardsCompletedAt: progress?.flashcardsCompletedAt?.toISOString() ?? null,
    quizCompletedAt: progress?.quizCompletedAt?.toISOString() ?? null,
    lectureCompletedAt: progress?.lectureCompletedAt?.toISOString() ?? null,
    readyForLectureCompletion: hasAnyStudyResource && missing.length === 0,
    missing,
  };
}

function pointsSummary(result: StudyPointsAwardSourceResult | null) {
  if (!result) return { awarded: 0, changed: false, replayed: false };
  let awarded = 0;
  let changed = false;
  let replayed = false;
  for (const attempt of result.attempts) {
    if (attempt.decision.outcome !== "AWARD") continue;
    replayed = replayed || attempt.replayed;
    if (!attempt.replayed) {
      awarded += attempt.decision.amount;
      changed = true;
    }
  }
  return { awarded, changed, replayed };
}

async function loadLecture(
  tx: Prisma.TransactionClient | PrismaClient,
  lectureId: string,
): Promise<LectureDescriptor | null> {
  return tx.lecture.findUnique({
    where: { id: lectureId },
    select: {
      id: true,
      materials: { select: { id: true, type: true } },
      _count: { select: { mcqs: true, flashcards: true } },
    },
  }) as Promise<LectureDescriptor | null>;
}

async function loadProgress(
  tx: Prisma.TransactionClient | PrismaClient,
  userId: string,
  lectureId: string,
): Promise<ProgressRow | null> {
  return tx.lectureProgress.findUnique({
    where: { userId_lectureId: { userId, lectureId } },
  }) as Promise<ProgressRow | null>;
}

function mirrorLegacyMaterialCompletionBestEffort(input: {
  database: PrismaClient;
  userId: string;
  materialId: string;
}): void {
  // LectureProgress is the canonical Phase-2 source. UserProgress is retained
  // only as a compatibility mirror for older surfaces, so it must not sit on
  // the latency-critical completion path.
  setImmediate(() => {
    void input.database.userProgress.upsert({
      where: {
        userId_materialId: {
          userId: input.userId,
          materialId: input.materialId,
        },
      },
      update: { hasViewed: true, isCompleted: true },
      create: {
        userId: input.userId,
        materialId: input.materialId,
        hasViewed: true,
        isCompleted: true,
      },
    }).catch((error) => {
      const reason = error instanceof Error ? error.message : "unknown error";
      console.warn(`[Lecture Progress] Compatibility material mirror failed: ${reason}`);
    });
  });
}

export class LectureProgressCompletionService {
  constructor(private readonly database: PrismaClient = getPrisma() as PrismaClient) {}

  async getStatus(userId: string, lectureId: string): Promise<LectureCompletionStatus | null> {
    const lecture = await loadLecture(this.database, lectureId);
    if (!lecture) return null;
    const progress = await loadProgress(this.database, userId, lectureId);
    return toStatus(lecture, progress);
  }

  async complete(input: {
    userId: string;
    lectureId: string;
    resourceType: LectureCompletionResourceType;
    materialId?: string | null;
    now?: Date;
  }): Promise<
    | { ok: true; result: LectureCompletionMutationResult }
    | { ok: false; status: 404 | 409; code: "LECTURE_NOT_FOUND" | "RESOURCE_NOT_FOUND" | "LECTURE_NOT_READY"; missing?: LectureCompletionStatus["missing"] }
  > {
    const now = input.now ?? new Date();
    if (!Number.isFinite(now.getTime())) throw new TypeError("Completion time is invalid.");

    let shouldNotifyPoints = false;
    let compatibilityMaterialId: string | null = null;
    const transactionResult = await this.database.$transaction(async (tx) => {
      const lecture = await loadLecture(tx, input.lectureId);
      if (!lecture) {
        return { ok: false as const, status: 404 as const, code: "LECTURE_NOT_FOUND" as const };
      }
      const requirements = requirementsForLecture(lecture);
      const current = await loadProgress(tx, input.userId, input.lectureId);
      const pointsAwarder = new StudyPointsAwardEngine(
        this.database,
        () => now,
        () => true,
        false,
      );

      if (input.resourceType === "PDF" || input.resourceType === "NOTES") {
        const wantedTypes = input.resourceType === "PDF"
          ? new Set(["PDF"])
          : new Set(["NOTE", "NOTES"]);
        const matchingMaterials = lecture.materials.filter((material) =>
          wantedTypes.has(cleanMaterialType(material.type))
        );
        if (matchingMaterials.length === 0) {
          return { ok: false as const, status: 404 as const, code: "RESOURCE_NOT_FOUND" as const };
        }
        if (
          input.materialId
          && !matchingMaterials.some((material) => material.id === input.materialId)
        ) {
          return { ok: false as const, status: 404 as const, code: "RESOURCE_NOT_FOUND" as const };
        }

        const isPdf = input.resourceType === "PDF";
        const alreadyBooleanComplete = isPdf
          ? !!current?.pdfCompleted
          : !!current?.notesCompleted;
        const existingCompletedAt = isPdf
          ? current?.pdfCompletedAt ?? null
          : current?.notesCompletedAt ?? null;

        // Historical completion booleans intentionally remain visible after the
        // Points V2 cutover, but are never converted into a new reward merely by
        // deploying Phase 2.
        if (alreadyBooleanComplete && !existingCompletedAt) {
          return {
            ok: true as const,
            result: {
              status: toStatus(lecture, current),
              points: { awarded: 0, changed: false, replayed: false },
              legacyAlreadyCompleted: true,
            },
          };
        }

        const completedAt = existingCompletedAt ?? now;
        const progress = await tx.lectureProgress.upsert({
          where: { userId_lectureId: { userId: input.userId, lectureId: input.lectureId } },
          update: isPdf
            ? { pdfCompleted: true, pdfCompletedAt: completedAt, lastAccessed: now }
            : { notesCompleted: true, notesCompletedAt: completedAt, lastAccessed: now },
          create: isPdf
            ? {
                userId: input.userId,
                lectureId: input.lectureId,
                pdfCompleted: true,
                pdfCompletedAt: completedAt,
                lastAccessed: now,
              }
            : {
                userId: input.userId,
                lectureId: input.lectureId,
                notesCompleted: true,
                notesCompletedAt: completedAt,
                lastAccessed: now,
              },
        }) as ProgressRow;

        const materialId = input.materialId ?? matchingMaterials[0]?.id ?? null;
        if (materialId) compatibilityMaterialId = materialId;

        const pointResult = await pointsAwarder.awardServerVerifiedLectureProgress({
          userId: input.userId,
          lectureId: input.lectureId,
          completionType: input.resourceType,
          effectiveAt: completedAt,
          now,
          tx,
        });
        const points = pointsSummary(pointResult);
        shouldNotifyPoints = shouldNotifyPoints || points.changed;
        return {
          ok: true as const,
          result: {
            status: toStatus(lecture, progress),
            points,
            legacyAlreadyCompleted: false,
          },
        };
      }

      const missing = missingForProgress(current, requirements);
      const hasAnyStudyResource = Object.values(requirements).some(Boolean);
      if (!hasAnyStudyResource || missing.length > 0) {
        return {
          ok: false as const,
          status: 409 as const,
          code: "LECTURE_NOT_READY" as const,
          missing,
        };
      }

      const completedAt = current?.lectureCompletedAt ?? now;
      const progress = await tx.lectureProgress.update({
        where: { userId_lectureId: { userId: input.userId, lectureId: input.lectureId } },
        data: { lectureCompletedAt: completedAt, lastAccessed: now },
      }) as ProgressRow;
      const pointResult = await pointsAwarder.awardServerVerifiedLectureProgress({
        userId: input.userId,
        lectureId: input.lectureId,
        completionType: "LECTURE",
        effectiveAt: completedAt,
        now,
        tx,
      });
      const points = pointsSummary(pointResult);
      shouldNotifyPoints = shouldNotifyPoints || points.changed;
      return {
        ok: true as const,
        result: {
          status: toStatus(lecture, progress),
          points,
          legacyAlreadyCompleted: false,
        },
      };
    }, TRANSACTION_OPTIONS);

    if (compatibilityMaterialId && transactionResult.ok) {
      mirrorLegacyMaterialCompletionBestEffort({
        database: this.database,
        userId: input.userId,
        materialId: compatibilityMaterialId,
      });
    }
    if (shouldNotifyPoints) {
      await notifyStudyPointsPostCommit(input.userId);
    }
    return transactionResult;
  }
}
