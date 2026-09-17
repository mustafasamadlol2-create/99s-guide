import type { SafeProviderMetadata } from "../contracts.js";
import type { AIInputKind, MCQAnswer, MCQQuestionStyle } from "../contracts.js";

export const MCQ_DIFFICULTIES = ["Easy", "Medium", "Hard"] as const;
export type MCQDifficulty = (typeof MCQ_DIFFICULTIES)[number];

export interface MCQSourceEvidence {
  inputType: AIInputKind;
  page?: number;
  imageIndex?: number;
  section?: string | null;
  label?: string | null;
  supportingExcerpt?: string | null;
}

export type MCQProvenance = "extracted" | "generated" | "enhanced";

export interface AIMCQCandidate {
  candidateId: string;
  question: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: MCQAnswer | null;
  hint: string | null;
  explanation: string | null;
  difficulty: MCQDifficulty | null;
  provenance: MCQProvenance;
  source: MCQSourceEvidence | null;
  confidence: number;
  importReady: boolean;
  needsReview: boolean;
  requiresHumanApproval: true;
  warnings: string[];
}

export type SkippedMCQReason =
  | "unsupported_option_count"
  | "missing_question"
  | "unreadable"
  | "not_mcq"
  | "unsupported_format";

export interface SkippedMCQSourceItem {
  reason: SkippedMCQReason;
  source: MCQSourceEvidence | null;
  summary?: string;
}

export interface MCQResultCounts {
  requestedCount?: number;
  returnedCount: number;
  readyCount: number;
  reviewCount: number;
  skippedCount: number;
}

export interface MCQOperationResult {
  operation: "extract" | "generate" | "enhance";
  promptVersion: "mcq-v1";
  items: AIMCQCandidate[];
  skippedItems: SkippedMCQSourceItem[];
  truncated: boolean;
  warnings: string[];
  requiresHumanApproval: true;
  counts: MCQResultCounts;
  provider: SafeProviderMetadata;
  processing: { durationMs: number };
}

export interface MCQGenerationOptions {
  count?: number;
  difficulty?: MCQDifficulty | "mixed" | null;
  questionStyle: MCQQuestionStyle;
  includeHints: boolean;
  includeExplanations: boolean;
}

export interface MCQEnhancementOptions {
  hint?: boolean;
  explanation?: boolean;
}

export interface MCQAIEngineInput {
  contents: import("../input/contracts.js").AIContentPart[];
  inputKind: AIInputKind;
  imageCount?: number;
}