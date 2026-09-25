import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { isStudyFeatureEnabled } from "../study-core/featureFlags.js";
import {
  GROUP_FOCUS_MODES,
  GROUP_FOCUS_PARTICIPANT_ROLES,
} from "../study-core/groupFocus.js";
import { GroupFocusError } from "./errors.js";
import {
  createGroupFocusRoomSchema,
  joinGroupFocusRoomSchema,
  myGroupFocusRoomsQuerySchema,
  publicGroupFocusRoomsQuerySchema,
  updateGroupFocusLectureSchema,
  type CreateGroupFocusRoomInput,
  type JoinGroupFocusRoomInput,
  type MyGroupFocusRoomsQuery,
  type PublicGroupFocusRoomsQuery,
} from "./schemas.js";
import {
  GROUP_FOCUS_INVITE_TOKEN_BYTES,
  GROUP_FOCUS_MEMBERSHIP_STATUSES,
  GROUP_FOCUS_ROOM_STATUSES,
  GROUP_FOCUS_VISIBILITIES,
  type GroupFocusAuthorizationContext,
  type GroupFocusIdempotency,
  type GroupFocusMembershipDto,
  type GroupFocusMembershipStatus,
  type GroupFocusMode,
  type GroupFocusMyRoomDto,
  type GroupFocusMyRoomPage,
  type GroupFocusRole,
  type GroupFocusRoomDto,
  type GroupFocusRoomPage,
  type GroupFocusRoomStatus,
  type GroupFocusVisibility,
} from "./types.js";

type GroupFocusTransaction = Prisma.TransactionClient;

type RoomRecord = {
  id: string;
  hostUserId: string;
  name: string;
  visibility: string;
  mode: string;
  sharedLectureId: string | null;
  focusDurationSeconds: number;
  breakDurationSeconds: number;
  roundCount: number;
  maxParticipants: number;
  status: string;
  createIdempotencyKey: string;
  inviteTokenHash: string | null;
  inviteVersion: number;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
};

type MembershipRecord = {
  id: string;
  roomId: string;
  userId: string;
  role: string;
  status: string;
  selectedLectureId: string | null;
  joinedAt: Date;
  leftAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateGroupFocusRoomResult = {
  room: GroupFocusRoomDto;
  membership: GroupFocusMembershipDto;
  idempotency: GroupFocusIdempotency;
};

export type GroupFocusRoomDetail = {
  room: GroupFocusRoomDto;
  membership: GroupFocusMembershipDto | null;
  effectiveLectureId: string | null;
};

export type JoinGroupFocusRoomResult = {
  room: GroupFocusRoomDto;
  membership: GroupFocusMembershipDto;
};

export type GroupFocusCloseResult = {
  room: GroupFocusRoomDto;
  membershipsClosed: number;
};

export type GroupFocusLectureUpdateResult = {
  membership: GroupFocusMembershipDto;
  effectiveLectureId: string;
};

export interface GroupFocusService {
  createRoom(
    userId: string,
    input: CreateGroupFocusRoomInput,
  ): Promise<CreateGroupFocusRoomResult>;
  listPublicRooms(query: PublicGroupFocusRoomsQuery): Promise<GroupFocusRoomPage>;
  listMyRooms(
    userId: string,
    query: MyGroupFocusRoomsQuery,
  ): Promise<GroupFocusMyRoomPage>;
  getRoomDetail(userId: string, roomId: string): Promise<GroupFocusRoomDetail>;
  listRoomMembers(userId: string, roomId: string): Promise<GroupFocusMembershipDto[]>;
  joinRoom(
    userId: string,
    roomId: string,
    input: JoinGroupFocusRoomInput,
  ): Promise<JoinGroupFocusRoomResult>;
  leaveRoom(userId: string, roomId: string): Promise<GroupFocusMembershipDto>;
  removeMember(
    userId: string,
    roomId: string,
    targetUserId: string,
  ): Promise<GroupFocusMembershipDto>;
  closeRoom(userId: string, roomId: string): Promise<GroupFocusCloseResult>;
  rotateInvite(
    userId: string,
    roomId: string,
  ): Promise<{ inviteToken: string; inviteVersion: number }>;
  updateMyLecture(
    userId: string,
    roomId: string,
    lectureId: string,
  ): Promise<GroupFocusLectureUpdateResult>;
  getGroupFocusAuthorizationContext(
    userId: string,
    roomId: string,
  ): Promise<GroupFocusAuthorizationContext | null>;
}

export type GroupFocusServiceOptions = {
  prisma?: PrismaClient;
  now?: () => Date;
  isEnabled?: () => boolean;
};

function isKnown<T extends readonly string[]>(
  choices: T,
  value: string,
): value is T[number] {
  return choices.includes(value);
}

function requireRoomStatus(value: string): GroupFocusRoomStatus {
  if (isKnown(GROUP_FOCUS_ROOM_STATUSES, value)) return value;
  throw new GroupFocusError(
    "RECONCILIATION_REQUIRED",
    "The stored Group Focus Room status is invalid.",
  );
}

function requireMembershipStatus(value: string): GroupFocusMembershipStatus {
  if (isKnown(GROUP_FOCUS_MEMBERSHIP_STATUSES, value)) return value;
  throw new GroupFocusError(
    "RECONCILIATION_REQUIRED",
    "The stored Group Focus membership status is invalid.",
  );
}

function requireRole(value: string): GroupFocusRole {
  if (isKnown(GROUP_FOCUS_PARTICIPANT_ROLES, value)) return value;
  throw new GroupFocusError(
    "RECONCILIATION_REQUIRED",
    "The stored Group Focus membership role is invalid.",
  );
}

function requireMode(value: string): GroupFocusMode {
  if (isKnown(GROUP_FOCUS_MODES, value)) return value;
  throw new GroupFocusError(
    "RECONCILIATION_REQUIRED",
    "The stored Group Focus Room mode is invalid.",
  );
}

function requireVisibility(value: string): GroupFocusVisibility {
  if (isKnown(GROUP_FOCUS_VISIBILITIES, value)) return value;
  throw new GroupFocusError(
    "RECONCILIATION_REQUIRED",
    "The stored Group Focus Room visibility is invalid.",
  );
}

function iso(value: Date | null): string | null {
  if (value === null) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new GroupFocusError(
      "RECONCILIATION_REQUIRED",
      "Stored Group Focus timestamps are invalid.",
    );
  }
  return value.toISOString();
}

function toRoomDto(room: RoomRecord, participantCount: number): GroupFocusRoomDto {
  const createdAt = iso(room.createdAt);
  const updatedAt = iso(room.updatedAt);
  if (!createdAt || !updatedAt) {
    throw new GroupFocusError(
      "RECONCILIATION_REQUIRED",
      "Stored Group Focus Room timestamps are invalid.",
    );
  }
  return {
    id: room.id,
    name: room.name,
    visibility: requireVisibility(room.visibility),
    mode: requireMode(room.mode),
    sharedLectureId: room.sharedLectureId,
    focusDurationSeconds: room.focusDurationSeconds,
    breakDurationSeconds: room.breakDurationSeconds,
    roundCount: room.roundCount,
    maxParticipants: room.maxParticipants,
    participantCount,
    status: requireRoomStatus(room.status),
    createdAt,
    updatedAt,
    closedAt: iso(room.closedAt),
  };
}

function toMembershipDto(membership: MembershipRecord): GroupFocusMembershipDto {
  const joinedAt = iso(membership.joinedAt);
  const createdAt = iso(membership.createdAt);
  const updatedAt = iso(membership.updatedAt);
  if (!joinedAt || !createdAt || !updatedAt) {
    throw new GroupFocusError(
      "RECONCILIATION_REQUIRED",
      "Stored Group Focus membership timestamps are invalid.",
    );
  }
  return {
    membershipId: membership.id,
    roomId: membership.roomId,
    userId: membership.userId,
    role: requireRole(membership.role),
    status: requireMembershipStatus(membership.status),
    selectedLectureId: membership.selectedLectureId,
    joinedAt,
    leftAt: iso(membership.leftAt),
    createdAt,
    updatedAt,
  };
}

function effectiveLecture(
  room: RoomRecord,
  membership: MembershipRecord,
): string | null {
  const mode = requireMode(room.mode);
  if (mode === "SHARED_LECTURE") return room.sharedLectureId;
  return membership.selectedLectureId;
}

function sameCreatePayload(
  room: RoomRecord,
  hostMembership: MembershipRecord,
  input: CreateGroupFocusRoomInput,
): boolean {
  return room.name === input.name
    && room.visibility === input.visibility
    && room.mode === input.mode
    && room.sharedLectureId === (input.mode === "SHARED_LECTURE" ? input.sharedLectureId : null)
    && hostMembership.selectedLectureId === (
      input.mode === "STUDY_TOGETHER" ? input.hostLectureId ?? null : null
    )
    && room.focusDurationSeconds === input.focusDurationSeconds
    && room.breakDurationSeconds === input.breakDurationSeconds
    && room.roundCount === input.roundCount
    && room.maxParticipants === input.maxParticipants;
}

function inviteDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function inviteMatches(token: string, storedHash: string | null): boolean {
  if (!storedHash || !/^[a-f0-9]{64}$/u.test(storedHash)) return false;
  const expected = Buffer.from(storedHash, "hex");
  const candidate = Buffer.from(inviteDigest(token), "hex");
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

function parseCreateInput(input: CreateGroupFocusRoomInput): CreateGroupFocusRoomInput {
  const parsed = createGroupFocusRoomSchema.safeParse(input);
  if (!parsed.success) {
    throw new GroupFocusError(
      "INVALID_ROOM_CONFIGURATION",
      "Group Focus Room configuration is invalid.",
    );
  }
  return parsed.data;
}

function parseJoinInput(input: JoinGroupFocusRoomInput): JoinGroupFocusRoomInput {
  const parsed = joinGroupFocusRoomSchema.safeParse(input);
  if (!parsed.success) {
    throw new GroupFocusError("INVALID_MEMBER_LECTURE", "Group Focus join details are invalid.");
  }
  return parsed.data;
}

function parseLectureId(lectureId: string): string {
  const parsed = updateGroupFocusLectureSchema.safeParse({ lectureId });
  if (!parsed.success) {
    throw new GroupFocusError("INVALID_MEMBER_LECTURE", "A valid canonical Lecture is required.");
  }
  return parsed.data.lectureId;
}

function parsePublicQuery(query: PublicGroupFocusRoomsQuery): PublicGroupFocusRoomsQuery {
  const parsed = publicGroupFocusRoomsQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new GroupFocusError("INVALID_ROOM_CONFIGURATION", "Public Room query is invalid.");
  }
  return parsed.data;
}

function parseMyQuery(query: MyGroupFocusRoomsQuery): MyGroupFocusRoomsQuery {
  const parsed = myGroupFocusRoomsQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new GroupFocusError("INVALID_ROOM_CONFIGURATION", "My Rooms query is invalid.");
  }
  return parsed.data;
}

function parseTimestamp(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Group Focus clock returned an invalid date.");
  }
  return value;
}

export function createGroupFocusService(
  options: GroupFocusServiceOptions = {},
): GroupFocusService {
  const prisma = options.prisma ?? getPrisma();
  const now = options.now ?? (() => new Date());
  const isEnabled = options.isEnabled
    ?? (() => isStudyFeatureEnabled("GROUP_FOCUS_ENABLED"));

  function ensureEnabled(): void {
    if (!isEnabled()) {
      throw new GroupFocusError("FEATURE_DISABLED", "Group Focus is not available.");
    }
  }

  async function lockKey(tx: GroupFocusTransaction, key: string): Promise<void> {
    await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT TRUE AS locked
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))) AS acquired
    `;
  }

  async function requireLecture(
    tx: GroupFocusTransaction,
    lectureId: string,
  ): Promise<void> {
    const lecture = await tx.lecture.findUnique({
      where: { id: lectureId },
      select: { id: true },
    });
    if (!lecture) {
      throw new GroupFocusError(
        "INVALID_MEMBER_LECTURE",
        "The selected Lecture does not exist.",
      );
    }
  }

  async function countActiveMembers(
    tx: GroupFocusTransaction,
    roomId: string,
  ): Promise<number> {
    return tx.groupFocusMembership.count({
      where: { roomId, status: "ACTIVE" },
    });
  }

  async function participantCounts(
    roomIds: string[],
  ): Promise<Map<string, number>> {
    if (roomIds.length === 0) return new Map();
    const rows: Array<{ roomId: string; _count: { _all: number } }> =
      await prisma.groupFocusMembership.groupBy({
      by: ["roomId"],
      where: { roomId: { in: roomIds }, status: "ACTIVE" },
      _count: { _all: true },
    });
    return new Map<string, number>(
      rows.map((row): [string, number] => [row.roomId, row._count._all]),
    );
  }

  async function roomOrThrow(
    tx: GroupFocusTransaction,
    roomId: string,
  ): Promise<RoomRecord> {
    const room = await tx.groupFocusRoom.findUnique({ where: { id: roomId } });
    if (!room) throw new GroupFocusError("ROOM_NOT_FOUND", "Group Focus Room was not found.");
    return room;
  }

  async function requireHost(
    tx: GroupFocusTransaction,
    room: RoomRecord,
    userId: string,
  ): Promise<void> {
    if (room.hostUserId !== userId) {
      if (room.visibility === "PRIVATE") {
        throw new GroupFocusError("ROOM_NOT_FOUND", "Group Focus Room was not found.");
      }
      throw new GroupFocusError("NOT_ROOM_HOST", "Only the Room Host can perform this action.");
    }
    const membership = await tx.groupFocusMembership.findUnique({
      where: { roomId_userId: { roomId: room.id, userId } },
    });
    if (!membership || membership.role !== "HOST") {
      throw new GroupFocusError(
        "RECONCILIATION_REQUIRED",
        "The canonical Host membership is missing.",
      );
    }
    if (
      requireRoomStatus(room.status) === "OPEN"
      && requireMembershipStatus(membership.status) !== "ACTIVE"
    ) {
      throw new GroupFocusError(
        "RECONCILIATION_REQUIRED",
        "The open Room Host membership is not active.",
      );
    }
  }

  async function roomPageDtos(
    rows: RoomRecord[],
  ): Promise<GroupFocusRoomDto[]> {
    const counts = await participantCounts(rows.map((room) => room.id));
    return rows.map((room) => toRoomDto(room, counts.get(room.id) ?? 0));
  }

  return {
    async createRoom(userId, rawInput) {
      ensureEnabled();
      const input = parseCreateInput(rawInput);
      const lectureId = input.mode === "SHARED_LECTURE"
        ? input.sharedLectureId
        : input.hostLectureId;
      if (!lectureId) {
        throw new GroupFocusError(
          "INVALID_ROOM_MODE",
          "A canonical Lecture is required for this Room mode.",
        );
      }

      return prisma.$transaction(async (tx: GroupFocusTransaction) => {
        await lockKey(tx, `group-focus:create:${userId}:${input.idempotencyKey}`);
        const existing = await tx.groupFocusRoom.findFirst({
          where: {
            hostUserId: userId,
            createIdempotencyKey: input.idempotencyKey,
          },
        });
        if (existing) {
          const hostMembership = await tx.groupFocusMembership.findUnique({
            where: { roomId_userId: { roomId: existing.id, userId } },
          });
          if (!hostMembership || hostMembership.role !== "HOST") {
            throw new GroupFocusError(
              "RECONCILIATION_REQUIRED",
              "The canonical Host membership is missing.",
            );
          }
          if (!sameCreatePayload(existing, hostMembership, input)) {
            throw new GroupFocusError(
              "IDEMPOTENCY_CONFLICT",
              "The idempotency key was already used with different Room settings.",
            );
          }
          return {
            room: toRoomDto(existing, await countActiveMembers(tx, existing.id)),
            membership: toMembershipDto(hostMembership),
            idempotency: "REPLAY_SAME_PAYLOAD" as const,
          };
        }

        await requireLecture(tx, lectureId);
        const createdAt = parseTimestamp(now);
        const room = await tx.groupFocusRoom.create({
          data: {
            hostUserId: userId,
            name: input.name,
            visibility: input.visibility,
            mode: input.mode,
            sharedLectureId: input.mode === "SHARED_LECTURE"
              ? input.sharedLectureId ?? null
              : null,
            focusDurationSeconds: input.focusDurationSeconds,
            breakDurationSeconds: input.breakDurationSeconds,
            roundCount: input.roundCount,
            maxParticipants: input.maxParticipants,
            status: "OPEN",
            createIdempotencyKey: input.idempotencyKey,
          },
        });
        const membership = await tx.groupFocusMembership.create({
          data: {
            roomId: room.id,
            userId,
            role: "HOST",
            status: "ACTIVE",
            selectedLectureId: input.mode === "STUDY_TOGETHER"
              ? input.hostLectureId ?? null
              : null,
            joinedAt: createdAt,
          },
        });
        return {
          room: toRoomDto(room, 1),
          membership: toMembershipDto(membership),
          idempotency: "CREATED" as const,
        };
      }, { maxWait: 5_000, timeout: 15_000 });
    },

    async listPublicRooms(rawQuery) {
      ensureEnabled();
      const query = parsePublicQuery(rawQuery);
      const where = { visibility: "PUBLIC", status: "OPEN" };
      if (query.cursor) {
        const cursor = await prisma.groupFocusRoom.findFirst({
          where: { ...where, id: query.cursor },
          select: { id: true },
        });
        if (!cursor) {
          throw new GroupFocusError("INVALID_ROOM_CONFIGURATION", "Room cursor is invalid.");
        }
      }
      const fetched = await prisma.groupFocusRoom.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const hasMore = fetched.length > query.limit;
      const page = hasMore ? fetched.slice(0, query.limit) : fetched;
      return {
        rooms: await roomPageDtos(page),
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
      };
    },

    async listMyRooms(userId, rawQuery) {
      ensureEnabled();
      const query = parseMyQuery(rawQuery);
      const where: Prisma.GroupFocusMembershipWhereInput = {
        userId,
        ...(query.membershipStatus ? { status: query.membershipStatus } : {}),
        ...(query.roomStatus ? { room: { status: query.roomStatus } } : {}),
      };
      const rows: Array<MembershipRecord & { room: RoomRecord }> =
        await prisma.groupFocusMembership.findMany({
        where,
        include: { room: true },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: query.limit,
      });
      const counts = await participantCounts(
        rows.map((row: MembershipRecord & { room: RoomRecord }) => row.roomId),
      );
      return {
        rooms: rows.map((row: MembershipRecord & { room: RoomRecord }) => ({
          room: toRoomDto(row.room, counts.get(row.roomId) ?? 0),
          membership: toMembershipDto(row),
          effectiveLectureId: effectiveLecture(row.room, row),
        })),
      };
    },

    async getRoomDetail(userId, roomId) {
      ensureEnabled();
      const room = await prisma.groupFocusRoom.findUnique({ where: { id: roomId } });
      if (!room) throw new GroupFocusError("ROOM_NOT_FOUND", "Group Focus Room was not found.");
      const membership = await prisma.groupFocusMembership.findUnique({
        where: { roomId_userId: { roomId, userId } },
      });
      const status = requireRoomStatus(room.status);
      if (status === "OPEN" && room.visibility === "PRIVATE"
        && membership?.status !== "ACTIVE") {
        throw new GroupFocusError("ROOM_NOT_FOUND", "Group Focus Room was not found.");
      }
      if (status === "CLOSED" && !membership) {
        throw new GroupFocusError("ROOM_NOT_FOUND", "Group Focus Room was not found.");
      }
      const participantCount = await prisma.groupFocusMembership.count({
        where: { roomId, status: "ACTIVE" },
      });
      return {
        room: toRoomDto(room, participantCount),
        membership: membership ? toMembershipDto(membership) : null,
        effectiveLectureId: membership ? effectiveLecture(room, membership) : null,
      };
    },

    async listRoomMembers(userId, roomId) {
      ensureEnabled();
      const room = await prisma.groupFocusRoom.findUnique({
        where: { id: roomId },
        select: { id: true, visibility: true },
      });
      if (!room) throw new GroupFocusError("ROOM_NOT_FOUND", "Group Focus Room was not found.");
      const requester = await prisma.groupFocusMembership.findUnique({
        where: { roomId_userId: { roomId, userId } },
        select: { status: true },
      });
      if (requester?.status !== "ACTIVE") {
        if (room.visibility === "PRIVATE") {
          throw new GroupFocusError("ROOM_NOT_FOUND", "Group Focus Room was not found.");
        }
        throw new GroupFocusError("NOT_ROOM_MEMBER", "Active Room membership is required.");
      }
      const members = await prisma.groupFocusMembership.findMany({
        where: { roomId, status: "ACTIVE" },
        orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
      });
      return members.map(toMembershipDto);
    },

    async joinRoom(userId, roomId, rawInput) {
      ensureEnabled();
      const input = parseJoinInput(rawInput);
      return prisma.$transaction(async (tx: GroupFocusTransaction) => {
        await lockKey(tx, `group-focus:room:${roomId}`);
        const room = await roomOrThrow(tx, roomId);
        const roomStatus = requireRoomStatus(room.status);
        const existing = await tx.groupFocusMembership.findUnique({
          where: { roomId_userId: { roomId, userId } },
        });
        if (roomStatus === "CLOSED") {
          if (room.visibility === "PRIVATE" && !existing) {
            throw new GroupFocusError("ROOM_NOT_FOUND", "Group Focus Room was not found.");
          }
          throw new GroupFocusError("ROOM_CLOSED", "This Group Focus Room is closed.");
        }
        if (existing) {
          requireMembershipStatus(existing.status);
          requireRole(existing.role);
          if ((existing.role === "HOST") !== (room.hostUserId === userId)) {
            throw new GroupFocusError(
              "RECONCILIATION_REQUIRED",
              "The stored Host and membership roles do not match.",
            );
          }
        }
        if (existing?.status === "REMOVED") {
          throw new GroupFocusError("MEMBER_REMOVED", "This membership was removed by the Host.");
        }
        if (existing?.status === "ACTIVE") {
          const mode = requireMode(room.mode);
          if (mode === "SHARED_LECTURE") {
            if (!room.sharedLectureId) {
              throw new GroupFocusError(
                "RECONCILIATION_REQUIRED",
                "The shared Lecture is missing from this Room.",
              );
            }
            if (input.lectureId && input.lectureId !== room.sharedLectureId) {
              throw new GroupFocusError(
                "INVALID_MEMBER_LECTURE",
                "A SHARED_LECTURE Room does not allow a different Lecture.",
              );
            }
            if (existing.selectedLectureId !== null) {
              throw new GroupFocusError(
                "RECONCILIATION_REQUIRED",
                "A SHARED_LECTURE membership cannot select a separate Lecture.",
              );
            }
          } else if (existing.selectedLectureId === null) {
            throw new GroupFocusError(
              "RECONCILIATION_REQUIRED",
              "The STUDY_TOGETHER membership has no selected Lecture.",
            );
          } else if (input.lectureId && input.lectureId !== existing.selectedLectureId) {
            throw new GroupFocusError(
              "INVALID_MEMBER_LECTURE",
              "Use the member Lecture update route to change an active selection.",
            );
          }
          return {
            room: toRoomDto(room, await countActiveMembers(tx, roomId)),
            membership: toMembershipDto(existing),
          };
        }

        if (room.visibility === "PRIVATE") {
          if (!room.inviteTokenHash
            || !input.inviteToken
            || !inviteMatches(input.inviteToken, room.inviteTokenHash)) {
            throw new GroupFocusError("ROOM_NOT_FOUND", "Group Focus Room was not found.");
          }
        }

        const mode = requireMode(room.mode);
        let selectedLectureId: string | null = null;
        if (mode === "SHARED_LECTURE") {
          if (!room.sharedLectureId) {
            throw new GroupFocusError(
              "RECONCILIATION_REQUIRED",
              "The shared Lecture is missing from this Room.",
            );
          }
          if (input.lectureId && input.lectureId !== room.sharedLectureId) {
            throw new GroupFocusError(
              "INVALID_MEMBER_LECTURE",
              "A SHARED_LECTURE Room does not allow a different Lecture.",
            );
          }
        } else {
          if (!input.lectureId) {
            throw new GroupFocusError(
              "INVALID_MEMBER_LECTURE",
              "Choose a canonical Lecture before joining this Room.",
            );
          }
          await requireLecture(tx, input.lectureId);
          selectedLectureId = input.lectureId;
        }

        if (await countActiveMembers(tx, roomId) >= room.maxParticipants) {
          throw new GroupFocusError("ROOM_FULL", "This Group Focus Room is full.");
        }
        const joinedAt = parseTimestamp(now);
        const membership = existing
          ? await tx.groupFocusMembership.update({
            where: { id: existing.id },
            data: {
              status: "ACTIVE",
              joinedAt,
              leftAt: null,
              selectedLectureId,
            },
          })
          : await tx.groupFocusMembership.create({
            data: {
              roomId,
              userId,
              role: "MEMBER",
              status: "ACTIVE",
              selectedLectureId,
              joinedAt,
            },
          });
        return {
          room: toRoomDto(room, await countActiveMembers(tx, roomId)),
          membership: toMembershipDto(membership),
        };
      }, { maxWait: 5_000, timeout: 15_000 });
    },

    async leaveRoom(userId, roomId) {
      ensureEnabled();
      return prisma.$transaction(async (tx: GroupFocusTransaction) => {
        await lockKey(tx, `group-focus:room:${roomId}`);
        const room = await roomOrThrow(tx, roomId);
        const membership = await tx.groupFocusMembership.findUnique({
          where: { roomId_userId: { roomId, userId } },
        });
        if (!membership) {
          throw new GroupFocusError("ROOM_NOT_FOUND", "Group Focus Room was not found.");
        }
        if (membership.role === "HOST") {
          throw new GroupFocusError(
            "HOST_MUST_CLOSE_ROOM",
            "The Host must close the Room instead of leaving it.",
          );
        }
        if (membership.status === "REMOVED") {
          throw new GroupFocusError("MEMBER_REMOVED", "This membership was removed by the Host.");
        }
        if (membership.status === "LEFT") return toMembershipDto(membership);
        if (requireRoomStatus(room.status) !== "OPEN") {
          throw new GroupFocusError("ROOM_CLOSED", "This Group Focus Room is closed.");
        }
        const leftAt = parseTimestamp(now);
        const updated = await tx.groupFocusMembership.update({
          where: { id: membership.id },
          data: { status: "LEFT", leftAt },
        });
        return toMembershipDto(updated);
      }, { maxWait: 5_000, timeout: 15_000 });
    },

    async removeMember(userId, roomId, targetUserId) {
      ensureEnabled();
      return prisma.$transaction(async (tx: GroupFocusTransaction) => {
        await lockKey(tx, `group-focus:room:${roomId}`);
        const room = await roomOrThrow(tx, roomId);
        await requireHost(tx, room, userId);
        if (requireRoomStatus(room.status) !== "OPEN") {
          throw new GroupFocusError("ROOM_CLOSED", "This Group Focus Room is closed.");
        }
        if (targetUserId === room.hostUserId) {
          throw new GroupFocusError(
            "HOST_CANNOT_REMOVE_SELF",
            "The Host cannot remove their own membership.",
          );
        }
        const target = await tx.groupFocusMembership.findUnique({
          where: { roomId_userId: { roomId, userId: targetUserId } },
        });
        if (!target || target.role !== "MEMBER") {
          throw new GroupFocusError("NOT_ROOM_MEMBER", "Active Room member was not found.");
        }
        if (target.status !== "ACTIVE") {
          throw new GroupFocusError("MEMBER_NOT_ACTIVE", "Only an active Room member can be removed.");
        }
        const removedAt = parseTimestamp(now);
        const updated = await tx.groupFocusMembership.update({
          where: { id: target.id },
          data: { status: "REMOVED", leftAt: removedAt },
        });
        return toMembershipDto(updated);
      }, { maxWait: 5_000, timeout: 15_000 });
    },

    async closeRoom(userId, roomId) {
      ensureEnabled();
      return prisma.$transaction(async (tx: GroupFocusTransaction) => {
        await lockKey(tx, `group-focus:room:${roomId}`);
        const room = await roomOrThrow(tx, roomId);
        await requireHost(tx, room, userId);
        if (requireRoomStatus(room.status) === "CLOSED") {
          return {
            room: toRoomDto(room, await countActiveMembers(tx, roomId)),
            membershipsClosed: 0,
          };
        }
        const closedAt = parseTimestamp(now);
        const updatedRoom = await tx.groupFocusRoom.update({
          where: { id: roomId },
          data: {
            status: "CLOSED",
            closedAt,
            ...(room.visibility === "PRIVATE"
              ? {
                inviteTokenHash: null,
                inviteVersion: { increment: 1 },
              }
              : {}),
          },
        });
        const changed = await tx.groupFocusMembership.updateMany({
          where: { roomId, status: "ACTIVE" },
          data: { status: "LEFT", leftAt: closedAt },
        });
        return {
          room: toRoomDto(updatedRoom, 0),
          membershipsClosed: changed.count,
        };
      }, { maxWait: 5_000, timeout: 15_000 });
    },

    async rotateInvite(userId, roomId) {
      ensureEnabled();
      return prisma.$transaction(async (tx: GroupFocusTransaction) => {
        await lockKey(tx, `group-focus:room:${roomId}`);
        const room = await roomOrThrow(tx, roomId);
        await requireHost(tx, room, userId);
        if (requireRoomStatus(room.status) !== "OPEN") {
          throw new GroupFocusError("ROOM_CLOSED", "This Group Focus Room is closed.");
        }
        if (requireVisibility(room.visibility) !== "PRIVATE") {
          throw new GroupFocusError(
            "INVALID_ROOM_CONFIGURATION",
            "Invitations are only available for private Rooms.",
          );
        }
        const inviteToken = randomBytes(GROUP_FOCUS_INVITE_TOKEN_BYTES).toString("base64url");
        const updated = await tx.groupFocusRoom.update({
          where: { id: roomId },
          data: {
            inviteTokenHash: inviteDigest(inviteToken),
            inviteVersion: { increment: 1 },
          },
          select: { inviteVersion: true },
        });
        return { inviteToken, inviteVersion: updated.inviteVersion };
      }, { maxWait: 5_000, timeout: 15_000 });
    },

    async updateMyLecture(userId, roomId, rawLectureId) {
      ensureEnabled();
      const lectureId = parseLectureId(rawLectureId);
      return prisma.$transaction(async (tx: GroupFocusTransaction) => {
        await lockKey(tx, `group-focus:room:${roomId}`);
        const room = await roomOrThrow(tx, roomId);
        if (requireRoomStatus(room.status) !== "OPEN") {
          throw new GroupFocusError("ROOM_CLOSED", "This Group Focus Room is closed.");
        }
        if (requireMode(room.mode) !== "STUDY_TOGETHER") {
          throw new GroupFocusError(
            "INVALID_ROOM_MODE",
            "Selected Lectures can only be changed in STUDY_TOGETHER rooms.",
          );
        }
        const membership = await tx.groupFocusMembership.findUnique({
          where: { roomId_userId: { roomId, userId } },
        });
        if (!membership || membership.status !== "ACTIVE") {
          throw new GroupFocusError("NOT_ROOM_MEMBER", "Active Room membership is required.");
        }
        await requireLecture(tx, lectureId);
        const updated = await tx.groupFocusMembership.update({
          where: { id: membership.id },
          data: { selectedLectureId: lectureId },
        });
        const effectiveLectureId = effectiveLecture(room, updated);
        if (!effectiveLectureId) {
          throw new GroupFocusError(
            "RECONCILIATION_REQUIRED",
            "The Group Focus membership has no effective Lecture.",
          );
        }
        return {
          membership: toMembershipDto(updated),
          effectiveLectureId,
        };
      }, { maxWait: 5_000, timeout: 15_000 });
    },

    async getGroupFocusAuthorizationContext(userId, roomId) {
      if (!isEnabled()) return null;
      const [room, membership] = await Promise.all([
        prisma.groupFocusRoom.findUnique({ where: { id: roomId } }),
        prisma.groupFocusMembership.findUnique({
          where: { roomId_userId: { roomId, userId } },
        }),
      ]);
      if (!room || !membership) return null;
      if (room.status !== "OPEN" || membership.status !== "ACTIVE") return null;
      const canonicalHost = await prisma.groupFocusMembership.findUnique({
        where: { roomId_userId: { roomId, userId: room.hostUserId } },
      });
      if (
        !canonicalHost
        || canonicalHost.role !== "HOST"
        || canonicalHost.status !== "ACTIVE"
      ) return null;
      const mode = requireMode(room.mode);
      const visibility = requireVisibility(room.visibility);
      const role = requireRole(membership.role);
      if (role === "HOST" && room.hostUserId !== userId) return null;
      if (role === "MEMBER" && room.hostUserId === userId) return null;
      const effectiveLectureId = effectiveLecture(room, membership);
      if (!effectiveLectureId) return null;
      const lecture = await prisma.lecture.findUnique({
        where: { id: effectiveLectureId },
        select: { id: true },
      });
      if (!lecture) return null;
      const roomUpdatedAt = iso(room.updatedAt);
      const membershipUpdatedAt = iso(membership.updatedAt);
      if (!roomUpdatedAt || !membershipUpdatedAt) return null;
      return {
        roomId: room.id,
        membershipId: membership.id,
        userId,
        role,
        mode,
        visibility,
        effectiveLectureId,
        focusDurationSeconds: room.focusDurationSeconds,
        breakDurationSeconds: room.breakDurationSeconds,
        roundCount: room.roundCount,
        maxParticipants: room.maxParticipants,
        roomUpdatedAt,
        membershipUpdatedAt,
      };
    },
  };
}