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

export const createGroupFocusRoomSchema = z.object({
  name: roomName,
  visibility: z.enum(["PUBLIC", "PRIVATE"]),
  mode: z.enum(GROUP_FOCUS_MODES),
  sharedLectureId: uuid.optional(),
  hostLectureId: uuid.optional(),
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
    if (!value.sharedLectureId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sharedLectureId"],
        message: "A shared Lecture is required for SHARED_LECTURE rooms.",
      });
    }
    if (value.hostLectureId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hostLectureId"],
        message: "hostLectureId is only valid for STUDY_TOGETHER rooms.",
      });
    }
  } else {
    if (!value.hostLectureId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hostLectureId"],
        message: "A Host Lecture is required for STUDY_TOGETHER rooms.",
      });
    }
    if (value.sharedLectureId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sharedLectureId"],
        message: "sharedLectureId is only valid for SHARED_LECTURE rooms.",
      });
    }
  }
});

export const joinGroupFocusRoomSchema = z.object({
  inviteToken: safeTokenText.optional(),
  lectureId: uuid.optional(),
}).strict();

export const updateGroupFocusLectureSchema = z.object({
  lectureId: uuid,
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
export type PublicGroupFocusRoomsQuery = z.infer<typeof publicGroupFocusRoomsQuerySchema>;
export type MyGroupFocusRoomsQuery = z.infer<typeof myGroupFocusRoomsQuerySchema>;