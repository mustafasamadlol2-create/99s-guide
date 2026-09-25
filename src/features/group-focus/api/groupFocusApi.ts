import type {
  GroupFocusCapabilityMode,
  GroupFocusCapabilityRole,
  GroupFocusCapabilityVisibility,
} from "../../../../shared/group-focus-capability/contract.js";
import {
  GROUP_FOCUS_CAPABILITY_MAX_TOKEN_BYTES,
  GROUP_FOCUS_CAPABILITY_MAX_TTL_SECONDS,
} from "../../../../shared/group-focus-capability/contract.js";

export type GroupFocusVisibility = GroupFocusCapabilityVisibility;
export type GroupFocusMode = GroupFocusCapabilityMode;
export type GroupFocusRoomStatus = "OPEN" | "CLOSED";
export type GroupFocusMembershipStatus = "ACTIVE" | "LEFT" | "REMOVED";
export type GroupFocusRole = GroupFocusCapabilityRole;

export type GroupFocusCapabilityResponse = {
  capabilityToken: string;
  expiresAt: string;
  expiresInSeconds: number;
};

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

export type GroupFocusRoomDetail = {
  room: GroupFocusRoomDto;
  membership: GroupFocusMembershipDto | null;
  effectiveLectureId: string | null;
};

export type CreateGroupFocusRoomInput = {
  name: string;
  visibility: GroupFocusVisibility;
  mode: GroupFocusMode;
  sharedLectureId?: string;
  hostLectureId?: string;
  focusDurationSeconds: number;
  breakDurationSeconds: number;
  roundCount: number;
  maxParticipants?: number;
  idempotencyKey: string;
};

export type GroupFocusRoomQuery = {
  limit?: number;
  cursor?: string;
};

export type MyGroupFocusRoomsQuery = {
  limit?: number;
  membershipStatus?: GroupFocusMembershipStatus;
  roomStatus?: GroupFocusRoomStatus;
};

export type GroupFocusApiErrorBody = {
  code?: string;
  error?: string;
};

export class GroupFocusApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GroupFocusApiError";
  }
}

type Fetcher = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Invalid Group Focus ${label} response.`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid Group Focus ${label} response.`);
  }
  return value;
}

function requireNullableString(value: unknown, label: string): string | null {
  return value === null ? null : requireString(value, label);
}

function requireInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`Invalid Group Focus ${label} response.`);
  }
  return value;
}

function requireIsoDate(value: unknown, label: string): string {
  const result = requireString(value, label);
  if (!Number.isFinite(Date.parse(result))) {
    throw new Error(`Invalid Group Focus ${label} response.`);
  }
  return result;
}

function parseCapabilityResponse(value: unknown): GroupFocusCapabilityResponse {
  const result = requireRecord(value, "capability");
  const expectedKeys = ["capabilityToken", "expiresAt", "expiresInSeconds"];
  const actualKeys = Object.keys(result).sort();
  if (
    actualKeys.length !== expectedKeys.length
    || !actualKeys.every((key, index) => key === [...expectedKeys].sort()[index])
  ) {
    throw new Error("Invalid Group Focus capability response.");
  }
  const capabilityToken = requireString(result.capabilityToken, "capability token");
  const expiresAt = requireIsoDate(result.expiresAt, "capability expiration");
  const expiresInSeconds = requireInteger(result.expiresInSeconds, "capability lifetime");
  const expirationMilliseconds = Date.parse(expiresAt);
  if (
    capabilityToken.length > GROUP_FOCUS_CAPABILITY_MAX_TOKEN_BYTES
    || !Number.isFinite(expirationMilliseconds)
    || new Date(expirationMilliseconds).toISOString() !== expiresAt
    || expiresInSeconds < 1
    || expiresInSeconds > GROUP_FOCUS_CAPABILITY_MAX_TTL_SECONDS
  ) {
    throw new Error("Invalid Group Focus capability response.");
  }
  return { capabilityToken, expiresAt, expiresInSeconds };
}

function requireOneOf<T extends string>(
  value: unknown,
  options: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !options.includes(value as T)) {
    throw new Error(`Invalid Group Focus ${label} response.`);
  }
  return value as T;
}

function parseRoom(value: unknown): GroupFocusRoomDto {
  const room = requireRecord(value, "Room");
  if ("inviteTokenHash" in room || "createIdempotencyKey" in room || "inviteToken" in room) {
    throw new Error("Group Focus Room response contains private fields.");
  }
  const sharedLectureId = requireNullableString(room.sharedLectureId, "shared Lecture");
  return {
    id: requireString(room.id, "Room ID"),
    name: requireString(room.name, "Room name"),
    visibility: requireOneOf(room.visibility, ["PUBLIC", "PRIVATE"], "visibility"),
    mode: requireOneOf(room.mode, ["SHARED_LECTURE", "STUDY_TOGETHER"], "mode"),
    sharedLectureId,
    focusDurationSeconds: requireInteger(room.focusDurationSeconds, "focus duration"),
    breakDurationSeconds: requireInteger(room.breakDurationSeconds, "break duration"),
    roundCount: requireInteger(room.roundCount, "round count"),
    maxParticipants: requireInteger(room.maxParticipants, "participant limit"),
    participantCount: requireInteger(room.participantCount, "participant count"),
    status: requireOneOf(room.status, ["OPEN", "CLOSED"], "Room status"),
    createdAt: requireIsoDate(room.createdAt, "createdAt"),
    updatedAt: requireIsoDate(room.updatedAt, "updatedAt"),
    closedAt: room.closedAt === null ? null : requireIsoDate(room.closedAt, "closedAt"),
  };
}

function parseMembership(value: unknown): GroupFocusMembershipDto {
  const membership = requireRecord(value, "membership");
  if ("inviteTokenHash" in membership || "createIdempotencyKey" in membership) {
    throw new Error("Group Focus membership response contains private fields.");
  }
  return {
    membershipId: requireString(membership.membershipId, "membership ID"),
    roomId: requireString(membership.roomId, "membership Room ID"),
    userId: requireString(membership.userId, "membership user ID"),
    role: requireOneOf(membership.role, ["HOST", "MEMBER"], "role"),
    status: requireOneOf(membership.status, ["ACTIVE", "LEFT", "REMOVED"], "membership status"),
    selectedLectureId: requireNullableString(
      membership.selectedLectureId,
      "selected Lecture",
    ),
    joinedAt: requireIsoDate(membership.joinedAt, "membership joinedAt"),
    leftAt: membership.leftAt === null ? null : requireIsoDate(membership.leftAt, "membership leftAt"),
    createdAt: requireIsoDate(membership.createdAt, "membership createdAt"),
    updatedAt: requireIsoDate(membership.updatedAt, "membership updatedAt"),
  };
}

function parseRoomDetail(value: unknown): GroupFocusRoomDetail {
  const detail = requireRecord(value, "Room detail");
  return {
    room: parseRoom(detail.room),
    membership: detail.membership === null ? null : parseMembership(detail.membership),
    effectiveLectureId: requireNullableString(detail.effectiveLectureId, "effective Lecture"),
  };
}

async function requestJson<T>(
  path: string,
  options: RequestInit,
  fetcher: Fetcher,
  parse: (value: unknown) => T,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(path, {
      ...options,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new GroupFocusApiError(0, "NETWORK_ERROR", "Group Focus request could not reach the server.");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GroupFocusApiError(
      response.status,
      "INVALID_RESPONSE",
      "Group Focus returned an invalid response.",
    );
  }

  if (!response.ok) {
    const body = isRecord(payload) ? payload as GroupFocusApiErrorBody : {};
    throw new GroupFocusApiError(
      response.status,
      typeof body.code === "string" ? body.code : "HTTP_ERROR",
      typeof body.error === "string" ? body.error : "Group Focus request failed.",
    );
  }
  try {
    return parse(payload);
  } catch {
    throw new GroupFocusApiError(
      response.status,
      "INVALID_RESPONSE",
      "Group Focus returned an invalid response.",
    );
  }
}

function jsonBody(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

function queryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export async function createGroupFocusRoom(
  input: CreateGroupFocusRoomInput,
  fetcher: Fetcher = fetch,
): Promise<{
  room: GroupFocusRoomDto;
  membership: GroupFocusMembershipDto;
  idempotency: "CREATED" | "REPLAY_SAME_PAYLOAD";
}> {
  return requestJson("/api/group-focus/rooms", jsonBody(input), fetcher, (value) => {
    const result = requireRecord(value, "create");
    const idempotency = requireOneOf(
      result.idempotency,
      ["CREATED", "REPLAY_SAME_PAYLOAD"],
      "idempotency",
    );
    return {
      room: parseRoom(result.room),
      membership: parseMembership(result.membership),
      idempotency,
    };
  });
}

export async function listPublicGroupFocusRooms(
  query: GroupFocusRoomQuery = {},
  fetcher: Fetcher = fetch,
): Promise<{ rooms: GroupFocusRoomDto[]; nextCursor: string | null }> {
  const path = `/api/group-focus/rooms/public${queryString(query)}`;
  return requestJson(path, { method: "GET" }, fetcher, (value) => {
    const page = requireRecord(value, "public Room list");
    if (!Array.isArray(page.rooms)) throw new Error("Invalid Group Focus Room list.");
    return {
      rooms: page.rooms.map(parseRoom),
      nextCursor: requireNullableString(page.nextCursor, "next cursor"),
    };
  });
}

export async function listMyGroupFocusRooms(
  query: MyGroupFocusRoomsQuery = {},
  fetcher: Fetcher = fetch,
): Promise<{ rooms: GroupFocusMyRoomDto[] }> {
  const path = `/api/group-focus/rooms/mine${queryString(query)}`;
  return requestJson(path, { method: "GET" }, fetcher, (value) => {
    const page = requireRecord(value, "my Room list");
    if (!Array.isArray(page.rooms)) throw new Error("Invalid Group Focus Room list.");
    return {
      rooms: page.rooms.map((raw) => {
        const entry = requireRecord(raw, "my Room");
        return {
          room: parseRoom(entry.room),
          membership: parseMembership(entry.membership),
          effectiveLectureId: requireNullableString(
            entry.effectiveLectureId,
            "effective Lecture",
          ),
        };
      }),
    };
  });
}

export async function getGroupFocusRoom(
  roomId: string,
  fetcher: Fetcher = fetch,
): Promise<GroupFocusRoomDetail> {
  return requestJson(
    `/api/group-focus/rooms/${encodeURIComponent(roomId)}`,
    { method: "GET" },
    fetcher,
    parseRoomDetail,
  );
}

export async function listGroupFocusMembers(
  roomId: string,
  fetcher: Fetcher = fetch,
): Promise<{ members: GroupFocusMembershipDto[] }> {
  return requestJson(
    `/api/group-focus/rooms/${encodeURIComponent(roomId)}/members`,
    { method: "GET" },
    fetcher,
    (value) => {
      const result = requireRecord(value, "member list");
      if (!Array.isArray(result.members)) throw new Error("Invalid Group Focus member list.");
      return { members: result.members.map(parseMembership) };
    },
  );
}

export async function rotateGroupFocusInvite(
  roomId: string,
  fetcher: Fetcher = fetch,
): Promise<{ inviteToken: string; inviteVersion: number }> {
  return requestJson(
    `/api/group-focus/rooms/${encodeURIComponent(roomId)}/invite/rotate`,
    jsonBody({}),
    fetcher,
    (value) => {
      const invite = requireRecord(value, "invite");
      return {
        inviteToken: requireString(invite.inviteToken, "invite token"),
        inviteVersion: requireInteger(invite.inviteVersion, "invite version"),
      };
    },
  );
}

export async function joinGroupFocusRoom(
  roomId: string,
  input: { inviteToken?: string; lectureId?: string } = {},
  fetcher: Fetcher = fetch,
): Promise<{ room: GroupFocusRoomDto; membership: GroupFocusMembershipDto }> {
  return requestJson(
    `/api/group-focus/rooms/${encodeURIComponent(roomId)}/join`,
    jsonBody(input),
    fetcher,
    (value) => {
      const result = requireRecord(value, "join");
      return {
        room: parseRoom(result.room),
        membership: parseMembership(result.membership),
      };
    },
  );
}

export async function leaveGroupFocusRoom(
  roomId: string,
  fetcher: Fetcher = fetch,
): Promise<{ membership: GroupFocusMembershipDto }> {
  return requestJson(
    `/api/group-focus/rooms/${encodeURIComponent(roomId)}/leave`,
    jsonBody({}),
    fetcher,
    (value) => {
      const result = requireRecord(value, "leave");
      return { membership: parseMembership(result.membership) };
    },
  );
}

export async function removeGroupFocusMember(
  roomId: string,
  userId: string,
  fetcher: Fetcher = fetch,
): Promise<{ membership: GroupFocusMembershipDto }> {
  return requestJson(
    `/api/group-focus/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}/remove`,
    jsonBody({}),
    fetcher,
    (value) => {
      const result = requireRecord(value, "member removal");
      return { membership: parseMembership(result.membership) };
    },
  );
}

export async function updateMyGroupFocusLecture(
  roomId: string,
  lectureId: string,
  fetcher: Fetcher = fetch,
): Promise<{ membership: GroupFocusMembershipDto; effectiveLectureId: string }> {
  return requestJson(
    `/api/group-focus/rooms/${encodeURIComponent(roomId)}/me/lecture`,
    { method: "PATCH", body: JSON.stringify({ lectureId }) },
    fetcher,
    (value) => {
      const result = requireRecord(value, "Lecture update");
      return {
        membership: parseMembership(result.membership),
        effectiveLectureId: requireString(result.effectiveLectureId, "effective Lecture"),
      };
    },
  );
}

export async function closeGroupFocusRoom(
  roomId: string,
  fetcher: Fetcher = fetch,
): Promise<{ room: GroupFocusRoomDto; membershipsClosed: number }> {
  return requestJson(
    `/api/group-focus/rooms/${encodeURIComponent(roomId)}/close`,
    jsonBody({}),
    fetcher,
    (value) => {
      const result = requireRecord(value, "close");
      return {
        room: parseRoom(result.room),
        membershipsClosed: requireInteger(result.membershipsClosed, "closed membership count"),
      };
    },
  );
}

export async function requestGroupFocusCapability(
  roomId: string,
  fetcher: Fetcher = fetch,
): Promise<GroupFocusCapabilityResponse> {
  return requestJson(
    `/api/group-focus/rooms/${encodeURIComponent(roomId)}/capability`,
    { method: "POST" },
    fetcher,
    parseCapabilityResponse,
  );
}
