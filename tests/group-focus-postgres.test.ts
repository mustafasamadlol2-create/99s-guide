import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import express, { type RequestHandler } from "express";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { GroupFocusError } from "../server/features/group-focus/errors.js";
import { createGroupFocusRoomSchema } from "../server/features/group-focus/schemas.js";
import type { GroupFocusService } from "../server/features/group-focus/service.js";
import {
  createGroupFocusJsonParser,
  createGroupFocusRouter,
} from "../server/routes/groupFocus.js";
import { getPrompt13GroupFocusPostgresGateUrl } from "./helpers/prompt13GroupFocusPostgresGate.js";

const databaseUrl = getPrompt13GroupFocusPostgresGateUrl();
const skipped = databaseUrl
  ? false
  : "Set the explicit Prompt 13 disposable-schema PostgreSQL gate to run.";
const fixedTime = new Date("2026-09-25T10:00:00.000Z");

type Fixture = {
  userIds: string[];
  lectureIds: string[];
};

type RunningApi = {
  baseUrl: string;
  close: () => Promise<void>;
};

let prisma: PrismaClient | undefined;
let makeService: typeof import("../server/features/group-focus/service.js").createGroupFocusService;

function db(): PrismaClient {
  assert.ok(prisma);
  return prisma;
}

function createService(): GroupFocusService {
  return makeService({
    prisma: db(),
    now: () => new Date(fixedTime),
    isEnabled: () => true,
  });
}

async function createFixture(userCount = 4): Promise<Fixture> {
  const suffix = randomUUID();
  const users = await Promise.all(
    Array.from({ length: userCount }, (_, index) => db().user.create({
      data: { email: `prompt13-group-focus-${index}-${suffix}@example.test` },
      select: { id: true },
    })),
  );
  const lectures = await Promise.all([
    db().lecture.create({
      data: {
        name: "Prompt 13 Group Focus Lecture",
        mainSubject: "Verification",
        trackMode: "test",
      },
      select: { id: true },
    }),
    db().lecture.create({
      data: {
        name: "Prompt 13 Alternate Lecture",
        mainSubject: "Verification",
        trackMode: "test",
      },
      select: { id: true },
    }),
  ]);
  return {
    userIds: users.map((user) => user.id),
    lectureIds: lectures.map((lecture) => lecture.id),
  };
}

async function removeFixture(fixture: Fixture): Promise<void> {
  await db().groupFocusRoom.deleteMany({
    where: { hostUserId: { in: fixture.userIds } },
  });
  await db().groupFocusMembership.deleteMany({
    where: { userId: { in: fixture.userIds } },
  });
  await db().user.deleteMany({ where: { id: { in: fixture.userIds } } });
  await db().lecture.deleteMany({ where: { id: { in: fixture.lectureIds } } });
}

async function withFixture(
  userCount: number,
  run: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const fixture = await createFixture(userCount);
  try {
    await run(fixture);
  } finally {
    await removeFixture(fixture);
  }
}

function sharedInput(
  lectureId: string,
  idempotencyKey = `prompt13-room-${randomUUID()}`,
  overrides: Record<string, unknown> = {},
) {
  return {
    name: "Prompt 13 Shared Room",
    visibility: "PUBLIC",
    mode: "SHARED_LECTURE",
    sharedLectureId: lectureId,
    focusDurationSeconds: 2_700,
    breakDurationSeconds: 600,
    roundCount: 4,
    maxParticipants: 12,
    idempotencyKey,
    ...overrides,
  };
}

function studyTogetherInput(
  lectureId: string,
  idempotencyKey = `prompt13-room-${randomUUID()}`,
  overrides: Record<string, unknown> = {},
) {
  return {
    name: "Prompt 13 Private Room",
    visibility: "PRIVATE",
    mode: "STUDY_TOGETHER",
    hostLectureId: lectureId,
    focusDurationSeconds: 2_700,
    breakDurationSeconds: 600,
    roundCount: 4,
    maxParticipants: 12,
    idempotencyKey,
    ...overrides,
  };
}

async function startApi(service: GroupFocusService): Promise<RunningApi> {
  const app = express();
  app.use("/api/group-focus", createGroupFocusJsonParser());
  const requireUser: RequestHandler = (req, res, next) => {
    const authenticatedUserId = req.header("x-test-user");
    if (!authenticatedUserId) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    (req as express.Request & { user: { id: string } }).user = {
      id: authenticatedUserId,
    };
    next();
  };
  app.use("/api/group-focus", createGroupFocusRouter({
    requireUser,
    service,
    isEnabled: () => true,
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

function callApi(
  api: RunningApi,
  userId: string,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<Response> {
  return fetch(`${api.baseUrl}${path}`, {
    method,
    headers: {
      "x-test-user": userId,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function assertNoStudyCredit(userIds: string[]): Promise<void> {
  const [focusSessions, studyEvents, metrics, points, calendarEvents, outbox] = await Promise.all([
    db().focusSession.count({ where: { userId: { in: userIds } } }),
    db().studyEvent.count({ where: { userId: { in: userIds } } }),
    db().studyDailyMetric.count({ where: { userId: { in: userIds } } }),
    db().pointsLog.count({ where: { userId: { in: userIds } } }),
    db().calendarEvent.count({ where: { userId: { in: userIds } } }),
    db().$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "PrivateD1SyncOutbox"
      WHERE "data"->>'userId' IN (${Prisma.join(userIds)})
    `,
  ]);
  assert.equal(focusSessions, 0);
  assert.equal(studyEvents, 0);
  assert.equal(metrics, 0);
  assert.equal(points, 0);
  assert.equal(calendarEvents, 0);
  assert.equal(Number(outbox[0]?.count ?? 0n), 0);
}

if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = databaseUrl;
  process.env.SUPABASE_DATABASE_URL = "";

  before(async () => {
    const prismaModule = await import("../server/services/prismaClient.js");
    const serviceModule = await import("../server/features/group-focus/service.js");
    prisma = prismaModule.getPrisma() as PrismaClient;
    makeService = serviceModule.createGroupFocusService;
    await db().$connect();
  });

  after(async () => {
    await prisma?.$disconnect();
  });
}

test("real PostgreSQL canonical rooms, membership, invitations and HTTP authorization", {
  skip: skipped,
}, async () => {
  await withFixture(5, async (fixture) => {
    const [hostId, memberId, outsiderId, removedId] = fixture.userIds;
    const [lectureId, alternateLectureId] = fixture.lectureIds;
    const focus = createService();
    const api = await startApi(focus);
    try {
      const unauthenticated = await fetch(
        `${api.baseUrl}/api/group-focus/rooms/public`,
      );
      assert.equal(unauthenticated.status, 401);

      const createBody = sharedInput(lectureId);
      const createResponse = await callApi(
        api,
        hostId,
        "/api/group-focus/rooms",
        "POST",
        createBody,
      );
      assert.equal(createResponse.status, 201);
      const created = await createResponse.json() as {
        room: { id: string; visibility: string; mode: string; sharedLectureId: string | null };
        membership: { role: string; status: string; selectedLectureId: string | null };
        idempotency: string;
      };
      const roomId = created.room.id;
      assert.equal(created.room.visibility, "PUBLIC");
      assert.equal(created.room.mode, "SHARED_LECTURE");
      assert.equal(created.room.sharedLectureId, lectureId);
      assert.equal(created.membership.role, "HOST");
      assert.equal(created.membership.status, "ACTIVE");
      assert.equal(created.membership.selectedLectureId, null);
      assert.equal(created.idempotency, "CREATED");

      const untrustedRoleFields = await callApi(api, hostId, "/api/group-focus/rooms", "POST", {
        ...createBody,
        hostUserId: outsiderId,
        role: "HOST",
        status: "CLOSED",
      });
      assert.equal(untrustedRoleFields.status, 400);
      const invalidLecture = await callApi(api, hostId, "/api/group-focus/rooms", "POST", {
        ...createBody,
        idempotencyKey: `prompt13-invalid-lecture-${randomUUID()}`,
        sharedLectureId: randomUUID(),
      });
      assert.equal(invalidLecture.status, 400);

      const replay = await callApi(api, hostId, "/api/group-focus/rooms", "POST", createBody);
      assert.equal(replay.status, 200);
      assert.equal((await replay.json() as { room: { id: string } }).room.id, roomId);
      const conflict = await callApi(api, hostId, "/api/group-focus/rooms", "POST", {
        ...createBody,
        name: "Different semantic payload",
      });
      assert.equal(conflict.status, 409);
      assert.equal((await conflict.json() as { code: string }).code, "IDEMPOTENCY_CONFLICT");
      assert.equal(await db().groupFocusRoom.count({ where: { hostUserId: hostId } }), 1);
      assert.equal(await db().groupFocusMembership.count({
        where: { roomId, userId: hostId },
      }), 1);
      const concurrentReplays = await Promise.all(
        Array.from({ length: 6 }, () => focus.createRoom(
          hostId,
          createGroupFocusRoomSchema.parse(createBody),
        )),
      );
      assert.ok(concurrentReplays.every((result) =>
        result.room.id === roomId && result.idempotency === "REPLAY_SAME_PAYLOAD"));
      assert.equal(await db().groupFocusRoom.count({ where: { hostUserId: hostId } }), 1);

      const rejectedOverride = await callApi(
        api,
        memberId,
        `/api/group-focus/rooms/${roomId}/join`,
        "POST",
        { lectureId: alternateLectureId },
      );
      assert.equal(rejectedOverride.status, 400);
      const join = await callApi(
        api,
        memberId,
        `/api/group-focus/rooms/${roomId}/join`,
        "POST",
        {},
      );
      assert.equal(join.status, 200);
      const joined = await join.json() as {
        membership: { id?: string; membershipId: string; status: string; selectedLectureId: string | null };
      };
      assert.equal(joined.membership.status, "ACTIVE");
      assert.equal(joined.membership.selectedLectureId, null);
      assert.equal(await db().groupFocusMembership.count({
        where: { roomId, userId: memberId },
      }), 1);
      const sharedContext = await focus.getGroupFocusAuthorizationContext(memberId, roomId);
      assert.ok(sharedContext);
      assert.deepEqual(Object.keys(sharedContext).sort(), [
        "breakDurationSeconds",
        "effectiveLectureId",
        "focusDurationSeconds",
        "maxParticipants",
        "membershipId",
        "membershipUpdatedAt",
        "mode",
        "role",
        "roomId",
        "roomUpdatedAt",
        "roundCount",
        "userId",
        "visibility",
      ]);
      assert.equal(sharedContext.effectiveLectureId, lectureId);
      assert.equal(
        await focus.getGroupFocusAuthorizationContext(outsiderId, roomId),
        null,
      );
      const hostContext = await focus.getGroupFocusAuthorizationContext(hostId, roomId);
      assert.ok(hostContext);
      assert.equal(hostContext.role, "HOST");
      assert.equal(hostContext.effectiveLectureId, lectureId);
      const activeLectureOverride = await callApi(
        api,
        memberId,
        `/api/group-focus/rooms/${roomId}/join`,
        "POST",
        { lectureId: alternateLectureId },
      );
      assert.equal(activeLectureOverride.status, 400);

      const outsiderDetail = await callApi(api, outsiderId, `/api/group-focus/rooms/${roomId}`);
      assert.equal(outsiderDetail.status, 200);
      const outsiderMembers = await callApi(
        api,
        outsiderId,
        `/api/group-focus/rooms/${roomId}/members`,
      );
      assert.equal(outsiderMembers.status, 404);
      const membersResponse = await callApi(
        api,
        memberId,
        `/api/group-focus/rooms/${roomId}/members`,
      );
      assert.equal(membersResponse.status, 200);
      const membersBody = await membersResponse.json() as {
        members: Array<Record<string, unknown>>;
      };
      assert.equal(membersBody.members.length, 2);
      assert.equal("email" in membersBody.members[0]!, false);
      assert.equal("authToken" in membersBody.members[0]!, false);
      const publicDetailWithCount = await callApi(api, memberId, `/api/group-focus/rooms/${roomId}`);
      assert.equal(publicDetailWithCount.status, 200);
      assert.equal(
        (await publicDetailWithCount.json() as { room: { participantCount: number } })
          .room.participantCount,
        2,
      );

      const mine = await callApi(api, memberId, "/api/group-focus/rooms/mine?membershipStatus=ACTIVE");
      assert.equal(mine.status, 200);
      assert.equal((await mine.json() as { rooms: unknown[] }).rooms.length, 1);

      const updateSharedLecture = await callApi(
        api,
        memberId,
        `/api/group-focus/rooms/${roomId}/me/lecture`,
        "PATCH",
        { lectureId: alternateLectureId },
      );
      assert.equal(updateSharedLecture.status, 400);
      const memberCannotClose = await callApi(
        api,
        memberId,
        `/api/group-focus/rooms/${roomId}/close`,
        "POST",
        {},
      );
      assert.equal(memberCannotClose.status, 403);
      const memberCannotRotate = await callApi(
        api,
        memberId,
        `/api/group-focus/rooms/${roomId}/invite/rotate`,
        "POST",
        {},
      );
      assert.equal(memberCannotRotate.status, 403);
      const leave = await callApi(
        api,
        memberId,
        `/api/group-focus/rooms/${roomId}/leave`,
        "POST",
        {},
      );
      assert.equal(leave.status, 200);
      const leftMembership = await leave.json() as {
        membership: { membershipId: string; status: string };
      };
      assert.equal(leftMembership.membership.status, "LEFT");
      assert.equal(leftMembership.membership.membershipId, joined.membership.membershipId);
      assert.equal(await focus.getGroupFocusAuthorizationContext(memberId, roomId), null);
      const rejoin = await callApi(
        api,
        memberId,
        `/api/group-focus/rooms/${roomId}/join`,
        "POST",
        {},
      );
      assert.equal(rejoin.status, 200);
      const rejoinedMembership = await rejoin.json() as {
        membership: { membershipId: string; status: string };
      };
      assert.equal(rejoinedMembership.membership.membershipId, joined.membership.membershipId);
      assert.equal(rejoinedMembership.membership.status, "ACTIVE");

      const removedJoin = await callApi(
        api,
        removedId,
        `/api/group-focus/rooms/${roomId}/join`,
        "POST",
        {},
      );
      assert.equal(removedJoin.status, 200);
      const remove = await callApi(
        api,
        hostId,
        `/api/group-focus/rooms/${roomId}/members/${removedId}/remove`,
        "POST",
        {},
      );
      assert.equal(remove.status, 200);
      assert.equal((await remove.json() as { membership: { status: string } }).membership.status, "REMOVED");
      const removedCannotRejoin = await callApi(
        api,
        removedId,
        `/api/group-focus/rooms/${roomId}/join`,
        "POST",
        {},
      );
      assert.equal(removedCannotRejoin.status, 409);
      assert.equal(
        (await removedCannotRejoin.json() as { code: string }).code,
        "MEMBER_REMOVED",
      );
      const nonHostRemove = await callApi(
        api,
        memberId,
        `/api/group-focus/rooms/${roomId}/members/${removedId}/remove`,
        "POST",
        {},
      );
      assert.equal(nonHostRemove.status, 403);
      const hostLeave = await callApi(
        api,
        hostId,
        `/api/group-focus/rooms/${roomId}/leave`,
        "POST",
        {},
      );
      assert.equal(hostLeave.status, 409);
      assert.equal((await hostLeave.json() as { code: string }).code, "HOST_MUST_CLOSE_ROOM");

      const closePublic = await callApi(
        api,
        hostId,
        `/api/group-focus/rooms/${roomId}/close`,
        "POST",
        {},
      );
      assert.equal(closePublic.status, 200);
      assert.equal((await closePublic.json() as { membershipsClosed: number }).membershipsClosed, 2);
      const closedPublicRoom = await callApi(api, memberId, `/api/group-focus/rooms/${roomId}`);
      assert.equal(closedPublicRoom.status, 200);
      const unrelatedClosedRoom = await callApi(api, outsiderId, `/api/group-focus/rooms/${roomId}`);
      assert.equal(unrelatedClosedRoom.status, 404);

      const privateCreateKey = `prompt13-private-${randomUUID()}`;
      const privateCreate = await callApi(
        api,
        hostId,
        "/api/group-focus/rooms",
        "POST",
        studyTogetherInput(lectureId, privateCreateKey),
      );
      assert.equal(privateCreate.status, 201);
      const privateResult = await privateCreate.json() as {
        room: { id: string; visibility: string; mode: string; sharedLectureId: string | null };
        membership: { role: string; selectedLectureId: string | null };
      };
      const privateRoomId = privateResult.room.id;
      assert.equal(privateResult.room.visibility, "PRIVATE");
      assert.equal(privateResult.room.mode, "STUDY_TOGETHER");
      assert.equal(privateResult.room.sharedLectureId, null);
      assert.equal(privateResult.membership.role, "HOST");
      assert.equal(privateResult.membership.selectedLectureId, lectureId);
      const privateBeforeInvite = await db().groupFocusRoom.findUniqueOrThrow({
        where: { id: privateRoomId },
        select: { inviteTokenHash: true, inviteVersion: true },
      });
      assert.equal(privateBeforeInvite.inviteTokenHash, null);
      assert.equal(privateBeforeInvite.inviteVersion, 0);
      await db().user.update({
        where: { id: outsiderId },
        data: { role: "admin", isPrimaryOwner: true },
      });
      const privateLectureConflict = await callApi(
        api,
        hostId,
        "/api/group-focus/rooms",
        "POST",
        studyTogetherInput(alternateLectureId, privateCreateKey),
      );
      assert.equal(privateLectureConflict.status, 409);
      assert.equal(
        (await privateLectureConflict.json() as { code: string }).code,
        "IDEMPOTENCY_CONFLICT",
      );

      const publicPage = await callApi(api, outsiderId, "/api/group-focus/rooms/public");
      assert.equal(publicPage.status, 200);
      const publicRooms = await publicPage.json() as { rooms: Array<{ id: string }> };
      assert.equal(publicRooms.rooms.some((room) => room.id === privateRoomId), false);
      const unrelatedPrivateDetail = await callApi(
        api,
        outsiderId,
        `/api/group-focus/rooms/${privateRoomId}`,
      );
      assert.equal(unrelatedPrivateDetail.status, 404);
      const unrelatedPrivateMembers = await callApi(
        api,
        outsiderId,
        `/api/group-focus/rooms/${privateRoomId}/members`,
      );
      assert.equal(unrelatedPrivateMembers.status, 404);
      assert.equal(
        await focus.getGroupFocusAuthorizationContext(outsiderId, privateRoomId),
        null,
      );
      const privateDetail = await callApi(
        api,
        hostId,
        `/api/group-focus/rooms/${privateRoomId}`,
      );
      assert.equal(privateDetail.status, 200);
      const privateDetailText = JSON.stringify(await privateDetail.json());
      assert.equal(privateDetailText.includes("inviteTokenHash"), false);
      assert.equal(privateDetailText.includes("createIdempotencyKey"), false);
      assert.equal(privateDetailText.includes("inviteToken"), false);

      const missingInvite = await callApi(
        api,
        outsiderId,
        `/api/group-focus/rooms/${privateRoomId}/join`,
        "POST",
        { lectureId },
      );
      assert.equal(missingInvite.status, 404);
      assert.equal((await missingInvite.json() as { code: string }).code, "ROOM_NOT_FOUND");
      const firstInviteResponse = await callApi(
        api,
        hostId,
        `/api/group-focus/rooms/${privateRoomId}/invite/rotate`,
        "POST",
        {},
      );
      assert.equal(firstInviteResponse.status, 200);
      const firstInvite = await firstInviteResponse.json() as {
        inviteToken: string;
        inviteVersion: number;
      };
      assert.equal(firstInvite.inviteVersion, 1);
      assert.ok(firstInvite.inviteToken.length >= 32);
      const privateRecord = await db().groupFocusRoom.findUniqueOrThrow({
        where: { id: privateRoomId },
        select: { inviteTokenHash: true, inviteVersion: true },
      });
      assert.equal(privateRecord.inviteVersion, 1);
      assert.equal(
        privateRecord.inviteTokenHash,
        createHash("sha256").update(firstInvite.inviteToken, "utf8").digest("hex"),
      );
      assert.equal(privateRecord.inviteTokenHash?.includes(firstInvite.inviteToken), false);
      const invalidInvite = await callApi(
        api,
        outsiderId,
        `/api/group-focus/rooms/${privateRoomId}/join`,
        "POST",
        { inviteToken: "x".repeat(32), lectureId },
      );
      assert.equal(invalidInvite.status, 404);
      assert.equal((await invalidInvite.json() as { code: string }).code, "ROOM_NOT_FOUND");

      const privateJoin = await callApi(
        api,
        memberId,
        `/api/group-focus/rooms/${privateRoomId}/join`,
        "POST",
        { inviteToken: firstInvite.inviteToken, lectureId },
      );
      assert.equal(privateJoin.status, 200);
      const privateMembership = await privateJoin.json() as {
        membership: { selectedLectureId: string | null; role: string };
      };
      assert.equal(privateMembership.membership.selectedLectureId, lectureId);
      assert.equal(privateMembership.membership.role, "MEMBER");
      const memberCannotClosePrivate = await callApi(
        api,
        memberId,
        `/api/group-focus/rooms/${privateRoomId}/close`,
        "POST",
        {},
      );
      assert.equal(memberCannotClosePrivate.status, 404);
      const memberCannotRotatePrivate = await callApi(
        api,
        memberId,
        `/api/group-focus/rooms/${privateRoomId}/invite/rotate`,
        "POST",
        {},
      );
      assert.equal(memberCannotRotatePrivate.status, 404);

      const secondInviteResponse = await callApi(
        api,
        hostId,
        `/api/group-focus/rooms/${privateRoomId}/invite/rotate`,
        "POST",
        {},
      );
      const secondInvite = await secondInviteResponse.json() as {
        inviteToken: string;
        inviteVersion: number;
      };
      assert.equal(secondInvite.inviteVersion, 2);
      const staleInvite = await callApi(
        api,
        outsiderId,
        `/api/group-focus/rooms/${privateRoomId}/join`,
        "POST",
        { inviteToken: firstInvite.inviteToken, lectureId },
      );
      assert.equal(staleInvite.status, 404);
      const missingStudyLecture = await callApi(
        api,
        outsiderId,
        `/api/group-focus/rooms/${privateRoomId}/join`,
        "POST",
        { inviteToken: secondInvite.inviteToken },
      );
      assert.equal(missingStudyLecture.status, 400);
      const currentInviteJoin = await callApi(
        api,
        outsiderId,
        `/api/group-focus/rooms/${privateRoomId}/join`,
        "POST",
        { inviteToken: secondInvite.inviteToken, lectureId },
      );
      assert.equal(currentInviteJoin.status, 200);

      const updateLecture = await callApi(
        api,
        memberId,
        `/api/group-focus/rooms/${privateRoomId}/me/lecture`,
        "PATCH",
        { lectureId: alternateLectureId },
      );
      assert.equal(updateLecture.status, 200);
      const memberContext = await focus.getGroupFocusAuthorizationContext(memberId, privateRoomId);
      assert.ok(memberContext);
      assert.equal(memberContext.effectiveLectureId, alternateLectureId);
      assert.equal(memberContext.role, "MEMBER");
      const privateHostContext = await focus.getGroupFocusAuthorizationContext(hostId, privateRoomId);
      assert.ok(privateHostContext);
      assert.equal(privateHostContext.effectiveLectureId, lectureId);
      assert.equal(privateHostContext.role, "HOST");
      const activeLectureJoinOverride = await callApi(
        api,
        memberId,
        `/api/group-focus/rooms/${privateRoomId}/join`,
        "POST",
        { lectureId, inviteToken: secondInvite.inviteToken },
      );
      assert.equal(activeLectureJoinOverride.status, 400);
      const authContext = await focus.getGroupFocusAuthorizationContext(memberId, privateRoomId);
      assert.ok(authContext);
      assert.equal(authContext.effectiveLectureId, alternateLectureId);
      assert.equal(authContext.role, "MEMBER");
      assert.equal("inviteToken" in authContext, false);
      assert.equal("inviteTokenHash" in authContext, false);

      const removedFromPrivate = await callApi(
        api,
        hostId,
        `/api/group-focus/rooms/${privateRoomId}/members/${memberId}/remove`,
        "POST",
        {},
      );
      assert.equal(removedFromPrivate.status, 200);
      assert.equal(
        await focus.getGroupFocusAuthorizationContext(memberId, privateRoomId),
        null,
      );
      const removedMemberRejoin = await callApi(
        api,
        memberId,
        `/api/group-focus/rooms/${privateRoomId}/join`,
        "POST",
        { inviteToken: secondInvite.inviteToken, lectureId },
      );
      assert.equal(removedMemberRejoin.status, 409);
      assert.equal(
        (await removedMemberRejoin.json() as { code: string }).code,
        "MEMBER_REMOVED",
      );

      const closePrivate = await callApi(
        api,
        hostId,
        `/api/group-focus/rooms/${privateRoomId}/close`,
        "POST",
        {},
      );
      assert.equal(closePrivate.status, 200);
      const closedInvite = await db().groupFocusRoom.findUniqueOrThrow({
        where: { id: privateRoomId },
        select: { inviteTokenHash: true, inviteVersion: true, status: true },
      });
      assert.equal(closedInvite.status, "CLOSED");
      assert.equal(closedInvite.inviteTokenHash, null);
      assert.equal(closedInvite.inviteVersion, 3);
      assert.equal(
        await focus.getGroupFocusAuthorizationContext(hostId, privateRoomId),
        null,
      );
      const closedLectureUpdate = await callApi(
        api,
        hostId,
        `/api/group-focus/rooms/${privateRoomId}/me/lecture`,
        "PATCH",
        { lectureId: alternateLectureId },
      );
      assert.equal(closedLectureUpdate.status, 409);
      const rotateAfterClose = await callApi(
        api,
        hostId,
        `/api/group-focus/rooms/${privateRoomId}/invite/rotate`,
        "POST",
        {},
      );
      assert.equal(rotateAfterClose.status, 409);
      const joinClosedPrivate = await callApi(
        api,
        outsiderId,
        `/api/group-focus/rooms/${privateRoomId}/join`,
        "POST",
        { inviteToken: secondInvite.inviteToken, lectureId },
      );
      assert.equal(joinClosedPrivate.status, 409);

      const history = await db().groupFocusMembership.findMany({
        where: { roomId: privateRoomId },
        orderBy: { role: "asc" },
      });
      assert.equal(history.length, 3);
      assert.equal(history.find((row) => row.userId === memberId)?.status, "REMOVED");
      assert.equal(history.find((row) => row.userId === outsiderId)?.status, "LEFT");
      await assertNoStudyCredit(fixture.userIds);
    } finally {
      await api.close();
    }
  });
});

test("real PostgreSQL Room advisory lock prevents concurrent capacity overflow", {
  skip: skipped,
}, async () => {
  await withFixture(22, async (fixture) => {
    const [hostId, ...joinerIds] = fixture.userIds;
    const [lectureId] = fixture.lectureIds;
    const focus = createService();
    const created = await focus.createRoom(
      hostId!,
      createGroupFocusRoomSchema.parse(sharedInput(lectureId!, `prompt13-capacity-${randomUUID()}`, {
        name: "Capacity test",
        maxParticipants: 5,
      })),
    );
    assert.equal(created.membership.role, "HOST");

    const attempts = await Promise.allSettled(
      joinerIds.map((userId) => focus.joinRoom(userId, created.room.id, {})),
    );
    const succeeded = attempts.filter((result) => result.status === "fulfilled");
    const failed = attempts.filter((result) => result.status === "rejected");
    assert.equal(succeeded.length, 4);
    assert.equal(failed.length, 17);
    for (const result of failed) {
      assert.ok(result.status === "rejected");
      assert.ok(result.reason instanceof GroupFocusError);
      assert.equal(result.reason.code, "ROOM_FULL");
    }

    const activeCount = await db().groupFocusMembership.count({
      where: { roomId: created.room.id, status: "ACTIVE" },
    });
    const rowCount = await db().groupFocusMembership.count({
      where: { roomId: created.room.id },
    });
    assert.equal(activeCount, 5);
    assert.equal(rowCount, 5);

    const firstWinner = succeeded[0];
    assert.ok(firstWinner?.status === "fulfilled");
    const repeated = await focus.joinRoom(firstWinner.value.membership.userId, created.room.id, {});
    assert.equal(repeated.membership.membershipId, firstWinner.value.membership.membershipId);
    assert.equal(await db().groupFocusMembership.count({
      where: { roomId: created.room.id, status: "ACTIVE" },
    }), 5);

    await focus.leaveRoom(firstWinner.value.membership.userId, created.room.id);
    const loserIndex = attempts.findIndex((result) => result.status === "rejected");
    assert.ok(loserIndex >= 0);
    const rejoined = await focus.joinRoom(joinerIds[loserIndex]!, created.room.id, {});
    assert.equal(rejoined.membership.status, "ACTIVE");
    assert.equal(await db().groupFocusMembership.count({
      where: { roomId: created.room.id, status: "ACTIVE" },
    }), 5);

    const hostRows = await db().groupFocusMembership.findMany({
      where: { roomId: created.room.id, role: "HOST" },
    });
    assert.equal(hostRows.length, 1);
    await assertNoStudyCredit(fixture.userIds);
  });
});