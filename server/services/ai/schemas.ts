import { z } from "zod";
import {
  AI_CONTENT_TARGETS,
  AI_INPUT_KINDS,
  AI_OPERATIONS,
  AI_PROVENANCE_VALUES,
  MCQ_ANSWERS,
  MCQ_QUESTION_STYLES,
} from "./contracts.js";

const trimmedRequiredString = z.string().trim().min(1);
const optionalTrimmedString = z.string().trim().min(1).nullable().optional();

export const aiOperationSchema = z.enum(AI_OPERATIONS);
export const aiContentTargetSchema = z.enum(AI_CONTENT_TARGETS);
export const aiInputKindSchema = z.enum(AI_INPUT_KINDS);
export const aiProvenanceSchema = z.enum(AI_PROVENANCE_VALUES);
export const mcqAnswerSchema = z.enum(MCQ_ANSWERS);
export const mcqQuestionStyleSchema = z.enum(MCQ_QUESTION_STYLES);
export const aiConfidenceSchema = z.number().finite().min(0).max(1);
export const aiWarningsSchema = z.array(trimmedRequiredString).max(100);

export const aiSourceReferenceSchema = z.object({
  inputType: aiInputKindSchema,
  page: z.number().int().positive().optional(),
  imageIndex: z.number().int().nonnegative().optional(),
  section: optionalTrimmedString,
  label: optionalTrimmedString,
}).strict();

const aiDraftMetadataShape = {
  source: aiSourceReferenceSchema.optional(),
  provenance: aiProvenanceSchema,
  confidence: aiConfidenceSchema,
  needsReview: z.boolean(),
  warnings: aiWarningsSchema,
};

export const aiMcqDraftSchema = z.object({
  question: trimmedRequiredString,
  optionA: trimmedRequiredString,
  optionB: trimmedRequiredString,
  optionC: trimmedRequiredString,
  optionD: trimmedRequiredString,
  correctAnswer: mcqAnswerSchema,
  hint: optionalTrimmedString,
  explanation: optionalTrimmedString,
  difficulty: optionalTrimmedString,
  ...aiDraftMetadataShape,
}).strict();

export const aiFlashcardDraftSchema = z.object({
  clinicalConcept: trimmedRequiredString,
  explanation: trimmedRequiredString,
  ...aiDraftMetadataShape,
}).strict();

export const aiEnhancementOptionsSchema = z.object({
  hint: z.boolean().optional(),
  explanation: z.boolean().optional(),
}).strict().refine(
  (fields) => fields.hint === true || fields.explanation === true,
  "At least one enhancement field must be selected.",
);

export const aiFlashcardEnhancementOptionsSchema = z.object({
  explanation: z.literal(true),
}).strict();

export const aiMcqGenerationOptionsSchema = z.object({
  count: z.number().int().min(1).max(100),
  difficulty: optionalTrimmedString,
  questionStyle: mcqQuestionStyleSchema,
  includeHints: z.boolean(),
  includeExplanations: z.boolean(),
}).strict();

export const aiFlashcardGenerationOptionsSchema = z.object({
  count: z.number().int().min(1).max(300),
  includeExplanation: z.boolean(),
  focus: optionalTrimmedString,
}).strict();

export const aiRequestContextSchema = z.object({
  lectureId: optionalTrimmedString,
  sourceLabel: optionalTrimmedString,
}).strict();

const requestBaseShape = {
  inputKind: aiInputKindSchema,
  context: aiRequestContextSchema.optional(),
};

export const aiRequestEnvelopeSchema = z.union([
  z.object({
    ...requestBaseShape,
    target: z.literal("mcq"),
    operation: z.literal("extract"),
  }).strict(),
  z.object({
    ...requestBaseShape,
    target: z.literal("mcq"),
    operation: z.literal("generate"),
    generationOptions: aiMcqGenerationOptionsSchema,
  }).strict(),
  z.object({
    ...requestBaseShape,
    target: z.literal("mcq"),
    operation: z.literal("enhance"),
    enhancementOptions: aiEnhancementOptionsSchema,
  }).strict(),
  z.object({
    ...requestBaseShape,
    target: z.literal("flashcard"),
    operation: z.literal("extract"),
  }).strict(),
  z.object({
    ...requestBaseShape,
    target: z.literal("flashcard"),
    operation: z.literal("generate"),
    generationOptions: aiFlashcardGenerationOptionsSchema,
  }).strict(),
  z.object({
    ...requestBaseShape,
    target: z.literal("flashcard"),
    operation: z.literal("enhance"),
    enhancementOptions: aiFlashcardEnhancementOptionsSchema,
  }).strict(),
]);

export const aiProviderMetadataSchema = z.object({
  provider: trimmedRequiredString,
  model: trimmedRequiredString,
  responseId: optionalTrimmedString,
}).strict();

export const aiProcessingMetadataSchema = z.object({
  durationMs: z.number().finite().nonnegative(),
}).strict();

export const aiMcqResponseEnvelopeSchema = z.object({
  target: z.literal("mcq"),
  operation: aiOperationSchema,
  items: z.array(aiMcqDraftSchema),
  warnings: aiWarningsSchema,
  provider: aiProviderMetadataSchema,
  processing: aiProcessingMetadataSchema,
}).strict();

export const aiFlashcardResponseEnvelopeSchema = z.object({
  target: z.literal("flashcard"),
  operation: aiOperationSchema,
  items: z.array(aiFlashcardDraftSchema),
  warnings: aiWarningsSchema,
  provider: aiProviderMetadataSchema,
  processing: aiProcessingMetadataSchema,
}).strict();

export const aiResponseEnvelopeSchema = z.discriminatedUnion("target", [
  aiMcqResponseEnvelopeSchema,
  aiFlashcardResponseEnvelopeSchema,
]);

export const aiMcqCandidateBatchSchema = z.object({
  items: z.array(aiMcqDraftSchema),
  warnings: aiWarningsSchema,
}).strict();

export const aiFlashcardCandidateBatchSchema = z.object({
  items: z.array(aiFlashcardDraftSchema),
  warnings: aiWarningsSchema,
}).strict();

export type AISourceReference = z.infer<typeof aiSourceReferenceSchema>;
export type AIMCQDraft = z.infer<typeof aiMcqDraftSchema>;
export type AIFlashcardDraft = z.infer<typeof aiFlashcardDraftSchema>;
export type AIEnhancementOptions = z.infer<typeof aiEnhancementOptionsSchema>;
export type AIFlashcardEnhancementOptions = z.infer<typeof aiFlashcardEnhancementOptionsSchema>;
export type AIMCQGenerationOptions = z.infer<typeof aiMcqGenerationOptionsSchema>;
export type AIFlashcardGenerationOptions = z.infer<typeof aiFlashcardGenerationOptionsSchema>;
export type AIRequestEnvelope = z.infer<typeof aiRequestEnvelopeSchema>;
export type AIResponseEnvelope = z.infer<typeof aiResponseEnvelopeSchema>;