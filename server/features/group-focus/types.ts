import type {
  GROUP_FOCUS_MODES,
  GROUP_FOCUS_PARTICIPANT_ROLES,
} from "../study-core/groupFocus.js";

export const GROUP_FOCUS_VISIBILITIES = ["PUBLIC", "PRIVATE"] as const;
export const GROUP_FOCUS_ROOM_STATUSES = ["OPEN", "CLOSED"] as const;
export const GROUP_FOCUS_MEMBERSHIP_STATUSES = ["ACTIVE", "LEFT", "REMOVED"] as const;
export const GROUP_FOCUS_MIN_PARTICIPANTS = 2;
export const GROUP_FOCUS_DEFAULT_MAX_PARTICIPANTS = 12;
export const GROUP_FOCUS_MAX_PARTICIPANTS = 25;
export const GROUP_FOCUS_MIN_ROUNDS = 1;
export const GROUP_FOCUS_MAX_ROUNDS = 20;
export const GROUP_FOCUS_ROOM_NAME_MAX_CODEPOINTS = 100;
export const GROUP_FOCUS_IDEMPOTENCY_KEY_MAX_LENGTH = 160;
export const GROUP_FOCUS_INVITE_TOKEN_BYTES = 24;

export type GroupFocusMode = (typeof GROUP_FOCUS_MODES)[number];
export type GroupFocusRole = (typeof GROUP_FOCUS_PARTICIPANT_ROLES)[number];
export type GroupFocusVisibility = (typeof GROUP_FOCUS_VISIBILITIES)[number];
export type GroupFocusRoomStatus = (typeof GROUP_FOCUS_ROOM_STATUSES)[number];
export type GroupFocusMembershipStatus =
  (typeof GROUP_FOCUS_MEMBERSHIP_STATUSES)[number];

export type GroupFocusRoomDto = {
  id: string;
  name: string;
  visibility: GroupFocusVisibility;
  mode: GroupFocusMode;
  sharedLectureId: string | null;
  focusDurationSeconds: number;
  breakDurationSeconds: number;
  roundCount: number;
  maxParticipants: number;
  participantCount: number;
  status: GroupFocusRoomStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

export type GroupFocusMembershipDto = {
  membershipId: string;
  roomId: string;
  userId: string;
  role: GroupFocusRole;
  status: GroupFocusMembershipStatus;
  selectedLectureId: string | null;
  joinedAt: string;
  leftAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GroupFocusMyRoomDto = {
  room: GroupFocusRoomDto;
  membership: GroupFocusMembershipDto;
  effectiveLectureId: string | null;
};

export type GroupFocusAuthorizationContext = {
  roomId: string;
  membershipId: string;
  userId: string;
  role: GroupFocusRole;
  mode: GroupFocusMode;
  visibility: GroupFocusVisibility;
  effectiveLectureId: string;
  focusDurationSeconds: number;
  breakDurationSeconds: number;
  roundCount: number;
  maxParticipants: number;
  roomUpdatedAt: string;
  membershipUpdatedAt: string;
};

export type GroupFocusIdempotency = "CREATED" | "REPLAY_SAME_PAYLOAD";

export type GroupFocusRoomPage = {
  rooms: GroupFocusRoomDto[];
  nextCursor: string | null;
};

export type GroupFocusMyRoomPage = {
  rooms: GroupFocusMyRoomDto[];
};