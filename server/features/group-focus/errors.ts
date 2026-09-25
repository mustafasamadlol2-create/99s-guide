export const GROUP_FOCUS_ERROR_STATUS = {
  FEATURE_DISABLED: 404,
  ROOM_NOT_FOUND: 404,
  NOT_ROOM_MEMBER: 404,
  NOT_ROOM_HOST: 403,
  INVALID_ROOM_MODE: 400,
  INVALID_ROOM_CONFIGURATION: 400,
  INVALID_MEMBER_LECTURE: 400,
  ROOM_CLOSED: 409,
  ROOM_FULL: 409,
  HOST_MUST_CLOSE_ROOM: 409,
  MEMBER_REMOVED: 409,
  MEMBER_NOT_ACTIVE: 409,
  HOST_CANNOT_REMOVE_SELF: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RECONCILIATION_REQUIRED: 409,
} as const;

export type GroupFocusErrorCode = keyof typeof GROUP_FOCUS_ERROR_STATUS;

export class GroupFocusError extends Error {
  readonly status: number;

  constructor(readonly code: GroupFocusErrorCode, message: string) {
    super(message);
    this.name = "GroupFocusError";
    this.status = GROUP_FOCUS_ERROR_STATUS[code];
  }
}