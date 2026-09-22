import { z } from "zod";
import type {
  AIAdoptedBinaryFile,
  AIContentPart,
  AIFilePart,
  AIFileSource,
  AIStagedFileCapability,
  AIImageSourceReference,
  AIPdfSourceReference,
  AITextPart,
  AITextSourceReference,
  RawAIBinaryInput,
  RawAIInput,
} from "./contracts.js";
import { isTrustedAIStagedFileCapability } from "./temporaryFiles.js";

const optionalMetadataString = z.string().max(500).optional();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const optionalSourceString = z.string().trim().min(1).optional();

export const aiTextSourceReferenceSchema = z.object({
  inputType: z.literal("text"),
  section: optionalSourceString,
  label: optionalSourceString,
}).strict() satisfies z.ZodType<AITextSourceReference>;

export const aiPdfSourceReferenceSchema = z.object({
  inputType: z.literal("pdf"),
  page: z.number().int().positive().optional(),
  section: optionalSourceString,
  label: optionalSourceString,
}).strict() satisfies z.ZodType<AIPdfSourceReference>;

export const aiImageSourceReferenceSchema = z.object({
  inputType: z.literal("image"),
  imageIndex: z.number().int().nonnegative(),
  label: optionalSourceString,
}).strict() satisfies z.ZodType<AIImageSourceReference>;

const adoptedBinaryFileSchema = z.object({
  sizeBytes: z.number().int().positive(),
  capability: z.custom<AIAdoptedBinaryFile["capability"]>(isTrustedAIStagedFileCapability),
  dispose: z.custom<AIAdoptedBinaryFile["dispose"]>((value) => typeof value === "function"),
}).strict();

export const rawAIBinaryInputSchema = z.object({
  bytes: z.instanceof(Uint8Array).optional(),
  adoptedFile: adoptedBinaryFileSchema.optional(),
  claimedMimeType: z.string().trim().max(100),
  originalFilename: optionalMetadataString,
  sourceLabel: optionalMetadataString,
}).strict().refine(
  (value) => (value.bytes !== undefined) !== (value.adoptedFile !== undefined),
  "Binary input must provide exactly one trusted byte source.",
) satisfies z.ZodType<RawAIBinaryInput>;

export const rawAIInputSchema = z.union([
  z.object({
    kind: z.literal("pdf"),
    file: rawAIBinaryInputSchema,
  }).strict(),
  z.object({
    kind: z.literal("image"),
    files: z.array(rawAIBinaryInputSchema).min(1),
  }).strict(),
  z.object({
    kind: z.literal("text"),
    text: z.string(),
    sourceLabel: optionalMetadataString,
  }).strict(),
]) satisfies z.ZodType<RawAIInput>;

const stagedFileSourceSchema = z.object({
  kind: z.literal("staged_file"),
  capability: z.custom<AIStagedFileCapability>(isTrustedAIStagedFileCapability),
  ownership: z.literal("owned_transient"),
}).strict();

const existingResourceSourceSchema = z.object({
  kind: z.literal("existing_resource"),
  resourceId: z.string().trim().min(1),
  ownership: z.literal("borrowed"),
}).strict();

export const aiFileSourceSchema = z.discriminatedUnion("kind", [
  stagedFileSourceSchema,
  existingResourceSourceSchema,
]) as unknown as z.ZodType<AIFileSource>;

export const aiTextPartSchema = z.object({
  kind: z.literal("text"),
  text: z.string().min(1),
  source: aiTextSourceReferenceSchema,
  sizeBytes: z.number().int().positive(),
  sha256: sha256Schema,
}).strict() satisfies z.ZodType<AITextPart>;

const aiPdfFilePartSchema = z.object({
  kind: z.literal("file"),
  inputType: z.literal("pdf"),
  mimeType: z.literal("application/pdf"),
  fileSource: aiFileSourceSchema,
  source: aiPdfSourceReferenceSchema,
  sizeBytes: z.number().int().positive(),
  sha256: sha256Schema,
  pageCount: z.number().int().positive().optional(),
}).strict();

const aiImageFilePartSchema = z.object({
  kind: z.literal("file"),
  inputType: z.literal("image"),
  mimeType: z.enum([
    "image/jpeg",
    "image/png",
    "image/webp",
  ]),
  fileSource: aiFileSourceSchema,
  source: aiImageSourceReferenceSchema,
  sizeBytes: z.number().int().positive(),
  sha256: sha256Schema,
}).strict();

export const aiFilePartSchema = z.union([
  aiPdfFilePartSchema,
  aiImageFilePartSchema,
]) satisfies z.ZodType<AIFilePart>;

export const aiContentPartSchema = z.union([
  aiTextPartSchema,
  aiFilePartSchema,
]) satisfies z.ZodType<AIContentPart>;