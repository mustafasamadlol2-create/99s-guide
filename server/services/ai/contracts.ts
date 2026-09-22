import type { ZodType } from "zod";
import type { AIContentPart } from "./input/contracts.js";

export const AI_OPERATIONS = ["extract", "generate", "enhance"] as const;
export const AI_CONTENT_TARGETS = ["mcq", "flashcard"] as const;
export const AI_INPUT_KINDS = ["pdf", "image", "text"] as const;
export const AI_PROVENANCE_VALUES = ["extracted", "generated", "enhanced"] as const;
export const MCQ_ANSWERS = ["A", "B", "C", "D"] as const;
export const MCQ_QUESTION_STYLES = ["direct", "understanding", "clinical", "mixed"] as const;

export type AIOperation = (typeof AI_OPERATIONS)[number];
export type AIContentTarget = (typeof AI_CONTENT_TARGETS)[number];
export type AIInputKind = (typeof AI_INPUT_KINDS)[number];
export type AIProvenance = (typeof AI_PROVENANCE_VALUES)[number];
export type MCQAnswer = (typeof MCQ_ANSWERS)[number];
export type MCQQuestionStyle = (typeof MCQ_QUESTION_STYLES)[number];

export interface StructuredGenerationRequest<T> {
  /**
   * Untrusted uploaded or submitted source material. It is always model content,
   * never a system instruction and never an authority to perform actions.
   */
  contents: AIContentPart[];
  responseSchema: ZodType<T>;
  /** Trusted, application-authored instruction. Never populate from source material. */
  trustedSystemInstruction?: string;
  /**
   * Optional untrusted context supplied as model content alongside the source.
   * This is intentionally separate from trustedSystemInstruction.
   */
  additionalUntrustedContext?: string;
  /**
   * Optional operation metadata used by providers for bounded media chunking.
   * It does not change the application response contract.
   */
  operation?: AIOperation;
  requestedCount?: number;
  maxItems?: number;
  /** Provider hint for safe parallel reading of independent source chunks. */
  sourceChunkConcurrency?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Internal job-scoped optimization. Never enables cross-user/global caching. */
  reusePreparedMedia?: boolean;
}

export interface SafeProviderMetadata {
  provider: string;
  model: string;
  responseId?: string;
  transport?: "inline" | "files_api" | "markdown_conversion";
  mediaCount?: number;
  cleanupWarning?: "provider_media_cleanup_failed";
}

export interface StructuredGenerationResult<T> {
  data: T;
  meta: SafeProviderMetadata;
}

export interface AIProvider {
  generateStructured<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResult<T>>;
  dispose?(): Promise<void>;
}
