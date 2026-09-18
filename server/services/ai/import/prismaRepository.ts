import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type {
  AIImportRepository,
  ExistingDuplicateRecord,
  FlashcardImportCandidate,
  ImportDecision,
  MCQImportCandidate,
} from "./contracts.js";
import { analyzeDuplicates, duplicateRecord, flashcardCandidateKey, mcqCandidateKey } from "./duplicateDetection.js";

function serializableConflict(error: unknown): boolean {
  return (error as { code?: string })?.code === "P2034";
}

export function createPrismaAIImportRepository(getPrisma: () => any): AIImportRepository {
  const readMCQs = (rows: Array<{ id: string; question: string }>): ExistingDuplicateRecord[] =>
    rows.map((row) => duplicateRecord(row.id, row.question));
  const readFlashcards = (rows: Array<{ id: string; clinicalConcept: string }>): ExistingDuplicateRecord[] =>
    rows.map((row) => duplicateRecord(row.id, row.clinicalConcept));

  return {
    async findLecture(id) {
      return getPrisma().lecture.findUnique({ where: { id }, select: { id: true, name: true } });
    },
    async findExistingMCQs(lectureId) {
      const rows = await getPrisma().mcq.findMany({
        where: { lectureId },
        select: { id: true, question: true },
      });
      return readMCQs(rows);
    },
    async findExistingFlashcards(lectureId) {
      const rows = await getPrisma().flashcard.findMany({
        where: { lectureId },
        select: { id: true, clinicalConcept: true },
      });
      return readFlashcards(rows);
    },
    async importMCQsTransactionally(lectureId, candidates) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await getPrisma().$transaction(async (tx: any) => {
            const existingRows = await tx.mcq.findMany({
              where: { lectureId },
              select: { id: true, question: true },
            });
            const existing = readMCQs(existingRows);
            const keyed = candidates.map((candidate) => ({
              clientKey: candidate.clientKey,
              key: mcqCandidateKey(candidate.question),
              preview: candidate.question.trim(),
            }));
            const decisions = analyzeDuplicates(keyed, existing);
            const newCandidates = candidates.filter((candidate) => decisions.find((item) => item.clientKey === candidate.clientKey)?.status === "new");
            const data = newCandidates.map((candidate) => ({
              id: randomUUID(),
              question: candidate.question.trim(),
              optionA: candidate.optionA.trim(),
              optionB: candidate.optionB.trim(),
              optionC: candidate.optionC.trim(),
              optionD: candidate.optionD.trim(),
              correctAnswer: candidate.correctAnswer,
              hint: candidate.hint?.trim() || null,
              explanation: candidate.explanation?.trim() || null,
              sourceType: candidate.category,
              difficulty: candidate.difficulty,
              lectureId,
            }));
            const clientKeyById = new Map<string, string>(data.map((row, index) => [row.id, newCandidates[index]!.clientKey]));
            const createdRows = data.length
              ? await tx.mcq.createManyAndReturn({ data })
              : [];
            return {
              decisions,
              created: createdRows.map((row: Record<string, unknown>) => ({
                id: String(row.id),
                row: { ...row, clientKey: clientKeyById.get(String(row.id)) },
              })),
            };
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } catch (error) {
          if (!serializableConflict(error) || attempt === 1) throw error;
        }
      }
      throw new Error("Unreachable import retry state.");
    },
    async importFlashcardsTransactionally(lectureId, candidates) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await getPrisma().$transaction(async (tx: any) => {
            const existingRows = await tx.flashcard.findMany({
              where: { lectureId },
              select: { id: true, clinicalConcept: true },
            });
            const existing = readFlashcards(existingRows);
            const keyed = candidates.map((candidate) => ({
              clientKey: candidate.clientKey,
              key: flashcardCandidateKey(candidate.clinicalConcept),
              preview: candidate.clinicalConcept.trim(),
            }));
            const decisions = analyzeDuplicates(keyed, existing);
            const newCandidates = candidates.filter((candidate) => decisions.find((item) => item.clientKey === candidate.clientKey)?.status === "new");
            const data = newCandidates.map((candidate) => ({
              id: randomUUID(),
              clinicalConcept: candidate.clinicalConcept.trim(),
              explanation: candidate.explanation.trim(),
              lectureId,
            }));
            const clientKeyById = new Map<string, string>(data.map((row, index) => [row.id, newCandidates[index]!.clientKey]));
            const createdRows = data.length
              ? await tx.flashcard.createManyAndReturn({ data })
              : [];
            return {
              decisions,
              created: createdRows.map((row: Record<string, unknown>) => ({
                id: String(row.id),
                row: { ...row, clientKey: clientKeyById.get(String(row.id)) },
              })),
            };
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } catch (error) {
          if (!serializableConflict(error) || attempt === 1) throw error;
        }
      }
      throw new Error("Unreachable import retry state.");
    },
  };
}