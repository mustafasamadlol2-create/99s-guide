export type ImportTarget = "mcq" | "flashcard";
export type ImportDuplicateStatus = "new" | "exact_duplicate" | "possible_duplicate";
export type ImportCommitStatus = "imported" | "exact_duplicate" | "possible_duplicate";

export interface MCQImportCandidate {
  clientKey: string;
  question: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: "A" | "B" | "C" | "D";
  hint?: string | null;
  explanation?: string | null;
  category: "AI_GENERATED" | "PREVIOUS_YEAR" | "RESOURCE";
  difficulty: "Easy" | "Medium" | "Hard";
}

export interface FlashcardImportCandidate {
  clientKey: string;
  clinicalConcept: string;
  explanation: string;
}

export interface ImportRequest<T> {
  lectureId: string;
  candidates: T[];
}

export interface ExistingDuplicateRecord {
  id: string;
  key: string;
  preview: string;
}

export interface ImportDecision {
  clientKey: string;
  status: ImportDuplicateStatus;
  duplicateScope?: "batch" | "existing";
  similarity?: number;
  matchedPreview?: string;
}

export interface ImportCheckResponse {
  requestId: string;
  target: ImportTarget;
  lecture: { id: string; name: string };
  summary: {
    submittedCount: number;
    newCount: number;
    exactDuplicateCount: number;
    possibleDuplicateCount: number;
  };
  items: ImportDecision[];
}

export interface ImportCommitItem {
  clientKey: string;
  status: ImportCommitStatus;
  createdId?: string;
}

export interface ImportCommitResponse {
  requestId: string;
  target: ImportTarget;
  lecture: { id: string; name: string };
  summary: {
    submittedCount: number;
    importedCount: number;
    exactDuplicateSkipped: number;
    possibleDuplicateSkipped: number;
  };
  items: ImportCommitItem[];
  sync: { status: "completed" | "pending"; warning?: string };
}

export interface AIImportRepository {
  findLecture(id: string): Promise<{ id: string; name: string } | null>;
  findExistingMCQs(lectureId: string): Promise<ExistingDuplicateRecord[]>;
  findExistingFlashcards(lectureId: string): Promise<ExistingDuplicateRecord[]>;
  importMCQsTransactionally(
    lectureId: string,
    candidates: MCQImportCandidate[],
  ): Promise<{ created: Array<{ id: string; row: Record<string, unknown> }>; decisions: ImportDecision[] }>;
  importFlashcardsTransactionally(
    lectureId: string,
    candidates: FlashcardImportCandidate[],
  ): Promise<{ created: Array<{ id: string; row: Record<string, unknown> }>; decisions: ImportDecision[] }>;
}

export interface ImportedContentSync {
  target: ImportTarget;
  rows: Array<{ id: string; row: Record<string, unknown> }>;
}