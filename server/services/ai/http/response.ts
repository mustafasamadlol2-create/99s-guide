import { z } from "zod";
import type { SafeProviderMetadata } from "../contracts.js";
import { AIServiceError } from "../errors.js";
import type { AIMCQCandidate, MCQOperationResult, SkippedMCQSourceItem } from "../mcq/contracts.js";
import type { AIFlashcardCandidate, FlashcardOperationResult, SkippedFlashcardSourceItem } from "../flashcard/contracts.js";

const sourceSchema = z.object({
  inputType: z.enum(["pdf", "image", "text"]),
  page: z.number().int().positive().optional(),
  imageIndex: z.number().int().nonnegative().optional(),
  section: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  supportingExcerpt: z.string().nullable().optional(),
}).strict().nullable();
const providerSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  responseId: z.string().nullable().optional(),
  transport: z.enum(["inline", "files_api", "markdown_conversion"]).optional(),
  mediaCount: z.number().int().nonnegative().optional(),
  cleanupWarning: z.literal("provider_media_cleanup_failed").optional(),
}).strict();
const mcqCandidateSchema = z.object({
  candidateId: z.string().uuid(),
  question: z.string(),
  optionA: z.string(),
  optionB: z.string(),
  optionC: z.string(),
  optionD: z.string(),
  correctAnswer: z.enum(["A", "B", "C", "D"]).nullable(),
  hint: z.string().nullable(),
  explanation: z.string().nullable(),
  category: z.enum(["AI_GENERATED", "PREVIOUS_YEAR", "RESOURCE"]),
  difficulty: z.enum(["Easy", "Medium", "Hard"]).nullable(),
  provenance: z.enum(["extracted", "generated", "enhanced"]),
  source: sourceSchema,
  confidence: z.number().finite().min(0).max(1),
  importReady: z.boolean(),
  needsReview: z.boolean(),
  requiresHumanApproval: z.literal(true),
  warnings: z.array(z.string()),
}).strict();
const flashcardCandidateSchema = z.object({
  candidateId: z.string().uuid(),
  clinicalConcept: z.string(),
  explanation: z.string().nullable(),
  provenance: z.enum(["extracted", "generated", "enhanced"]),
  source: sourceSchema,
  confidence: z.number().finite().min(0).max(1),
  importReady: z.boolean(),
  needsReview: z.boolean(),
  requiresHumanApproval: z.literal(true),
  warnings: z.array(z.string()),
}).strict();
const skippedMCQSchema = z.object({
  reason: z.enum(["unsupported_option_count", "missing_question", "unreadable", "not_mcq", "unsupported_format"]),
  source: sourceSchema,
  summary: z.string().optional(),
}).strict();
const skippedFlashcardSchema = z.object({
  reason: z.enum(["missing_front", "unreadable", "unsupported_format", "not_flashcard"]),
  source: sourceSchema,
  summary: z.string().optional(),
}).strict();
const countsSchema = z.object({
  requestedCount: z.number().int().positive().optional(),
  returnedCount: z.number().int().nonnegative(),
  readyCount: z.number().int().nonnegative(),
  reviewCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
}).strict();
const processingSchema = z.object({ durationMs: z.number().finite().nonnegative() }).strict();

export const aiAdminResponseSchema = z.object({
  requestId: z.string().uuid(),
  target: z.enum(["mcq", "flashcard"]),
  operation: z.enum(["extract", "generate", "enhance"]),
  inputKind: z.enum(["pdf", "image", "text"]),
  lecture: z.object({ id: z.string(), name: z.string() }).strict(),
  result: z.object({
    promptVersion: z.string(),
    items: z.array(z.union([mcqCandidateSchema, flashcardCandidateSchema])),
    skippedItems: z.array(z.union([skippedMCQSchema, skippedFlashcardSchema])),
    truncated: z.boolean(),
    warnings: z.array(z.string()),
    requiresHumanApproval: z.literal(true),
    counts: countsSchema,
    provider: providerSchema,
    processing: processingSchema,
  }).strict(),
}).strict();

function safeProvider(provider: SafeProviderMetadata): SafeProviderMetadata {
  return {
    provider: provider.provider,
    model: provider.model,
    ...(provider.responseId ? { responseId: provider.responseId } : {}),
    ...(provider.transport ? { transport: provider.transport } : {}),
    ...(provider.mediaCount === undefined ? {} : { mediaCount: provider.mediaCount }),
    ...(provider.cleanupWarning ? { cleanupWarning: provider.cleanupWarning } : {}),
  };
}

function safeMCQ(item: AIMCQCandidate) {
  return {
    candidateId: item.candidateId,
    question: item.question,
    optionA: item.optionA,
    optionB: item.optionB,
    optionC: item.optionC,
    optionD: item.optionD,
    correctAnswer: item.correctAnswer,
    hint: item.hint,
    explanation: item.explanation,
    category: item.category,
    difficulty: item.difficulty,
    provenance: item.provenance,
    source: item.source,
    confidence: item.confidence,
    importReady: item.importReady,
    needsReview: item.needsReview,
    requiresHumanApproval: true as const,
    warnings: [...item.warnings],
  };
}

function safeFlashcard(item: AIFlashcardCandidate) {
  return {
    candidateId: item.candidateId,
    clinicalConcept: item.clinicalConcept,
    explanation: item.explanation,
    provenance: item.provenance,
    source: item.source,
    confidence: item.confidence,
    importReady: item.importReady,
    needsReview: item.needsReview,
    requiresHumanApproval: true as const,
    warnings: [...item.warnings],
  };
}

function safeSkipped(item: SkippedMCQSourceItem | SkippedFlashcardSourceItem) {
  return {
    reason: item.reason,
    source: item.source,
    ...(item.summary ? { summary: item.summary } : {}),
  };
}

export function buildAIAdminResponse(
  requestId: string,
  target: "mcq" | "flashcard",
  lecture: { id: string; name: string },
  inputKind: "pdf" | "image" | "text",
  result: MCQOperationResult | FlashcardOperationResult,
) {
  const projectedItems = target === "mcq"
    ? (result.items as AIMCQCandidate[]).map(safeMCQ)
    : (result.items as AIFlashcardCandidate[]).map(safeFlashcard);
  const response = {
    requestId,
    target,
    operation: result.operation,
    inputKind,
    lecture: { id: lecture.id, name: lecture.name },
    result: {
      promptVersion: result.promptVersion,
      items: projectedItems,
      skippedItems: result.skippedItems.map((item) => safeSkipped(item)),
      truncated: result.truncated,
      warnings: [...result.warnings],
      requiresHumanApproval: true as const,
      counts: { ...result.counts },
      provider: safeProvider(result.provider),
      processing: { ...result.processing },
    },
  };
  const parsed = aiAdminResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new AIServiceError("AI_INVALID_RESPONSE", {
      publicMessage: "The AI preview response could not be prepared.",
      diagnosticMessage: `AI admin response projection failed validation with ${parsed.error.issues.length} issue(s).`,
      cause: parsed.error,
    });
  }
  return parsed.data;
}