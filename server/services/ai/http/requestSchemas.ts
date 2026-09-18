import { z } from "zod";
import {
  AI_INPUT_KINDS,
  AI_OPERATIONS,
  MCQ_QUESTION_STYLES,
  type AIInputKind,
  type AIOperation,
  type MCQQuestionStyle,
} from "../contracts.js";
import type { MCQDifficulty, MCQEnhancementOptions, MCQGenerationOptions, MCQExtractOptions } from "../mcq/contracts.js";
import type { FlashcardEnhancementOptions, FlashcardGenerationOptions } from "../flashcard/contracts.js";
import { AI_HTTP_MAX_OPTIONS_BYTES } from "./limits.js";
import { AIHttpError } from "./errors.js";

const baseRequestSchema = z.object({
  lectureId: z.string().trim().min(1).max(200),
  operation: z.enum(AI_OPERATIONS),
  inputKind: z.enum(AI_INPUT_KINDS),
  options: z.unknown().optional(),
  text: z.string().optional(),
}).strict();

const emptyOptionsSchema = z.object({}).strict();
const mcqExtractOptionsSchema = z.object({
  category: z.enum(["AI_GENERATED", "PREVIOUS_YEAR", "RESOURCE"]).default("AI_GENERATED"),
  difficulty: z.enum(["Easy", "Medium", "Hard"]).default("Medium"),
}).strict();
const mcqGenerationOptionsSchema = z.object({
  count: z.number().int().min(1).max(100).optional(),
  difficulty: z.enum(["Easy", "Medium", "Hard", "mixed"]).nullable().optional(),
  questionStyle: z.enum(MCQ_QUESTION_STYLES),
  includeHints: z.boolean(),
  includeExplanations: z.boolean(),
}).strict();
const mcqEnhancementOptionsSchema = z.object({
  hint: z.boolean().optional(),
  explanation: z.boolean().optional(),
  category: z.enum(["AI_GENERATED", "PREVIOUS_YEAR", "RESOURCE"]).default("AI_GENERATED"),
  difficulty: z.enum(["Easy", "Medium", "Hard"]).default("Medium"),
}).strict().refine((value) => value.hint === true || value.explanation === true, {
  message: "Select at least one MCQ enhancement field.",
});
const flashcardGenerationOptionsSchema = z.object({
  count: z.number().int().min(1).max(100).optional(),
  focus: z.string().trim().max(200).nullable().optional(),
}).strict();
const flashcardEnhancementOptionsSchema = z.object({
  explanation: z.literal(true),
}).strict();

export type ParsedPreviewRequest =
  | {
    target: "mcq";
    lectureId: string;
    operation: AIOperation;
    inputKind: AIInputKind;
    text?: string;
    options: Record<string, never> | MCQExtractOptions | MCQGenerationOptions | MCQEnhancementOptions;
  }
  | {
    target: "flashcard";
    lectureId: string;
    operation: AIOperation;
    inputKind: AIInputKind;
    text?: string;
    options: Record<string, never> | FlashcardGenerationOptions | FlashcardEnhancementOptions;
  };

export function parseMultipartOptions(value: unknown): unknown {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") throw new AIHttpError(400, "AI_INVALID_REQUEST", "Multipart options must be a JSON object.");
  if (Buffer.byteLength(value, "utf8") > AI_HTTP_MAX_OPTIONS_BYTES) {
    throw new AIHttpError(413, "AI_OPTIONS_TOO_LARGE", "AI preview options exceed the allowed size.");
  }
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Options must be a JSON object.");
    }
    return parsed;
  } catch (error) {
    throw new AIHttpError(400, "AI_INVALID_OPTIONS", "AI preview options must be valid JSON.", false, undefined, error);
  }
}

export function parsePreviewRequest(target: "mcq" | "flashcard", value: unknown): ParsedPreviewRequest {
  const base = baseRequestSchema.parse(value);
  if (base.options !== undefined && Buffer.byteLength(JSON.stringify(base.options), "utf8") > AI_HTTP_MAX_OPTIONS_BYTES) {
    throw new AIHttpError(413, "AI_OPTIONS_TOO_LARGE", "AI preview options exceed the allowed size.");
  }
  if (base.inputKind === "text" && (!base.text || base.text.length === 0)) {
    throw new AIHttpError(400, "AI_TEXT_REQUIRED", "Text input requires non-empty text.");
  }
  if (base.inputKind !== "text" && base.text !== undefined) {
    throw new AIHttpError(400, "AI_INPUT_CONTRADICTION", "Binary input requests cannot include pasted text.");
  }
  const options = base.options;
  if (target === "mcq") {
    if (base.operation === "extract") {
      return { ...base, target, options: mcqExtractOptionsSchema.parse(options ?? {}) };
    }
    if (base.operation === "generate") {
      return { ...base, target, options: mcqGenerationOptionsSchema.parse(options ?? {}) };
    }
    return { ...base, target, options: mcqEnhancementOptionsSchema.parse(options ?? {}) };
  }
  if (base.operation === "extract") {
    return { ...base, target, options: emptyOptionsSchema.parse(options ?? {}) };
  }
  if (base.operation === "generate") {
    return { ...base, target, options: flashcardGenerationOptionsSchema.parse(options ?? {}) };
  }
  return { ...base, target, options: flashcardEnhancementOptionsSchema.parse(options ?? {}) };
}

export type ParsedMCQPreviewRequest = Extract<ParsedPreviewRequest, { target: "mcq" }>;
export type ParsedFlashcardPreviewRequest = Extract<ParsedPreviewRequest, { target: "flashcard" }>;
export type ParsedMCQGenerationOptions = Extract<ParsedMCQPreviewRequest["options"], MCQGenerationOptions>;
export type ParsedMCQEnhancementOptions = Extract<ParsedMCQPreviewRequest["options"], MCQEnhancementOptions>;
export type ParsedFlashcardGenerationOptions = Extract<ParsedFlashcardPreviewRequest["options"], FlashcardGenerationOptions>;
export type ParsedFlashcardEnhancementOptions = Extract<ParsedFlashcardPreviewRequest["options"], FlashcardEnhancementOptions>;

export type { MCQDifficulty, MCQQuestionStyle };