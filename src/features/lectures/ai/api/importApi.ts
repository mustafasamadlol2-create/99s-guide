import { apiClient } from "../../../../core/api/apiClient";
import type {
  AIImportCheckResponse,
  AIImportCommitResponse,
  AIImportFlashcardCandidate,
  AIImportMCQCandidate,
} from "../types/aiPreview";

export type AIImportCandidate = AIImportMCQCandidate | AIImportFlashcardCandidate;

async function requestImport<T>(
  endpoint: string,
  lectureId: string,
  candidates: AIImportCandidate[],
): Promise<T> {
  const response = await apiClient(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lectureId, candidates }),
    bypassCache: true,
    retries: 0,
    timeoutMs: 30_000,
  });
  return await response.json() as T;
}

export function requestAIImportCheck(
  target: "mcq" | "flashcard",
  lectureId: string,
  candidates: AIImportCandidate[],
): Promise<AIImportCheckResponse> {
  const endpoint = target === "mcq"
    ? "/api/admin/ai/mcq/import/check"
    : "/api/admin/ai/flashcards/import/check";
  return requestImport<AIImportCheckResponse>(endpoint, lectureId, candidates);
}

export function requestAIImportCommit(
  target: "mcq" | "flashcard",
  lectureId: string,
  candidates: AIImportCandidate[],
): Promise<AIImportCommitResponse> {
  const endpoint = target === "mcq"
    ? "/api/admin/ai/mcq/import"
    : "/api/admin/ai/flashcards/import";
  return requestImport<AIImportCommitResponse>(endpoint, lectureId, candidates);
}