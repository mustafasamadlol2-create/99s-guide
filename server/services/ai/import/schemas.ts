import { z } from "zod";
import type { FlashcardImportCandidate, MCQImportCandidate } from "./contracts.js";

export const IMPORT_BATCH_MAX = 100;
export const IMPORT_TEXT_MAX = 4_000;

const clientKey = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const content = z.string().trim().min(1).max(IMPORT_TEXT_MAX);

const mcqCandidateSchema = z.object({
  clientKey,
  question: content,
  optionA: content,
  optionB: content,
  optionC: content,
  optionD: content,
  correctAnswer: z.enum(["A", "B", "C", "D"]),
  hint: z.string().trim().max(IMPORT_TEXT_MAX).nullable(),
  explanation: z.string().trim().max(IMPORT_TEXT_MAX).nullable(),
  category: z.enum(["AI_GENERATED", "PREVIOUS_YEAR", "RESOURCE"]),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
}).strict();

const flashcardCandidateSchema = z.object({
  clientKey,
  clinicalConcept: content,
  explanation: content,
}).strict();

const baseRequestSchema = z.object({
  lectureId: z.string().trim().min(1).max(256),
  candidates: z.array(z.unknown()).min(1).max(IMPORT_BATCH_MAX),
}).strict();

function withUniqueClientKeys<T extends { clientKey: string }>(candidates: T[]): T[] {
  const keys = new Set<string>();
  for (const candidate of candidates) {
    if (keys.has(candidate.clientKey)) {
      throw new z.ZodError([{
        code: "custom",
        path: ["candidates"],
        message: "clientKey values must be unique within one request.",
      }]);
    }
    keys.add(candidate.clientKey);
  }
  return candidates;
}

export function parseMCQImportRequest(value: unknown): { lectureId: string; candidates: MCQImportCandidate[] } {
  const base = baseRequestSchema.parse(value);
  const candidates = withUniqueClientKeys(base.candidates.map((candidate) => mcqCandidateSchema.parse(candidate)));
  return { lectureId: base.lectureId, candidates };
}

export function parseFlashcardImportRequest(value: unknown): { lectureId: string; candidates: FlashcardImportCandidate[] } {
  const base = baseRequestSchema.parse(value);
  const candidates = withUniqueClientKeys(base.candidates.map((candidate) => flashcardCandidateSchema.parse(candidate)));
  return { lectureId: base.lectureId, candidates };
}