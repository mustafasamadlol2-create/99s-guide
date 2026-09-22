import { z } from "zod";
import { CALENDAR_TARGET_GROUPS } from "../../../shared/calendarContracts.js";
import { PERSONALIZATION_SUBJECT_IDS } from "../../../shared/personalization.js";

export const CALENDAR_IMPORT_MAX_CANDIDATES = 500;
export const CALENDAR_IMPORT_MAX_REVIEW_BATCH = 500;
export const CALENDAR_IMPORT_TIMEZONE = "Asia/Baghdad";
export const CALENDAR_IMPORT_STATUSES = [
  "UPLOADED",
  "PROCESSING",
  "READY_FOR_REVIEW",
  "IMPORTING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export const CALENDAR_IMPORT_STAGES = [
  "Uploading",
  "Preparing source",
  "Extracting schedule",
  "Validating dates and times",
  "Verifying against source",
  "Checking Calendar conflicts",
  "Ready for review",
  "Importing",
  "Completed",
] as const;
export const CALENDAR_CANDIDATE_STATUSES = [
  "VERIFIED",
  "NEEDS_REVIEW",
  "INVALID",
  "DUPLICATE",
  "CONFLICT",
] as const;
export const CALENDAR_VERIFICATION_STATUSES = [
  "SOURCE_MATCH",
  "MISMATCH",
  "AMBIGUOUS",
  "NOT_FOUND",
] as const;
export const CALENDAR_EVENT_TYPES = [
  "LECTURE",
  "QUIZ",
  "EXAM",
  "TASK",
  "PERSONAL",
  "HOLIDAY",
] as const;
export const CALENDAR_SUBJECT_IDS = PERSONALIZATION_SUBJECT_IDS;
export { CALENDAR_TARGET_GROUPS };

const nullableString = (max: number) => z.string().trim().max(max).nullable().optional().default(null);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);

export const calendarVerificationSchema = z.object({
  status: z.enum(CALENDAR_VERIFICATION_STATUSES),
  issues: z.array(z.string().trim().min(1).max(240)).max(20).default([]),
}).strict();

export const calendarCandidateSchema = z.object({
  candidateId: z.string().trim().min(1).max(128),
  title: nullableString(240),
  eventType: z.enum(CALENDAR_EVENT_TYPES).nullable(),
  date: isoDate.nullable(),
  startTime: localTime.nullable(),
  endTime: localTime.nullable(),
  allDay: z.boolean(),
  rawDate: nullableString(160),
  rawStartTime: nullableString(80),
  rawEndTime: nullableString(80),
  subjectId: z.enum(CALENDAR_SUBJECT_IDS).nullable(),
  subjectLabelRaw: nullableString(160),
  room: nullableString(160),
  doctor: nullableString(160),
  description: nullableString(1_000),
  targetGroups: z.array(z.enum(CALENDAR_TARGET_GROUPS)).max(6),
  sourcePage: z.number().int().positive().nullable(),
  sourceImageIndex: z.number().int().nonnegative().nullable(),
  sourceEvidence: nullableString(2_000),
  warnings: z.array(z.string().trim().min(1).max(240)).max(50),
  verification: calendarVerificationSchema,
  status: z.enum(CALENDAR_CANDIDATE_STATUSES),
  selected: z.boolean(),
}).strict();

export const extractionCandidateSchema = z.object({
  // Provider-facing extraction intentionally accepts common textual date/time
  // representations. normalizeCandidate performs the strict Baghdad-calendar
  // normalization afterwards, so one harmless formatting variation from the
  // model cannot reject an otherwise correct annual timetable.
  title: nullableString(240),
  eventType: nullableString(64),
  date: nullableString(64),
  startTime: nullableString(64),
  endTime: nullableString(64),
  allDay: z.boolean().catch(false).default(false),
  rawDate: nullableString(160),
  rawStartTime: nullableString(80),
  rawEndTime: nullableString(80),
  subjectId: nullableString(64),
  subjectLabelRaw: nullableString(160),
  room: nullableString(160),
  doctor: nullableString(160),
  description: nullableString(1_000),
  targetGroups: z.array(z.string().trim().max(32)).max(6).catch([]).default([]),
  sourcePage: z.number().int().positive().nullable().optional().catch(null).default(null),
  sourceImageIndex: z.number().int().nonnegative().nullable().optional().catch(null).default(null),
  sourceEvidence: nullableString(2_000),
  warnings: z.array(z.string().trim().min(1).max(240)).max(50).catch([]).default([]),
});

export const extractionBatchSchema = z.object({
  items: z.array(extractionCandidateSchema).max(CALENDAR_IMPORT_MAX_CANDIDATES),
  warnings: z.array(z.string().trim().min(1).max(240)).max(50).catch([]).default([]),
});

export const verificationItemSchema = z.object({
  candidateId: z.string().trim().min(1).max(128),
  status: z.enum(CALENDAR_VERIFICATION_STATUSES).catch("AMBIGUOUS"),
  issues: z.array(z.string().trim().min(1).max(240)).max(20).catch([]).default([]),
});

export const verificationBatchSchema = z.object({
  items: z.array(verificationItemSchema).max(CALENDAR_IMPORT_MAX_CANDIDATES),
  warnings: z.array(z.string().trim().min(1).max(240)).max(50).catch([]).default([]),
});

export const calendarImportPreviewSchema = z.object({
  candidates: z.array(calendarCandidateSchema).max(CALENDAR_IMPORT_MAX_CANDIDATES),
  warnings: z.array(z.string().trim().min(1).max(240)).max(50),
  provider: z.object({
    provider: z.string().trim().min(1).max(64),
    model: z.string().trim().min(1).max(160),
    responseId: z.string().trim().min(1).max(512).optional(),
    transport: z.enum(["inline", "files_api", "markdown_conversion"]).optional(),
    mediaCount: z.number().int().nonnegative().optional(),
    cleanupWarning: z.literal("provider_media_cleanup_failed").optional(),
  }).strict(),
}).strict();

export const reviewUpdateSchema = z.object({
  candidates: z.array(calendarCandidateSchema).min(1).max(CALENDAR_IMPORT_MAX_REVIEW_BATCH),
}).strict();

export const commitRequestSchema = z.object({
  candidateIds: z.array(z.string().trim().min(1).max(128)).min(1).max(CALENDAR_IMPORT_MAX_CANDIDATES),
  allowConflicts: z.boolean().default(false),
}).strict();

export type CalendarCandidate = z.infer<typeof calendarCandidateSchema>;
export type ExtractionCandidate = z.infer<typeof extractionCandidateSchema>;
export type VerificationItem = z.infer<typeof verificationItemSchema>;
export type CalendarImportPreview = z.infer<typeof calendarImportPreviewSchema>;
export type ReviewUpdate = z.infer<typeof reviewUpdateSchema>;
export type CommitRequest = z.infer<typeof commitRequestSchema>;