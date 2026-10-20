import { z } from "zod";
import {
  MAX_BREAK_DURATION_SECONDS,
  MAX_FOCUS_DURATION_SECONDS,
  MIN_FOCUS_DURATION_SECONDS,
} from "../focus/schemas.js";
import {
  GROUP_FOCUS_MODES,
} from "../study-core/groupFocus.js";
import {
  GROUP_FOCUS_DEFAULT_MAX_PARTICIPANTS,
  GROUP_FOCUS_IDEMPOTENCY_KEY_MAX_LENGTH,
  GROUP_FOCUS_MAX_PARTICIPANTS,
  GROUP_FOCUS_MAX_ROUNDS,
  GROUP_FOCUS_MEMBERSHIP_STATUSES,
  GROUP_FOCUS_MIN_PARTICIPANTS,
  GROUP_FOCUS_MIN_ROUNDS,
  GROUP_FOCUS_ROOM_NAME_MAX_CODEPOINTS,
  GROUP_FOCUS_ROOM_STATUSES,
  GROUP_FOCUS_VISIBILITIES,
} from "./types.js";
import {
  GROUP_FOCUS_STUDY_PLAN_MAX_ITEMS,
  GROUP_FOCUS_STUDY_PLAN_MAX_RESOURCES_PER_ITEM,
  GROUP_FOCUS_STUDY_RESOURCE_TYPES,
} from "../../../shared/group-focus-study-plan/contract.js";

const uuid = z.string().uuid();
const hasControlCharacters = (value: string): boolean =>
  Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
const safeTokenText = z.string()
  .min(16)
  .max(128)
  .refine((value) => !hasControlCharacters(value));
const opaqueResourceId = z.string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !hasControlCharacters(value));
const roomName = z.string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, "Room name cannot be blank.")
  .refine(
    (value) => Array.from(value).length <= GROUP_FOCUS_ROOM_NAME_MAX_CODEPOINTS,
    "Room name is too long.",
  )
  .refine((value) => !hasControlCharacters(value), "Room name contains invalid characters.");
const idempotencyKey = z.string()
  .trim()
  .min(8)
  .max(GROUP_FOCUS_IDEMPOTENCY_KEY_MAX_LENGTH)
  .refine((value) => !hasControlCharacters(value), "Idempotency key contains invalid characters.");

export const groupFocusStudyResourceSelectionSchema = z.object({
  resourceType: z.enum(GROUP_FOCUS_STUDY_RESOURCE_TYPES),
  resourceId: opaqueResourceId,
  sequence: z.number().int().min(1).max(GROUP_FOCUS_STUDY_PLAN_MAX_RESOURCES_PER_ITEM),
}).strict();

export const groupFocusStudyPlanItemSchema = z.object({
  lectureId: uuid,
  sequence: z.number().int().min(1).max(GROUP_FOCUS_STUDY_PLAN_MAX_ITEMS),
  resources: z.array(groupFocusStudyResourceSelectionSchema)
    .min(1, "Choose at least one study resource for every Lecture.")
    .max(GROUP_FOCUS_STUDY_PLAN_MAX_RESOURCES_PER_ITEM)
    .refine(
      (resources) =>
        new Set(resources.map((resource) => `${resource.resourceType}:${resource.resourceId}`)).size
          === resources.length,
      { message: "Study resources must be unique inside each Lecture." },
    )
    .refine(
      (resources) => new Set(resources.map((resource) => resource.sequence)).size === resources.length,
      { message: "Study resource sequences must be unique inside each Lecture." },
    ),
}).strict();

export const groupFocusStudyPlanSchema = z.array(groupFocusStudyPlanItemSchema)
  .min(1, "Choose at least one Lecture for the Group Focus study plan.")
  .max(GROUP_FOCUS_STUDY_PLAN_MAX_ITEMS)
  .refine(
    (items) => new Set(items.map((item) => item.lectureId)).size === items.length,
    { message: "A Lecture can appear only once in a Group Focus study plan." },
  )
  .refine(
    (items) => new Set(items.map((item) => item.sequence)).size === items.length,
    { message: "Study plan sequences must be unique." },
  );

function firstLectureId(
  plan: z.infer<typeof groupFocusStudyPlanSchema> | undefined,
): string | undefined {
  if (!plan?.length) return undefined;
  return [...plan].sort((a, b) => a.sequence - b.sequence)[0]?.lectureId;
}

export const createGroupFocusRoomSchema = z.object({
  name: roomName,
  visibility: z.enum(["PUBLIC", "PRIVATE"]),
  mode: z.enum(GROUP_FOCUS_MODES),
  // Legacy single-Lecture fields stay accepted during rolling deployments.
  // New clients submit the corresponding multi-Lecture plan as well.
  sharedLectureId: uuid.optional(),
  hostLectureId: uuid.optional(),
  sharedStudyPlan: groupFocusStudyPlanSchema.optional(),
  hostStudyPlan: groupFocusStudyPlanSchema.optional(),
  focusDurationSeconds: z.number().int()
    .min(MIN_FOCUS_DURATION_SECONDS)
    .max(MAX_FOCUS_DURATION_SECONDS),
  breakDurationSeconds: z.number().int().min(0).max(MAX_BREAK_DURATION_SECONDS),
  roundCount: z.number().int().min(GROUP_FOCUS_MIN_ROUNDS).max(GROUP_FOCUS_MAX_ROUNDS),
  maxParticipants: z.number().int()
    .min(GROUP_FOCUS_MIN_PARTICIPANTS)
    .max(GROUP_FOCUS_MAX_PARTICIPANTS)
    .default(GROUP_FOCUS_DEFAULT_MAX_PARTICIPANTS),
  idempotencyKey,
}).strict().superRefine((value, context) => {
  if (value.mode === "SHARED_LECTURE") {
    const primary = firstLectureId(value.sharedStudyPlan) ?? value.sharedLectureId;
    if (!primary) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sharedStudyPlan"],
        message: "A shared Group Focus study plan is required.",
      });
    }
    if (
      value.sharedStudyPlan
      && value.sharedLectureId
      && firstLectureId(value.sharedStudyPlan) !== value.sharedLectureId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sharedLectureId"],
        message: "sharedLectureId must match the first shared study-plan Lecture.",
      });
    }
    if (value.hostLectureId || value.hostStudyPlan) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [value.hostStudyPlan ? "hostStudyPlan" : "hostLectureId"],
        message: "Host-only study plans are only valid for STUDY_TOGETHER rooms.",
      });
    }
  } else {
    const primary = firstLectureId(value.hostStudyPlan) ?? value.hostLectureId;
    if (!primary) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hostStudyPlan"],
        message: "The Host study plan is required for STUDY_TOGETHER rooms.",
      });
    }
    if (
      value.hostStudyPlan
      && value.hostLectureId
      && firstLectureId(value.hostStudyPlan) !== value.hostLectureId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hostLectureId"],
        message: "hostLectureId must match the first Host study-plan Lecture.",
      });
    }
    if (value.sharedLectureId || value.sharedStudyPlan) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [value.sharedStudyPlan ? "sharedStudyPlan" : "sharedLectureId"],
        message: "Shared study plans are only valid for SHARED_LECTURE rooms.",
      });
    }
  }
});

export const joinGroupFocusRoomSchema = z.object({
  inviteToken: safeTokenText.optional(),
  // Legacy single-Lecture field accepted during rolling deployments.
  lectureId: uuid.optional(),
  studyPlan: groupFocusStudyPlanSchema.optional(),
}).strict().superRefine((value, context) => {
  if (
    value.studyPlan
    && value.lectureId
    && firstLectureId(value.studyPlan) !== value.lectureId
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lectureId"],
      message: "lectureId must match the first study-plan Lecture.",
    });
  }
});

export const updateGroupFocusLectureSchema = z.object({
  lectureId: uuid,
}).strict();

export const updateGroupFocusStudyPlanSchema = z.object({
  studyPlan: groupFocusStudyPlanSchema,
}).strict();

const boundedLimit = z.coerce.number().int().min(1).max(50).default(20);

export const publicGroupFocusRoomsQuerySchema = z.object({
  limit: boundedLimit,
  cursor: uuid.optional(),
}).strict();

export const myGroupFocusRoomsQuerySchema = z.object({
  limit: boundedLimit,
  membershipStatus: z.enum(GROUP_FOCUS_MEMBERSHIP_STATUSES).optional(),
  roomStatus: z.enum(GROUP_FOCUS_ROOM_STATUSES).optional(),
}).strict();

export const groupFocusRoomIdSchema = uuid;
export const groupFocusUserIdSchema = uuid;
export const emptyGroupFocusBodySchema = z.object({}).strict();

export type CreateGroupFocusRoomInput = z.infer<typeof createGroupFocusRoomSchema>;
export type JoinGroupFocusRoomInput = z.infer<typeof joinGroupFocusRoomSchema>;
export type GroupFocusStudyPlanInput = z.infer<typeof groupFocusStudyPlanSchema>;
export type PublicGroupFocusRoomsQuery = z.infer<typeof publicGroupFocusRoomsQuerySchema>;
export type MyGroupFocusRoomsQuery = z.infer<typeof myGroupFocusRoomsQuerySchema>;
