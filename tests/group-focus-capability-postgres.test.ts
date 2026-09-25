import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import express, { type RequestHandler } from "express";
import test, { after, before } from "node:test";
import type { AddressInfo } from "node:net";
import type { PrismaClient } from "@prisma/client";
import { createGroupFocusRoomSchema } from "../server/features/group-focus/schemas.js";
import type { GroupFocusService } from "../server/features/group-focus/service.js";
import {
  createGroupFocusJsonParser,
  createGroupFocusRouter,
} from "../server/routes/groupFocus.js";
import { verifyGroupFocusCapability } from "../cloudflare-group-focus-worker/src/capability.js";
import { getPrompt14GroupFocusPostgresGateUrl } from "./helpers/prompt14GroupFocusPostgresGate.js";

const databaseUrl = getPrompt14GroupFocusPostgresGateUrl();
const skipped = databaseUrl
  ? false
  : "Set the explicit Prompt 14 disposable-schema PostgreSQL gate to run.";
const fixedTime = new Date("2026-09-25T12:00:00.000Z");

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

function createService(now: () => Date): GroupFocusService {
  return makeService({
    prisma: db(),
    now,
    isEnabled: () => true,
  });
}

async function createFixture(userCount = 5): Promise<Fixture> {
  const suffix = randomUUID();
  const users = await Promise.all(
    Array.from({ length: userCount }, (_, index) => db().user.create({
      data: { email: `prompt14-group-focus-${index}-${suffix}@example.test` },
      select: { id: true },
    })),
  );
  const lectures = await Promise.all([
    db().lecture.create({
      data: {
        name: "Prompt 14 Shared Lecture",
        mainSubject: "Capability verification",
        trackMode: "test",
      },
      select: { id: true },
    }),
    db().lecture.create({
      data: {
        name: "Prompt 14 Alternate Lecture",
        mainSubject: "Capability verification",
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
  run: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const fixture = await createFixture();
  try {
    await run(fixture);
  } finally {
    await removeFixture(fixture);
  }
}

async function createRoom(
  service: GroupFocusService,
  userId: string,
  lectureId: string,
  mode: "SHARED_LECTURE" | "STUDY_TOGETHER",
  visibility: "PUBLIC" | "PRIVATE" = "PUBLIC",
) {
  const input = mode === "SHARED_LECTURE"
    ? {
      name: "Prompt 14 Shared Room",
      visibility,
      mode,
      sharedLectureId: lectureId,
      focusDurationSeconds: 2_700,
      breakDurationSeconds: 600,
      roundCount: 4,
      maxParticipants: 12,
      idempotencyKey: `prompt14-room-${randomUUID()}`,
    }
    : {
      name: "Prompt 14 Study Together Room",
      visibility,
      mode,
      hostLectureId: lectureId,
      focusDurationSeconds: 2_700,
      breakDurationSeconds: 600,
      roundCount: 4,
      maxParticipants: 12,
      idempotencyKey: `prompt14-room-${randomUUID()}`,
    };
  return service.createRoom(userId, createGroupFocusRoomSchema.parse(input));
}

async function startApi(
  service: GroupFocusService,
  capabilityEnvironment: () => {
    GROUP_FOCUS_CAPABILITY_KEYS_JSON?: string;
    GROUP_FOCUS_CAPABILITY_ACTIVE_KID?: string;
  },
  capabilityNow: () => Date,
): Promise<RunningApi> {
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
    capabilityEnvironment,
    capabilityNow,
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

async function readReadOnlySnapshot() {
  const [
    rooms,
    memberships,
    focusSessions,
    studyEvents,
    metrics,
    points,
    calendarEvents,
    outbox,
  ] = await Promise.all([
    db().groupFocusRoom.findMany({
      orderBy: { id: "asc" },
      select: { id: true, status: true, updatedAt: true, closedAt: true },
    }),
    db().groupFocusMembership.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        roomId: true,
        userId: true,
        role: true,
        status: true,
        selectedLectureId: true,
        updatedAt: true,
      },
    }),
    db().focusSession.count(),
    db().studyEvent.count(),
    db().studyDailyMetric.count(),
    db().pointsLog.count(),
    db().calendarEvent.count(),
    db().$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "PrivateD1SyncOutbox"
    `,
  ]);
  return {
    rooms,
    memberships,
    focusSessions,
    studyEvents,
    metrics,
    points,
    calendarEvents,
    outbox: Number(outbox[0]?.count ?? 0n),
  };
}

async function callCapability(
  api: RunningApi,
  userId: string,
  roomId: string,
): Promise<Response> {
  const before = await readReadOnlySnapshot();
  const response = await fetch(
    `${api.baseUrl}/api/group-focus/rooms/${encodeURIComponent(roomId)}/capability`,
    {
      method: "POST",
      headers: { "x-test-user": userId },
    },
  );
  assert.deepEqual(await readReadOnlySnapshot(), before);
  return response;
}

async function assertDenied(
  api: RunningApi,
  userId: string,
  roomId: string,
): Promise<void> {
  const response = await callCapability(api, userId, roomId);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Group Focus Room was not found.",
    code: "ROOM_NOT_FOUND",
  });
}

test("real PostgreSQL issuance follows canonical authorization and has no study/presence side effects", {
  skip: skipped,
}, async () => {
  if (!databaseUrl) return;
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = databaseUrl;
  process.env.SUPABASE_DATABASE_URL = "";

  await withFixture(async (fixture) => {
    const [hostId, memberId, leftId, removedId, outsiderId] = fixture.userIds;
    assert.ok(hostId && memberId && leftId && removedId && outsiderId);
    const [sharedLectureId, alternateLectureId] = fixture.lectureIds;
    assert.ok(sharedLectureId && alternateLectureId);

    const time = { current: new Date(fixedTime) };
    const service = createService(() => new Date(time.current));
    const sharedRoom = await createRoom(service, hostId, sharedLectureId, "SHARED_LECTURE");
    await service.joinRoom(memberId, sharedRoom.room.id, {});
    await service.joinRoom(leftId, sharedRoom.room.id, {});
    await service.joinRoom(removedId, sharedRoom.room.id, {});

    const studyTogetherRoom = await createRoom(
      service,
      hostId,
      sharedLectureId,
      "STUDY_TOGETHER",
      "PRIVATE",
    );
    const studyTogetherInvite = await service.rotateInvite(
      hostId,
      studyTogetherRoom.room.id,
    );
    await service.joinRoom(memberId, studyTogetherRoom.room.id, {
      inviteToken: studyTogetherInvite.inviteToken,
      lectureId: alternateLectureId,
    });

    await db().user.update({
      where: { id: outsiderId },
      data: { role: "admin", isPrimaryOwner: false },
    });

    const keys = {
      "test-old": randomBytes(32).toString("base64url"),
      "test-new": randomBytes(32).toString("base64url"),
    };
    const capabilityEnvironment = () => ({
      GROUP_FOCUS_CAPABILITY_KEYS_JSON: JSON.stringify(keys),
      GROUP_FOCUS_CAPABILITY_ACTIVE_KID: "test-old",
    });
    const workerEnvironment = () => ({
      GROUP_FOCUS_CAPABILITY_KEYS_JSON: JSON.stringify(keys),
    });
    const api = await startApi(
      service,
      capabilityEnvironment,
      () => new Date(time.current),
    );
    try {
      const unauthenticated = await fetch(
        `${api.baseUrl}/api/group-focus/rooms/${encodeURIComponent(sharedRoom.room.id)}/capability`,
        { method: "POST" },
      );
      assert.equal(unauthenticated.status, 401);

      const hostResponse = await callCapability(api, hostId, sharedRoom.room.id);
      assert.equal(hostResponse.status, 200);
      const hostBody = await hostResponse.json() as {
        capabilityToken: string;
        expiresAt: string;
        expiresInSeconds: number;
      };
      assert.equal(hostBody.expiresInSeconds, 90);
      assert.ok(hostBody.capabilityToken.length < 4 * 1024);
      const hostClaims = await verifyGroupFocusCapability(
        hostBody.capabilityToken,
        workerEnvironment(),
        time.current,
      );
      assert.equal(hostClaims.userId, hostId);
      assert.equal(hostClaims.role, "HOST");
      assert.equal(hostClaims.effectiveLectureId, sharedLectureId);

      const memberResponse = await callCapability(api, memberId, sharedRoom.room.id);
      assert.equal(memberResponse.status, 200);
      const memberBody = await memberResponse.json() as {
        capabilityToken: string;
        expiresAt: string;
      };
      const memberClaims = await verifyGroupFocusCapability(
        memberBody.capabilityToken,
        workerEnvironment(),
        time.current,
      );
      assert.equal(memberClaims.userId, memberId);
      assert.equal(memberClaims.role, "MEMBER");
      assert.equal(memberClaims.membershipId, (await db().groupFocusMembership.findUniqueOrThrow({
        where: { roomId_userId: { roomId: sharedRoom.room.id, userId: memberId } },
        select: { id: true },
      })).id);
      assert.equal(memberClaims.effectiveLectureId, sharedLectureId);

      const studyHostResponse = await callCapability(
        api,
        hostId,
        studyTogetherRoom.room.id,
      );
      assert.equal(studyHostResponse.status, 200);
      const studyHostBody = await studyHostResponse.json() as { capabilityToken: string };
      const studyHostClaims = await verifyGroupFocusCapability(
        studyHostBody.capabilityToken,
        workerEnvironment(),
        time.current,
      );
      assert.equal(studyHostClaims.mode, "STUDY_TOGETHER");
      assert.equal(studyHostClaims.effectiveLectureId, sharedLectureId);

      const studyMemberResponse = await callCapability(
        api,
        memberId,
        studyTogetherRoom.room.id,
      );
      assert.equal(studyMemberResponse.status, 200);
      const studyMemberBody = await studyMemberResponse.json() as { capabilityToken: string };
      const oldLectureClaims = await verifyGroupFocusCapability(
        studyMemberBody.capabilityToken,
        workerEnvironment(),
        time.current,
      );
      assert.equal(oldLectureClaims.role, "MEMBER");
      assert.equal(oldLectureClaims.effectiveLectureId, alternateLectureId);
      await assertDenied(api, outsiderId, studyTogetherRoom.room.id);

      time.current = new Date(fixedTime.getTime() + 1_000);
      await service.updateMyLecture(memberId, studyTogetherRoom.room.id, sharedLectureId);
      const refreshedStudyResponse = await callCapability(
        api,
        memberId,
        studyTogetherRoom.room.id,
      );
      assert.equal(refreshedStudyResponse.status, 200);
      const refreshedStudyBody = await refreshedStudyResponse.json() as {
        capabilityToken: string;
      };
      const refreshedStudyClaims = await verifyGroupFocusCapability(
        refreshedStudyBody.capabilityToken,
        workerEnvironment(),
        time.current,
      );
      assert.equal(refreshedStudyClaims.effectiveLectureId, sharedLectureId);
      assert.equal(
        (await verifyGroupFocusCapability(
          studyMemberBody.capabilityToken,
          workerEnvironment(),
          time.current,
        )).effectiveLectureId,
        alternateLectureId,
      );

      const removedMemberResponse = await callCapability(api, removedId, sharedRoom.room.id);
      assert.equal(removedMemberResponse.status, 200);
      const removedMemberBody = await removedMemberResponse.json() as {
        capabilityToken: string;
        expiresAt: string;
      };
      assert.equal(
        (await verifyGroupFocusCapability(
          removedMemberBody.capabilityToken,
          workerEnvironment(),
          time.current,
        )).role,
        "MEMBER",
      );

      await service.leaveRoom(leftId, sharedRoom.room.id);
      await assertDenied(api, leftId, sharedRoom.room.id);
      await service.removeMember(hostId, sharedRoom.room.id, removedId);
      await assertDenied(api, removedId, sharedRoom.room.id);

      time.current = new Date(fixedTime.getTime() + 5_000);
      assert.equal(
        (await verifyGroupFocusCapability(
          removedMemberBody.capabilityToken,
          workerEnvironment(),
          time.current,
        )).userId,
        removedId,
      );
      time.current = new Date(Date.parse(removedMemberBody.expiresAt) + 11_000);
      await assert.rejects(
        verifyGroupFocusCapability(
          removedMemberBody.capabilityToken,
          workerEnvironment(),
          time.current,
        ),
      );

      await assertDenied(api, outsiderId, sharedRoom.room.id);
      await assert.equal(
        await db().groupFocusMembership.findUnique({
          where: { roomId_userId: { roomId: sharedRoom.room.id, userId: outsiderId } },
        }),
        null,
      );

      await service.closeRoom(hostId, studyTogetherRoom.room.id);
      await assertDenied(api, hostId, studyTogetherRoom.room.id);
      await assertDenied(api, memberId, studyTogetherRoom.room.id);

      await db().user.update({
        where: { id: outsiderId },
        data: { role: "owner", isPrimaryOwner: true },
      });
      await assertDenied(api, outsiderId, sharedRoom.room.id);
    } finally {
      await api.close();
    }
  });
});

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