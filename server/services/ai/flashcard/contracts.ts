import type { SafeProviderMetadata } from "../contracts.js";
import type { AIInputKind } from "../contracts.js";

export interface FlashcardSourceEvidence {
  inputType: AIInputKind;
  page?: number;
  imageIndex?: number;
  section?: string | null;
  label?: string | null;
  supportingExcerpt?: string | null;
}

export type FlashcardProvenance = "extracted" | "generated" | "enhanced";

export interface AIFlashcardCandidate {
  candidateId: string;
  clinicalConcept: string;
  explanation: string | null;
  provenance: FlashcardProvenance;
  source: FlashcardSourceEvidence | null;
  confidence: number;
  importReady: boolean;
  needsReview: boolean;
  requiresHumanApproval: true;
  warnings: string[];
}

export type SkippedFlashcardReason =
  | "missing_front"
  | "unreadable"
  | "unsupported_format"
  | "not_flashcard";

export interface SkippedFlashcardSourceItem {
  reason: SkippedFlashcardReason;
  source: FlashcardSourceEvidence | null;
  summary?: string;
}

export interface FlashcardResultCounts {
  requestedCount?: number;
  returnedCount: number;
  readyCount: number;
  reviewCount: number;
  skippedCount: number;
}

export interface FlashcardOperationResult {
  operation: "extract" | "generate" | "enhance";
  promptVersion: "flashcard-v1";
  status?: "complete" | "empty" | "incomplete";
  items: AIFlashcardCandidate[];
  skippedItems: SkippedFlashcardSourceItem[];
  truncated: boolean;
  warnings: string[];
  requiresHumanApproval: true;
  counts: FlashcardResultCounts;
  provider: SafeProviderMetadata;
  processing: { durationMs: number };
}

export interface FlashcardGenerationOptions {
  count?: number;
  focus?: string | null;
}

export interface FlashcardEnhancementOptions {
  explanation?: true;
}

export interface FlashcardEnhancementInput {
  source: import("../input/contracts.js").PreparedAIInput;
  candidates: AIFlashcardCandidate[];
}