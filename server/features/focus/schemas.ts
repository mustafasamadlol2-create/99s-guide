import { z } from "zod";

export const MAX_FOCUS_PLAN_ITEMS = 100;
export const MAX_FOCUS_SESSION_COUNT = 100;
export const MIN_FOCUS_DURATION_SECONDS = 60;
export const MAX_FOCUS_DURATION_SECONDS = 6 * 60 * 60;
export const MAX_BREAK_DURATION_SECONDS = 3 * 60 * 60;
export const MAX_FOCUS_PLAN_TITLE_LENGTH = 120;
export const MAX_FOCUS_TIMEZONE_LENGTH = 64;
export const MAX_FOCUS_IDEMPOTENCY_KEY_LENGTH = 160;

const uuid = z.string().uuid();
const title = z.string().trim().min(1).max(MAX_FOCUS_PLAN_TITLE_LENGTH);
const timezone = z.string()
  .trim()
  .min(1)
  .max(MAX_FOCUS_TIMEZONE_LENGTH)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Timezone must be a valid IANA time zone.");
const idempotencyKey = z.string()
  .trim()
  .min(8)
  .max(MAX_FOCUS_IDEMPOTENCY_KEY_LENGTH)
  .refine((value) => {
    for (const character of value) {
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint <= 0x1f || codePoint === 0x7f) return false;
    }
    return true;
  });
const clientSource = z.enum(["web", "pwa", "ios", "android", "offline_replay"]);
const interruptionReason = z.enum(["background_absence", "user_confirmed_interruption", "system_interruption"]);

export const focusPlanItemInputSchema = z.object({
  id: uuid.optional(),
  lectureId: uuid,
  sequence: z.number().int().min(1).max(MAX_FOCUS_PLAN_ITEMS),
  sessionCount: z.number().int().min(1).max(MAX_FOCUS_SESSION_COUNT),
  focusDurationSeconds: z.number().int()
    .min(MIN_FOCUS_DURATION_SECONDS)
    .max(MAX_FOCUS_DURATION_SECONDS),
  breakDurationSeconds: z.number().int().min(0).max(MAX_BREAK_DURATION_SECONDS),
  includeMcq: z.boolean(),
  includeFlashcards: z.boolean(),
  includeVideo: z.boolean(),
}).strict();

const items = z.array(focusPlanItemInputSchema)
  .min(1)
  .max(MAX_FOCUS_PLAN_ITEMS)
  .refine((values) => new Set(values.map((item) => item.sequence)).size === values.length, {
    message: "Plan item sequences must be unique.",
  })
  .refine((values) => {
    const ids = values.flatMap((item) => item.id ? [item.id] : []);
    return new Set(ids).size === ids.length;
  }, {
    message: "Plan item IDs must be unique.",
  });

export const createFocusPlanSchema = z.object({
  title,
  timezone,
  items,
}).strict().refine((value) => value.items.every((item) => item.id === undefined), {
  message: "New Focus Plan items cannot specify IDs.",
});

export const updateFocusPlanSchema = z.object({
  title: title.optional(),
  timezone: timezone.optional(),
  items: items.optional(),
}).strict().refine((value) =>
  value.title !== undefined ||
  value.timezone !== undefined ||
  value.items !== undefined,
{
  message: "At least one mutable plan field is required.",
});

export const startFocusSessionSchema = z.object({
  planId: uuid,
  planItemId: uuid,
  idempotencyKey,
  source: clientSource,
}).strict();

export const focusSessionTransitionSchema = z.object({
  idempotencyKey,
  source: clientSource,
}).strict();

export const completeFocusSessionSchema = z.object({
  idempotencyKey,
}).strict();

export const abandonFocusSessionSchema = z.object({
  idempotencyKey,
  reason: z.string().trim().min(1).max(120).optional(),
}).strict();

export const resourceHandoffStartSchema = z.object({
  resourceType: z.enum(["PDF", "VIDEO"]),
  resourceId: uuid,
  idempotencyKey,
  source: clientSource,
}).strict();

export const resourceHandoffReturnSchema = z.object({
  targetState: z.literal("ACTIVE"),
  idempotencyKey,
  source: clientSource,
}).strict();

export const interruptionRecordSchema = z.object({
  observedAwaySeconds: z.number().int().positive().max(6 * 60 * 60),
  reason: interruptionReason,
  idempotencyKey,
  source: clientSource,
}).strict();

export const focusPlanIdSchema = uuid;
export const focusSessionIdSchema = uuid;
export const focusPlanListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();

const quickNoteContent = z.string().refine((value) => {
  const characters = Array.from(value);
  if (!value.trim() || characters.length > 2_000) return false;
  return !characters.some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (codePoint < 0x20 && !["\n", "\r", "\t"].includes(character)) ||
      (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}, "Quick Note content must contain 1–2,000 Unicode characters and no unsupported control characters.");

export const createFocusQuickNoteSchema = z.object({
  focusSessionId: uuid,
  content: quickNoteContent,
  idempotencyKey,
}).strict();

export const updateFocusQuickNoteSchema = z.object({
  content: quickNoteContent,
}).strict();

export const focusQuickNoteIdSchema = uuid;

export const focusQuickNoteListQuerySchema = z.object({
  sessionId: uuid.optional(),
  lectureId: uuid.optional(),
  status: z.enum(["ACTIVE", "ARCHIVED", "CONVERTED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();

export const convertFocusQuickNoteSchema = z.object({
  targetPlanId: uuid,
}).strict();

export const focusMetricsQuerySchema = z.object({
  period: z.enum(["today", "last7Days", "month"]),
}).strict();

export const FOCUS_HISTORY_DEFAULT_LIMIT = 20;
export const FOCUS_HISTORY_MAX_LIMIT = 50;

export const FOCUS_SESSION_STATUSES = [
  "CREATED",
  "ACTIVE",
  "PAUSED",
  "RESOURCE_HANDOFF",
  "RECONCILIATION_REQUIRED",
  "COMPLETED",
  "ABANDONED",
  "EXPIRED",
] as const;

export const focusHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(FOCUS_HISTORY_MAX_LIMIT).default(FOCUS_HISTORY_DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
  status: z.enum(FOCUS_SESSION_STATUSES).optional(),
  subject: z.string().trim().min(1).max(64).optional(),
  lectureId: uuid.optional(),
}).strict();

export type CreateFocusPlanInput = z.infer<typeof createFocusPlanSchema>;
export type UpdateFocusPlanInput = z.infer<typeof updateFocusPlanSchema>;
export type FocusPlanItemInput = z.infer<typeof focusPlanItemInputSchema>;
export type StartFocusSessionInput = z.infer<typeof startFocusSessionSchema>;
export type FocusSessionTransitionInput = z.infer<typeof focusSessionTransitionSchema>;
export type CompleteFocusSessionInput = z.infer<typeof completeFocusSessionSchema>;
export type AbandonFocusSessionInput = z.infer<typeof abandonFocusSessionSchema>;
export type ResourceHandoffStartInput = z.infer<typeof resourceHandoffStartSchema>;
export type ResourceHandoffReturnInput = z.infer<typeof resourceHandoffReturnSchema>;
export type InterruptionRecordInput = z.infer<typeof interruptionRecordSchema>;
export type CreateFocusQuickNoteInput = z.infer<typeof createFocusQuickNoteSchema>;
export type UpdateFocusQuickNoteInput = z.infer<typeof updateFocusQuickNoteSchema>;
export type FocusQuickNoteListQuery = z.infer<typeof focusQuickNoteListQuerySchema>;
export type ConvertFocusQuickNoteInput = z.infer<typeof convertFocusQuickNoteSchema>;
export type FocusMetricsPeriod = z.infer<typeof focusMetricsQuerySchema>["period"];
export type FocusHistoryQuery = z.infer<typeof focusHistoryQuerySchema>;