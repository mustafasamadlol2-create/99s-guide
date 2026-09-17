import { z } from "zod";
import { AI_INPUT_KINDS } from "../contracts.js";
import {
  MAX_FLASHCARD_CANDIDATE_TEXT_LENGTH,
  MAX_FLASHCARD_SOURCE_EXCERPT_LENGTH,
  MAX_FLASHCARD_SOURCE_SECTION_LENGTH,
  MAX_FLASHCARD_UNCERTAINTIES,
  MAX_FLASHCARD_UNCERTAINTY_LENGTH,
} from "./config.js";

const uncertaintySchema = z.string().trim().min(1).max(MAX_FLASHCARD_UNCERTAINTY_LENGTH);
const boundedText = z.string().trim().min(1).max(MAX_FLASHCARD_CANDIDATE_TEXT_LENGTH);
const nullableText = z.string().trim().min(1).max(MAX_FLASHCARD_CANDIDATE_TEXT_LENGTH).nullable();

export const flashcardSourceEvidenceSchema = z.object({
  inputType: z.enum(AI_INPUT_KINDS),
  page: z.number().int().positive().optional(),
  imageIndex: z.number().int().nonnegative().optional(),
  section: z.string().trim().min(1).max(MAX_FLASHCARD_SOURCE_SECTION_LENGTH).nullable().optional(),
  label: z.string().trim().min(1).max(200).nullable().optional(),
  supportingExcerpt: z.string().trim().max(MAX_FLASHCARD_SOURCE_EXCERPT_LENGTH).nullable().optional(),
}).strict();

const providerSourceSchema = flashcardSourceEvidenceSchema.nullable().optional();
const providerUncertaintiesSchema = z.array(uncertaintySchema).max(MAX_FLASHCARD_UNCERTAINTIES);

export const flashcardExtractionProviderItemSchema = z.object({
  clinicalConcept: z.string().trim().max(MAX_FLASHCARD_CANDIDATE_TEXT_LENGTH).nullable(),
  explanation: nullableText,
  source: providerSourceSchema,
  confidence: z.number().finite().min(0).max(1),
  uncertainties: providerUncertaintiesSchema,
}).strict();

export const skippedFlashcardProviderItemSchema = z.object({
  reason: z.enum(["missing_front", "unreadable", "unsupported_format", "not_flashcard"]),
  source: providerSourceSchema,
  summary: z.string().trim().max(300).nullable(),
}).strict();

export const flashcardExtractionProviderResponseSchema = z.object({
  items: z.array(flashcardExtractionProviderItemSchema).max(100),
  skippedItems: z.array(skippedFlashcardProviderItemSchema).max(100),
  truncated: z.boolean(),
  uncertainties: providerUncertaintiesSchema,
}).strict();

export const flashcardGenerationProviderItemSchema = z.object({
  clinicalConcept: boundedText,
  explanation: boundedText,
  source: providerSourceSchema,
  confidence: z.number().finite().min(0).max(1),
  uncertainties: providerUncertaintiesSchema,
}).strict();

export const flashcardGenerationProviderResponseSchema = z.object({
  items: z.array(flashcardGenerationProviderItemSchema).max(100),
  uncertainties: providerUncertaintiesSchema,
}).strict();

export const flashcardEnhancementProviderItemSchema = z.object({
  candidateId: z.string().uuid(),
  explanation: boundedText,
  confidence: z.number().finite().min(0).max(1),
  uncertainties: providerUncertaintiesSchema,
  source: providerSourceSchema,
}).strict();

export const flashcardEnhancementProviderResponseSchema = z.object({
  items: z.array(flashcardEnhancementProviderItemSchema).max(100),
  uncertainties: providerUncertaintiesSchema,
}).strict();

export type FlashcardExtractionProviderResponse = z.infer<typeof flashcardExtractionProviderResponseSchema>;
export type FlashcardGenerationProviderResponse = z.infer<typeof flashcardGenerationProviderResponseSchema>;
export type FlashcardEnhancementProviderResponse = z.infer<typeof flashcardEnhancementProviderResponseSchema>;