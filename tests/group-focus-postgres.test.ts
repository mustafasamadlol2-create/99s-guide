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

function createService(now: () => Date = () => new Date(fixedTime)): GroupFocusService {
  return makeService({
    prisma: db(),
    now,
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

type StudySideEffectCounts = {
  studyEvents: number;
  studyDailyMetrics: number;
  focusSessions: number;
  pointsLog: number;
  privateD1SyncOutbox: number;
  calendarEvents: number;
};

async function readStudySideEffectCounts(): Promise<StudySideEffectCounts> {
  const [studyEvents, studyDailyMetrics, focusSessions, pointsLog, calendarEvents, outbox] =
    await Promise.all([
      db().studyEvent.count(),
      db().studyDailyMetric.count(),
      db().focusSession.count(),
      db().pointsLog.count(),
      db().calendarEvent.count(),
      db().$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM "PrivateD1SyncOutbox"
      `,
    ]);
  return {
    studyEvents,
    studyDailyMetrics,
    focusSessions,
    pointsLog,
    privateD1SyncOutbox: Number(outbox[0]?.count ?? 0n),
    calendarEvents,
  };
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
    const [hostId, memberId, outsiderId, removedId, appOwnerId] = fixture.userIds;
    assert.ok(appOwnerId);
    const [lectureId, alternateLectureId] = fixture.lectureIds;
    const studySideEffectsBefore = await readStudySideEffectCounts();
    const serviceTime = { current: new Date(fixedTime) };
    const focus = createService(() => new Date(serviceTime.current));
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
      const invalidStudyLectureCreate = await callApi(
        api,
        hostId,
        "/api/group-focus/rooms",
        "POST",
        studyTogetherInput(
          randomUUID(),
          `prompt13-invalid-study-lecture-${randomUUID()}`,
        ),
      );
      assert.equal(invalidStudyLectureCreate.status, 400);
      assert.equal(await db().groupFocusRoom.count({ where: { hostUserId: hostId } }), 1);

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
      const concurrentCreateBody = sharedInput(
        lectureId,
        `prompt13-parallel-create-${randomUUID()}`,
      );
      const concurrentCreateResponses = await Promise.all(
        Array.from({ length: 10 }, () => callApi(
          api,
          hostId,
          "/api/group-focus/rooms",
          "POST",
          concurrentCreateBody,
        )),
      );
      const concurrentCreateResults = await Promise.all(
        concurrentCreateResponses.map(async (response) => ({
          status: response.status,
          ...(await response.json() as {
            room: { id: string };
            idempotency: string;
          }),
        })),
      );
      assert.equal(concurrentCreateResults.filter((result) => result.status === 201).length, 1);
      assert.equal(concurrentCreateResults.filter((result) => result.status === 200).length, 9);
      assert.equal(new Set(concurrentCreateResults.map((result) => result.room.id)).size, 1);
      assert.equal(
        concurrentCreateResults.filter((result) => result.idempotency === "CREATED").length,
        1,
      );
      assert.equal(
        concurrentCreateResults.filter((result) => result.idempotency === "REPLAY_SAME_PAYLOAD").length,
        9,
      );
      const concurrentRoomId = concurrentCreateResults[0]!.room.id;
      assert.equal(await db().groupFocusRoom.count({
        where: {
          hostUserId: hostId,
          createIdempotencyKey: concurrentCreateBody.idempotencyKey,
        },
      }), 1);
      assert.equal(await db().groupFocusMembership.count({
        where: { roomId: concurrentRoomId, userId: hostId, role: "HOST" },
      }), 1);

      const rejectedOverride = await callApi(
        api,
        memberId,
        `/api/group-focus/rooms/${roomId}/join`,
        "POST",
        { lectureId: alternateLectureId },
      );
      assert.equal(rejectedOverride.status, 400);
      assert.equal(await db().groupFocusMembership.count({
        where: { roomId, userId: memberId },
      }), 0);
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
      const joinedRow = await db().groupFocusMembership.findUniqueOrThrow({
        where: { roomId_userId: { roomId, userId: memberId } },
        select: { id: true, joinedAt: true, createdAt: true, leftAt: true, updatedAt: true },
      });
      assert.equal(joinedRow.id, joined.membership.membershipId);
      assert.equal(joinedRow.leftAt, null);
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
      assert.deepEqual(Object.keys(hostContext).sort(), [
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
      const activeJoinReplay = await callApi(
        api,
        memberId,
        `/api/group-focus/rooms/${roomId}/join`,
        "POST",
        {},
      );
      assert.equal(activeJoinReplay.status, 200);
      assert.equal(
        (await activeJoinReplay.json() as {
          membership: { membershipId: string };
        }).membership.membershipId,
        joined.membership.membershipId,
      );
      assert.equal(await db().groupFocusMembership.count({
        where: { roomId, userId: memberId },
      }), 1);
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
      const publicRoomAfterMemberDenials = await db().groupFocusRoom.findUniqueOrThrow({
        where: { id: roomId },
        select: { status: true, inviteTokenHash: true, inviteVersion: true },
      });
      assert.deepEqual(publicRoomAfterMemberDenials, {
        status: "OPEN",
        inviteTokenHash: null,
        inviteVersion: 0,
      });
      const publicMembershipsAfterMemberDenials = await db().groupFocusMembership.findMany({
        where: { roomId },
        select: { userId: true, status: true },
      });
      assert.deepEqual(
        publicMembershipsAfterMemberDenials
          .map((membership) => [membership.userId, membership.status])
          .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
        [[hostId, "ACTIVE"], [memberId, "ACTIVE"]]
          .sort((left, right) => left[0].localeCompare(right[0])),
      );
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
      const leftRow = await db().groupFocusMembership.findUniqueOrThrow({
        where: { roomId_userId: { roomId, userId: memberId } },
        select: { id: true, joinedAt: true, createdAt: true, leftAt: true, status: true },
      });
      assert.equal(leftRow.status, "LEFT");
      assert.equal(leftRow.id, joinedRow.id);
      assert.equal(leftRow.joinedAt.getTime(), joinedRow.joinedAt.getTime());
      assert.equal(leftRow.createdAt.getTime(), joinedRow.createdAt.getTime());
      assert.equal(leftRow.leftAt?.getTime(), serviceTime.current.getTime());
      assert.equal(await focus.getGroupFocusAuthorizationContext(memberId, roomId), null);
      serviceTime.current = new Date(serviceTime.current.getTime() + 1_000);
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
      const rejoinedRow = await db().groupFocusMembership.findUniqueOrThrow({
        where: { roomId_userId: { roomId, userId: memberId } },
        select: { id: true, joinedAt: true, createdAt: true, leftAt: true, status: true },
      });
      assert.equal(rejoinedRow.id, joinedRow.id);
      assert.equal(rejoinedRow.status, "ACTIVE");
      assert.equal(rejoinedRow.joinedAt.getTime(), serviceTime.current.getTime());
      assert.equal(rejoinedRow.createdAt.getTime(), joinedRow.createdAt.getTime());
      assert.equal(rejoinedRow.leftAt, null);

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
      const removedRow = await db().groupFocusMembership.findUniqueOrThrow({
        where: { roomId_userId: { roomId, userId: removedId } },
        select: { status: true, leftAt: true },
      });
      assert.equal(removedRow.status, "REMOVED");
      assert.ok(removedRow.leftAt instanceof Date);
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
      assert.deepEqual(
        await db().groupFocusMembership.findUniqueOrThrow({
          where: { roomId_userId: { roomId, userId: removedId } },
          select: { status: true, leftAt: true },
        }),
        removedRow,
      );
      const nonHostRemove = await callApi(
        api,
        memberId,
        `/api/group-focus/rooms/${roomId}/members/${removedId}/remove`,
        "POST",
        {},
      );
      assert.equal(nonHostRemove.status, 403);
      assert.deepEqual(
        await db().groupFocusMembership.findUniqueOrThrow({
          where: { roomId_userId: { roomId, userId: removedId } },
          select: { status: true, leftAt: true },
        }),
        removedRow,
      );
      const hostLeave = await callApi(
        api,
        hostId,
        `/api/group-focus/rooms/${roomId}/leave`,
        "POST",
        {},
      );
      assert.equal(hostLeave.status, 409);
      assert.equal((await hostLeave.json() as { code: string }).code, "HOST_MUST_CLOSE_ROOM");
      assert.equal((await db().groupFocusRoom.findUniqueOrThrow({
        where: { id: roomId },
        select: { status: true },
      })).status, "OPEN");
      assert.equal((await db().groupFocusMembership.findUniqueOrThrow({
        where: { roomId_userId: { roomId, userId: hostId } },
        select: { role: true, status: true },
      })).status, "ACTIVE");
      const openPublicPage = await callApi(api, outsiderId, "/api/group-focus/rooms/public");
      assert.equal(openPublicPage.status, 200);
      const openPublicRooms = await openPublicPage.json() as {
        rooms: Array<{ id: string; participantCount: number }>;
      };
      const publicRoomCard = openPublicRooms.rooms.find((room) => room.id === roomId);
      assert.ok(publicRoomCard);
      const [activePublicMembers, allPublicMemberships] = await Promise.all([
        db().groupFocusMembership.count({ where: { roomId, status: "ACTIVE" } }),
        db().groupFocusMembership.count({ where: { roomId } }),
      ]);
      assert.equal(activePublicMembers, 2);
      assert.equal(allPublicMemberships, 3);
      assert.equal(publicRoomCard.participantCount, activePublicMembers);

      const closePublic = await callApi(
        api,
        hostId,
        `/api/group-focus/rooms/${roomId}/close`,
        "POST",
        {},
      );
      assert.equal(closePublic.status, 200);
      assert.equal((await closePublic.json() as { membershipsClosed: number }).membershipsClosed, 2);
      const closedPublicState = await db().groupFocusRoom.findUniqueOrThrow({
        where: { id: roomId },
        select: { status: true, closedAt: true },
      });
      assert.equal(closedPublicState.status, "CLOSED");
      assert.ok(closedPublicState.closedAt instanceof Date);
      const closedPublicMemberships = await db().groupFocusMembership.findMany({
        where: { roomId },
        select: { userId: true, status: true, leftAt: true },
      });
      assert.equal(closedPublicMemberships.length, 3);
      assert.equal(
        closedPublicMemberships.find((membership) => membership.userId === hostId)?.status,
        "LEFT",
      );
      assert.equal(
        closedPublicMemberships.find((membership) => membership.userId === memberId)?.status,
        "LEFT",
      );
      assert.equal(
        closedPublicMemberships.find((membership) => membership.userId === removedId)?.status,
        "REMOVED",
      );
      assert.ok(
        closedPublicMemberships.find((membership) => membership.userId === hostId)?.leftAt
          instanceof Date,
      );
      assert.ok(
        closedPublicMemberships.find((membership) => membership.userId === memberId)?.leftAt
          instanceof Date,
      );
      const closedPublicRoom = await callApi(api, memberId, `/api/group-focus/rooms/${roomId}`);
      assert.equal(closedPublicRoom.status, 200);
      assert.equal(
        (await closedPublicRoom.json() as { room: { status: string } }).room.status,
        "CLOSED",
      );
      const unrelatedClosedRoom = await callApi(api, outsiderId, `/api/group-focus/rooms/${roomId}`);
      assert.equal(unrelatedClosedRoom.status, 404);
      const publicPageAfterClose = await callApi(api, outsiderId, "/api/group-focus/rooms/public");
      assert.equal(publicPageAfterClose.status, 200);
      assert.equal(
        (await publicPageAfterClose.json() as { rooms: Array<{ id: string }> }).rooms
          .some((room) => room.id === roomId),
        false,
      );

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
        data: { role: "admin", isPrimaryOwner: false },
      });
      await db().user.update({
        where: { id: appOwnerId },
        data: { role: "owner", isPrimaryOwner: false },
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
      const publicRooms = await publicPage.json() as {
        rooms: Array<{ id: string; participantCount: number }>;
      };
      assert.equal(publicRooms.rooms.some((room) => room.id === privateRoomId), false);
      for (const appRoleUserId of [outsiderId, appOwnerId]) {
        const unrelatedPrivateDetail = await callApi(
          api,
          appRoleUserId,
          `/api/group-focus/rooms/${privateRoomId}`,
        );
        assert.equal(unrelatedPrivateDetail.status, 404);
        assert.deepEqual(await unrelatedPrivateDetail.json(), {
          error: "Group Focus Room was not found.",
          code: "ROOM_NOT_FOUND",
        });
        const unrelatedPrivateMembers = await callApi(
          api,
          appRoleUserId,
          `/api/group-focus/rooms/${privateRoomId}/members`,
        );
        assert.equal(unrelatedPrivateMembers.status, 404);
        assert.deepEqual(await unrelatedPrivateMembers.json(), {
          error: "Group Focus Room was not found.",
          code: "ROOM_NOT_FOUND",
        });
        const unrelatedPrivateRotate = await callApi(
          api,
          appRoleUserId,
          `/api/group-focus/rooms/${privateRoomId}/invite/rotate`,
          "POST",
          {},
        );
        assert.equal(unrelatedPrivateRotate.status, 404);
        const unrelatedPrivateRemove = await callApi(
          api,
          appRoleUserId,
          `/api/group-focus/rooms/${privateRoomId}/members/${memberId}/remove`,
          "POST",
          {},
        );
        assert.equal(unrelatedPrivateRemove.status, 404);
        const unrelatedPrivateClose = await callApi(
          api,
          appRoleUserId,
          `/api/group-focus/rooms/${privateRoomId}/close`,
          "POST",
          {},
        );
        assert.equal(unrelatedPrivateClose.status, 404);
        assert.equal(
          await focus.getGroupFocusAuthorizationContext(appRoleUserId, privateRoomId),
          null,
        );
      }
      const roomAfterAppRoleDenials = await db().groupFocusRoom.findUniqueOrThrow({
        where: { id: privateRoomId },
        select: { status: true, inviteTokenHash: true, inviteVersion: true },
      });
      assert.deepEqual(roomAfterAppRoleDenials, {
        status: "OPEN",
        inviteTokenHash: null,
        inviteVersion: 0,
      });
      assert.equal(await db().groupFocusMembership.count({ where: { roomId: privateRoomId } }), 1);
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
      assert.equal(await db().groupFocusMembership.count({
        where: { roomId: privateRoomId, userId: outsiderId },
      }), 0);
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
      assert.equal(firstInvite.inviteToken.length, 32);
      assert.match(firstInvite.inviteToken, /^[A-Za-z0-9_-]{32}$/u);
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
      assert.equal(await db().groupFocusMembership.count({
        where: { roomId: privateRoomId, userId: outsiderId },
      }), 0);

      const missingLectureOnJoin = await callApi(
        api,
        outsiderId,
        `/api/group-focus/rooms/${privateRoomId}/join`,
        "POST",
        { inviteToken: firstInvite.inviteToken },
      );
      assert.equal(missingLectureOnJoin.status, 400);
      assert.equal(
        (await missingLectureOnJoin.json() as { code: string }).code,
        "INVALID_MEMBER_LECTURE",
      );
      const unknownLectureOnJoin = await callApi(
        api,
        outsiderId,
        `/api/group-focus/rooms/${privateRoomId}/join`,
        "POST",
        { inviteToken: firstInvite.inviteToken, lectureId: randomUUID() },
      );
      assert.equal(unknownLectureOnJoin.status, 400);
      assert.equal(
        (await unknownLectureOnJoin.json() as { code: string }).code,
        "INVALID_MEMBER_LECTURE",
      );
      assert.equal(await db().groupFocusMembership.count({
        where: { roomId: privateRoomId, userId: outsiderId },
      }), 0);

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
      assert.equal(await db().groupFocusMembership.count({
        where: { roomId: privateRoomId, userId: memberId },
      }), 1);
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

      const memberLectureBeforeUpdate = await db().groupFocusMembership.findUniqueOrThrow({
        where: { roomId_userId: { roomId: privateRoomId, userId: memberId } },
        select: { selectedLectureId: true, updatedAt: true },
      });
      assert.equal(memberLectureBeforeUpdate.selectedLectureId, lectureId);
      const updateLecture = await callApi(
        api,
        memberId,
        `/api/group-focus/rooms/${privateRoomId}/me/lecture`,
        "PATCH",
        { lectureId: alternateLectureId },
      );
      assert.equal(updateLecture.status, 200);
      const memberLectureAfterUpdate = await db().groupFocusMembership.findUniqueOrThrow({
        where: { roomId_userId: { roomId: privateRoomId, userId: memberId } },
        select: { selectedLectureId: true, updatedAt: true },
      });
      assert.equal(memberLectureAfterUpdate.selectedLectureId, alternateLectureId);
      assert.ok(
        memberLectureAfterUpdate.updatedAt.getTime() > memberLectureBeforeUpdate.updatedAt.getTime(),
      );
      const privateHostMembership = await db().groupFocusMembership.findUniqueOrThrow({
        where: { roomId_userId: { roomId: privateRoomId, userId: hostId } },
        select: { selectedLectureId: true },
      });
      assert.equal(privateHostMembership.selectedLectureId, lectureId);
      const privateOtherMember = await db().groupFocusMembership.findUniqueOrThrow({
        where: { roomId_userId: { roomId: privateRoomId, userId: outsiderId } },
        select: { selectedLectureId: true },
      });
      assert.equal(privateOtherMember.selectedLectureId, lectureId);
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
      assert.equal(
        (await closePrivate.json() as { membershipsClosed: number }).membershipsClosed,
        2,
      );
      const closedInvite = await db().groupFocusRoom.findUniqueOrThrow({
        where: { id: privateRoomId },
        select: { inviteTokenHash: true, inviteVersion: true, status: true, closedAt: true },
      });
      assert.equal(closedInvite.status, "CLOSED");
      assert.equal(closedInvite.inviteTokenHash, null);
      assert.equal(closedInvite.inviteVersion, 3);
      assert.ok(closedInvite.closedAt instanceof Date);
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
      assert.equal((await joinClosedPrivate.json() as { code: string }).code, "ROOM_CLOSED");

      const history = await db().groupFocusMembership.findMany({
        where: { roomId: privateRoomId },
        orderBy: { role: "asc" },
      });
      assert.equal(history.length, 3);
      assert.equal(history.find((row) => row.userId === memberId)?.status, "REMOVED");
      assert.equal(history.find((row) => row.userId === outsiderId)?.status, "LEFT");
      const privateHostHistory = history.find((row) => row.userId === hostId);
      const privateMemberHistory = history.find((row) => row.userId === memberId);
      const privateOutsiderHistory = history.find((row) => row.userId === outsiderId);
      assert.equal(privateHostHistory?.status, "LEFT");
      assert.ok(privateHostHistory?.leftAt instanceof Date);
      assert.ok(privateMemberHistory?.leftAt instanceof Date);
      assert.ok(privateOutsiderHistory?.leftAt instanceof Date);
      assert.equal(await focus.getGroupFocusAuthorizationContext(outsiderId, privateRoomId), null);
      await assertNoStudyCredit(fixture.userIds);
      assert.deepEqual(await readStudySideEffectCounts(), studySideEffectsBefore);
    } finally {
      await api.close();
    }
  });
});

test("real PostgreSQL Room advisory lock prevents concurrent capacity overflow", {
  skip: skipped,
}, async () => {
  await withFixture(21, async (fixture) => {
    const [hostId, ...joinerIds] = fixture.userIds;
    const [lectureId] = fixture.lectureIds;
    const studySideEffectsBefore = await readStudySideEffectCounts();
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
    assert.equal(joinerIds.length, 20);
    assert.equal(failed.length, 16);
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
    await assert.rejects(
      focus.joinRoom(firstWinner.value.membership.userId, created.room.id, {}),
      (error: unknown) => error instanceof GroupFocusError && error.code === "ROOM_FULL",
    );
    const formerWinnerRow = await db().groupFocusMembership.findUniqueOrThrow({
      where: {
        roomId_userId: {
          roomId: created.room.id,
          userId: firstWinner.value.membership.userId,
        },
      },
      select: { status: true, leftAt: true },
    });
    assert.equal(formerWinnerRow.status, "LEFT");
    assert.ok(formerWinnerRow.leftAt instanceof Date);
    assert.equal(await db().groupFocusMembership.count({
      where: { roomId: created.room.id },
    }), 6);
    assert.equal(await db().groupFocusMembership.count({
      where: { roomId: created.room.id, status: "ACTIVE" },
    }), 5);

    const hostRows = await db().groupFocusMembership.findMany({
      where: { roomId: created.room.id, role: "HOST" },
    });
    assert.equal(hostRows.length, 1);
    await assertNoStudyCredit(fixture.userIds);
    assert.deepEqual(await readStudySideEffectCounts(), studySideEffectsBefore);
  });
});

test("real PostgreSQL Room creation and close transactions roll back on injected failures", {
  skip: skipped,
}, async () => {
  await withFixture(2, async (fixture) => {
    const [hostId, memberId] = fixture.userIds;
    const [lectureId] = fixture.lectureIds;
    const focus = createService();
    const studySideEffectsBefore = await readStudySideEffectCounts();
    const createIdempotencyKey = `prompt13-create-rollback-${randomUUID()}`;

    await db().$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION prompt13_group_focus_gate.prompt13_fail_host_insert()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        IF NEW."role" = 'HOST' THEN
          RAISE EXCEPTION 'prompt13 forced host membership failure';
        END IF;
        RETURN NEW;
      END;
      $function$;
    `);
    try {
      await db().$executeRawUnsafe(`
        CREATE TRIGGER prompt13_fail_host_insert
        BEFORE INSERT ON prompt13_group_focus_gate."GroupFocusMembership"
        FOR EACH ROW
        EXECUTE FUNCTION prompt13_group_focus_gate.prompt13_fail_host_insert();
      `);
      await assert.rejects(focus.createRoom(
        hostId!,
        createGroupFocusRoomSchema.parse(
          sharedInput(lectureId!, createIdempotencyKey),
        ),
      ));
    } finally {
      await db().$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS prompt13_fail_host_insert
        ON prompt13_group_focus_gate."GroupFocusMembership";
      `);
      await db().$executeRawUnsafe(`
        DROP FUNCTION IF EXISTS prompt13_group_focus_gate.prompt13_fail_host_insert();
      `);
    }
    assert.equal(await db().groupFocusRoom.count({
      where: { hostUserId: hostId!, createIdempotencyKey },
    }), 0);
    assert.equal(await db().groupFocusMembership.count({
      where: { userId: hostId!, role: "HOST" },
    }), 0);

    const room = await focus.createRoom(
      hostId!,
      createGroupFocusRoomSchema.parse(
        studyTogetherInput(lectureId!, `prompt13-close-rollback-${randomUUID()}`),
      ),
    );
    const invite = await focus.rotateInvite(hostId!, room.room.id);
    await focus.joinRoom(memberId!, room.room.id, {
      inviteToken: invite.inviteToken,
      lectureId: lectureId!,
    });
    const roomBeforeClose = await db().groupFocusRoom.findUniqueOrThrow({
      where: { id: room.room.id },
      select: { status: true, closedAt: true, inviteTokenHash: true, inviteVersion: true },
    });
    const membershipsBeforeClose = await db().groupFocusMembership.findMany({
      where: { roomId: room.room.id },
      orderBy: { id: "asc" },
      select: { id: true, status: true, leftAt: true },
    });

    await db().$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION prompt13_group_focus_gate.prompt13_fail_close_memberships()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        IF OLD.status = 'ACTIVE' AND NEW.status = 'LEFT' THEN
          RAISE EXCEPTION 'prompt13 forced close membership failure';
        END IF;
        RETURN NEW;
      END;
      $function$;
    `);
    try {
      await db().$executeRawUnsafe(`
        CREATE TRIGGER prompt13_fail_close_memberships
        BEFORE UPDATE ON prompt13_group_focus_gate."GroupFocusMembership"
        FOR EACH ROW
        EXECUTE FUNCTION prompt13_group_focus_gate.prompt13_fail_close_memberships();
      `);
      await assert.rejects(focus.closeRoom(hostId!, room.room.id));
    } finally {
      await db().$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS prompt13_fail_close_memberships
        ON prompt13_group_focus_gate."GroupFocusMembership";
      `);
      await db().$executeRawUnsafe(`
        DROP FUNCTION IF EXISTS prompt13_group_focus_gate.prompt13_fail_close_memberships();
      `);
    }

    const roomAfterClose = await db().groupFocusRoom.findUniqueOrThrow({
      where: { id: room.room.id },
      select: { status: true, closedAt: true, inviteTokenHash: true, inviteVersion: true },
    });
    const membershipsAfterClose = await db().groupFocusMembership.findMany({
      where: { roomId: room.room.id },
      orderBy: { id: "asc" },
      select: { id: true, status: true, leftAt: true },
    });
    assert.deepEqual(roomAfterClose, roomBeforeClose);
    assert.deepEqual(membershipsAfterClose, membershipsBeforeClose);
    await assertNoStudyCredit(fixture.userIds);
    assert.deepEqual(await readStudySideEffectCounts(), studySideEffectsBefore);
  });
});