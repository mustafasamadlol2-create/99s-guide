import { z } from "zod";
import { AI_INPUT_KINDS, MCQ_ANSWERS, MCQ_QUESTION_STYLES } from "../contracts.js";
import {
  MAX_CANDIDATE_TEXT_LENGTH,
  MAX_SOURCE_EXCERPT_LENGTH,
  MAX_SOURCE_SECTION_LENGTH,
  MAX_UNCERTAINTIES,
  MAX_UNCERTAINTY_LENGTH,
} from "./config.js";
import { MCQ_DIFFICULTIES } from "./contracts.js";

const answerSchema = z.enum(MCQ_ANSWERS);
const uncertaintySchema = z.string().trim().min(1).max(MAX_UNCERTAINTY_LENGTH);
const boundedText = z.string().trim().min(1).max(MAX_CANDIDATE_TEXT_LENGTH);
const nullableText = z.string().trim().min(1).max(MAX_CANDIDATE_TEXT_LENGTH).nullable();

export const mcqSourceEvidenceSchema = z.object({
  inputType: z.enum(AI_INPUT_KINDS),
  page: z.number().int().positive().optional(),
  imageIndex: z.number().int().nonnegative().optional(),
  section: z.string().trim().min(1).max(MAX_SOURCE_SECTION_LENGTH).nullable().optional(),
  label: z.string().trim().min(1).max(200).nullable().optional(),
  supportingExcerpt: z.string().trim().max(MAX_SOURCE_EXCERPT_LENGTH).nullable().optional(),
}).strict();

export const mcqDifficultySchema = z.enum(MCQ_DIFFICULTIES);

export const mcqCandidateSchema = z.object({
  candidateId: z.string().uuid(),
  question: boundedText,
  optionA: boundedText,
  optionB: boundedText,
  optionC: boundedText,
  optionD: boundedText,
  correctAnswer: answerSchema.nullable(),
  hint: nullableText,
  explanation: nullableText,
  difficulty: mcqDifficultySchema.nullable(),
  category: z.enum(["AI_GENERATED", "PREVIOUS_YEAR", "RESOURCE"]),
  provenance: z.enum(["extracted", "generated", "enhanced"]),
  source: mcqSourceEvidenceSchema.nullable(),
  confidence: z.number().finite().min(0).max(1).default(0.5),
  importReady: z.boolean(),
  needsReview: z.boolean(),
  requiresHumanApproval: z.literal(true),
  warnings: z.array(boundedText).max(100),
}).strict();

const providerSourceSchema = mcqSourceEvidenceSchema.nullable().optional();
const providerUncertaintiesSchema = z.array(uncertaintySchema).max(MAX_UNCERTAINTIES);

export const mcqExtractionProviderItemSchema = z.object({
  sourceOrdinal: z.number().int().positive().optional(),
  question: z.string().trim().max(MAX_CANDIDATE_TEXT_LENGTH).nullable(),
  options: z.array(boundedText).max(8),
  correctAnswer: answerSchema.nullable(),
  hint: nullableText,
  explanation: nullableText,
  difficulty: z.string().trim().max(80).nullable(),
  source: providerSourceSchema,
  confidence: z.number().finite().min(0).max(1).default(0.5),
  uncertainties: providerUncertaintiesSchema,
}).strict();

export const skippedMCQProviderItemSchema = z.object({
  reason: z.enum([
    "unsupported_option_count",
    "missing_question",
    "unreadable",
    "not_mcq",
    "unsupported_format",
  ]),
  source: providerSourceSchema,
  summary: z.string().trim().max(300).nullable(),
}).strict();

export const mcqExtractionProviderResponseSchema = z.object({
  items: z.array(mcqExtractionProviderItemSchema).max(100),
  skippedItems: z.array(skippedMCQProviderItemSchema).max(100),
  truncated: z.boolean(),
  uncertainties: providerUncertaintiesSchema,
}).strict();

export const mcqGenerationProviderItemSchema = z.object({
  question: boundedText,
  optionA: boundedText,
  optionB: boundedText,
  optionC: boundedText,
  optionD: boundedText,
  correctAnswer: answerSchema,
  hint: nullableText,
  explanation: nullableText,
  difficulty: z.string().trim().max(80).nullable(),
  source: providerSourceSchema,
  confidence: z.number().finite().min(0).max(1).default(0.5),
  uncertainties: providerUncertaintiesSchema,
}).strict();

export const mcqGenerationProviderResponseSchema = z.object({
  items: z.array(mcqGenerationProviderItemSchema).max(100),
  uncertainties: providerUncertaintiesSchema,
}).strict();

export function createMCQEnhancementProviderResponseSchema(options: {
  hint: boolean;
  explanation: boolean;
}) {
  return z.object({
    items: z.array(z.object({
      candidateId: z.string().uuid(),
      ...(options.hint ? { hint: nullableText.optional() } : {}),
      ...(options.explanation ? { explanation: nullableText.optional() } : {}),
      confidence: z.number().finite().min(0).max(1).default(0.5),
      uncertainties: providerUncertaintiesSchema,
    }).strict()).max(100),
    uncertainties: providerUncertaintiesSchema,
  }).strict();
}

export const mcqEnhancementProviderResponseSchema = createMCQEnhancementProviderResponseSchema({
  hint: true,
  explanation: true,
});

export type MCQExtractionProviderResponse = z.infer<typeof mcqExtractionProviderResponseSchema>;
export type MCQGenerationProviderResponse = z.infer<typeof mcqGenerationProviderResponseSchema>;
export type MCQEnhancementProviderResponse = z.infer<typeof mcqEnhancementProviderResponseSchema>;