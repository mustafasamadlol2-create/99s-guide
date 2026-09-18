import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  AIImportRepository,
  FlashcardImportCandidate,
  ImportCheckResponse,
  ImportCommitResponse,
  ImportDecision,
  ImportTarget,
  MCQImportCandidate,
  ImportedContentSync,
} from "./contracts.js";
import { analyzeDuplicates, flashcardCandidateKey, mcqCandidateKey, summarizeDecisions } from "./duplicateDetection.js";
import { previewText } from "./normalize.js";

export class AIImportError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = "AIImportError";
  }
}

type Candidate = MCQImportCandidate | FlashcardImportCandidate;

function isMCQ(target: ImportTarget, candidate: Candidate): candidate is MCQImportCandidate {
  return target === "mcq" && "question" in candidate;
}

function keyedCandidates(target: ImportTarget, candidates: Candidate[]) {
  return candidates.map((candidate) => ({
    clientKey: candidate.clientKey,
    key: isMCQ(target, candidate) ? mcqCandidateKey(candidate.question) : flashcardCandidateKey(candidate.clinicalConcept),
    preview: previewText(isMCQ(target, candidate) ? candidate.question : candidate.clinicalConcept),
  }));
}

function validateMCQOptions(candidates: MCQImportCandidate[]): void {
  for (const [index, candidate] of candidates.entries()) {
    const options = [candidate.optionA, candidate.optionB, candidate.optionC, candidate.optionD]
      .map((option) => option.trim().replace(/\s+/gu, " ").toLocaleLowerCase());
    if (new Set(options).size !== options.length) {
      throw new AIImportError(400, "AI_IMPORT_INVALID_CANDIDATE", "MCQ options must not be duplicates.", {
        field: `candidates.${index}`,
      });
    }
    if (!["AI_GENERATED", "PREVIOUS_YEAR", "RESOURCE"].includes(candidate.category)) {
      throw new AIImportError(400, "AI_IMPORT_INVALID_CANDIDATE", "MCQ category is invalid.", {
        field: `candidates.${index}.category`,
      });
    }
    if (!["Easy", "Medium", "Hard"].includes(candidate.difficulty)) {
      throw new AIImportError(400, "AI_IMPORT_INVALID_CANDIDATE", "MCQ difficulty is invalid.", {
        field: `candidates.${index}.difficulty`,
      });
    }
  }
}

function validateRequest(target: ImportTarget, candidates: Candidate[]): void {
  if (candidates.length < 1 || candidates.length > 100) {
    throw new AIImportError(400, "AI_IMPORT_INVALID_REQUEST", "Import must contain between 1 and 100 candidates.");
  }
  if (target === "mcq") validateMCQOptions(candidates as MCQImportCandidate[]);
}

export class AIImportService {
  constructor(
    private readonly repository: AIImportRepository,
    private readonly onImported?: (content: ImportedContentSync) => Promise<{ warning?: string } | void>,
  ) {}

  private async lectureOrThrow(lectureId: string) {
    const lecture = await this.repository.findLecture(lectureId);
    if (!lecture) throw new AIImportError(404, "LECTURE_NOT_FOUND", "The selected lecture was not found.");
    return lecture;
  }

  async check(
    target: ImportTarget,
    lectureId: string,
    candidates: Candidate[],
    requestId: string = randomUUID(),
  ): Promise<ImportCheckResponse> {
    validateRequest(target, candidates);
    const lecture = await this.lectureOrThrow(lectureId);
    const existing = target === "mcq"
      ? await this.repository.findExistingMCQs(lectureId)
      : await this.repository.findExistingFlashcards(lectureId);
    const items = analyzeDuplicates(keyedCandidates(target, candidates), existing);
    return { requestId, target, lecture, summary: summarizeDecisions(items), items };
  }

  async commit(
    target: ImportTarget,
    lectureId: string,
    candidates: Candidate[],
    requestId: string = randomUUID(),
  ): Promise<ImportCommitResponse> {
    validateRequest(target, candidates);
    const lecture = await this.lectureOrThrow(lectureId);
    const result = target === "mcq"
      ? await this.repository.importMCQsTransactionally(lectureId, candidates as MCQImportCandidate[])
      : await this.repository.importFlashcardsTransactionally(lectureId, candidates as FlashcardImportCandidate[]);
    const imported = result.created;
    const syncResult = imported.length > 0 && this.onImported
      ? await this.onImported({ target, rows: imported })
      : undefined;
    const syncWarning = syncResult && typeof syncResult === "object" ? syncResult.warning : undefined;
    const importedIds = new Map(imported.map((item) => [item.row.clientKey as string, item.id]));
    const items: ImportCommitResponse["items"] = result.decisions.map((decision) => decision.status === "new"
      ? { clientKey: decision.clientKey, status: "imported", ...(importedIds.has(decision.clientKey) ? { createdId: importedIds.get(decision.clientKey) } : {}) }
      : { clientKey: decision.clientKey, status: decision.status });
    return {
      requestId,
      target,
      lecture,
      summary: {
        submittedCount: candidates.length,
        importedCount: imported.length,
        exactDuplicateSkipped: result.decisions.filter((item) => item.status === "exact_duplicate").length,
        possibleDuplicateSkipped: result.decisions.filter((item) => item.status === "possible_duplicate").length,
      },
      items,
      sync: syncWarning ? { status: "pending", warning: syncWarning } : { status: "completed" },
    };
  }
}

export function mapImportError(error: unknown): AIImportError {
  if (error instanceof AIImportError) return error;
  if (error instanceof z.ZodError) {
    return new AIImportError(400, "AI_IMPORT_INVALID_REQUEST", "The import request is invalid.", error.issues.slice(0, 20).map((issue) => ({
      field: issue.path.join(".") || "request",
      message: issue.message,
    })));
  }
  if ((error as { code?: string })?.code === "P2034") {
    return new AIImportError(409, "AI_IMPORT_CONFLICT", "The import conflicted with another content change. Please retry.");
  }
  return new AIImportError(500, "AI_IMPORT_FAILED", "The content could not be imported.");
}