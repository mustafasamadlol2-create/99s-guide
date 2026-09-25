import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express, { type RequestHandler } from "express";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  createGroupFocusRoomSchema,
  joinGroupFocusRoomSchema,
} from "../server/features/group-focus/schemas.js";
import { createGroupFocusService } from "../server/features/group-focus/service.js";
import {
  createGroupFocusJsonParser,
  createGroupFocusRouter,
} from "../server/routes/groupFocus.js";
import {
  GroupFocusApiError,
  joinGroupFocusRoom,
  type GroupFocusMembershipDto,
  type GroupFocusRoomDto,
} from "../src/features/group-focus/api/groupFocusApi.js";

const lectureId = "11111111-1111-4111-8111-111111111111";
const roomId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const schemaSource = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migrationSource = await readFile(
  new URL("../prisma/migrations/20260925010000_group_focus_canonical_rooms/migration.sql", import.meta.url),
  "utf8",
);

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: "  Histology Focus  ",
    visibility: "PUBLIC",
    mode: "SHARED_LECTURE",
    sharedLectureId: lectureId,
    focusDurationSeconds: 2_700,
    breakDurationSeconds: 600,
    roundCount: 4,
    idempotencyKey: "prompt13-create-001",
    ...overrides,
  };
}

test("Group Focus schemas enforce bounded canonical room configuration", () => {
  const parsed = createGroupFocusRoomSchema.parse(createPayload());
  assert.equal(parsed.name, "Histology Focus");
  assert.equal(parsed.maxParticipants, 12);

  assert.equal(createGroupFocusRoomSchema.safeParse(createPayload({
    name: " \t ",
  })).success, false);
  assert.equal(createGroupFocusRoomSchema.safeParse(createPayload({
    name: "x".repeat(101),
  })).success, false);
  assert.equal(createGroupFocusRoomSchema.safeParse(createPayload({
    maxParticipants: 1,
  })).success, false);
  assert.equal(createGroupFocusRoomSchema.safeParse(createPayload({
    maxParticipants: 26,
  })).success, false);
  assert.equal(createGroupFocusRoomSchema.safeParse(createPayload({
    roundCount: 21,
  })).success, false);
  assert.equal(createGroupFocusRoomSchema.safeParse(createPayload({
    mode: "STUDY_TOGETHER",
    sharedLectureId: undefined,
  })).success, false);
  assert.equal(createGroupFocusRoomSchema.safeParse(createPayload({
    mode: "STUDY_TOGETHER",
    sharedLectureId: undefined,
    hostLectureId: lectureId,
  })).success, true);
  assert.equal(createGroupFocusRoomSchema.safeParse(createPayload({
    hostUserId: userId,
  })).success, false);
  assert.equal(createGroupFocusRoomSchema.safeParse(createPayload({
    role: "HOST",
  })).success, false);
  assert.equal(createGroupFocusRoomSchema.safeParse(createPayload({
    status: "CLOSED",
  })).success, false);
  assert.equal(joinGroupFocusRoomSchema.safeParse({
    inviteToken: "a".repeat(15),
  }).success, false);
  assert.equal(joinGroupFocusRoomSchema.safeParse({
    inviteToken: "a".repeat(24),
    hostUserId: userId,
  }).success, false);
});

test("canonical schema migration adds only rooms and memberships with private invite hashes", () => {
  assert.match(schemaSource, /model GroupFocusRoom \{/u);
  assert.match(schemaSource, /model GroupFocusMembership \{/u);
  assert.doesNotMatch(schemaSource, /model GroupFocus(?:Presence|Message|Runtime|Chat)\b/u);
  assert.equal((migrationSource.match(/CREATE TABLE /gu) ?? []).length, 2);
  assert.match(migrationSource, /CREATE TABLE "GroupFocusRoom"/u);
  assert.match(migrationSource, /CREATE TABLE "GroupFocusMembership"/u);
  assert.match(schemaSource, /@@unique\(\[hostUserId, createIdempotencyKey\]\)/u);
  assert.match(migrationSource, /"inviteTokenHash" TEXT/u);
  assert.doesNotMatch(migrationSource, /"inviteToken" TEXT/u);
  assert.match(schemaSource, /@@index\(\[visibility, status, createdAt\]\)/u);
  assert.match(schemaSource, /@@index\(\[roomId, status\]\)/u);
  assert.match(schemaSource, /@@unique\(\[roomId, userId\]\)/u);
  assert.doesNotMatch(migrationSource, /DROP (?:TABLE|INDEX|COLUMN)/u);
  assert.match(migrationSource, /REFERENCES "Lecture"\("id"\)/u);
});

test("disabled Group Focus routes return before authentication or service access", async () => {
  let authenticationCalls = 0;
  const requireUser: RequestHandler = (_req, _res, next) => {
    authenticationCalls += 1;
    next();
  };
  const app = express();
  app.use(createGroupFocusRouter({
    requireUser,
    service: {} as never,
    isEnabled: () => false,
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/rooms/public`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: "Group Focus is not available.",
      code: "FEATURE_DISABLED",
    });
    assert.equal(authenticationCalls, 0);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("Group Focus body parser rejects payloads above 32 KiB", async () => {
  let authenticationCalls = 0;
  const requireUser: RequestHandler = (_req, _res, next) => {
    authenticationCalls += 1;
    next();
  };
  const app = express();
  app.use("/api/group-focus", createGroupFocusJsonParser());
  app.use("/api/group-focus", createGroupFocusRouter({
    requireUser,
    service: {} as never,
    isEnabled: () => false,
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/group-focus/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(33 * 1024) }),
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), {
      error: "Group Focus request is too large.",
      code: "REQUEST_TOO_LARGE",
    });
    assert.equal(authenticationCalls, 0);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("disabled authorization-context lookup avoids all PostgreSQL access", async () => {
  const noDatabaseAccess = new Proxy({}, {
    get() {
      throw new Error("Unexpected Group Focus database access.");
    },
  }) as PrismaClient;
  const service = createGroupFocusService({
    prisma: noDatabaseAccess,
    isEnabled: () => false,
  });
  await assert.rejects(
    service.listPublicRooms({ limit: 20 }),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "FEATURE_DISABLED",
  );
  assert.equal(await service.getGroupFocusAuthorizationContext(userId, roomId), null);
});

test("private Room member listing hides existence from non-members", async () => {
  const prisma = {
    groupFocusRoom: {
      findUnique: async () => ({ id: roomId, visibility: "PRIVATE" }),
    },
    groupFocusMembership: {
      findUnique: async () => null,
    },
  } as unknown as PrismaClient;
  const service = createGroupFocusService({
    prisma,
    isEnabled: () => true,
  });

  await assert.rejects(
    service.listRoomMembers(userId, roomId),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "ROOM_NOT_FOUND",
  );
});

test("typed client keeps private invite tokens in the request body", async () => {
  const room: GroupFocusRoomDto = {
    id: roomId,
    name: "Private Histology",
    visibility: "PRIVATE",
    mode: "SHARED_LECTURE",
    sharedLectureId: lectureId,
    focusDurationSeconds: 2_700,
    breakDurationSeconds: 600,
    roundCount: 4,
    maxParticipants: 12,
    participantCount: 2,
    status: "OPEN",
    createdAt: "2026-09-25T10:00:00.000Z",
    updatedAt: "2026-09-25T10:00:00.000Z",
    closedAt: null,
  };
  const membership: GroupFocusMembershipDto = {
    membershipId: "44444444-4444-4444-8444-444444444444",
    roomId,
    userId,
    role: "MEMBER",
    status: "ACTIVE",
    selectedLectureId: null,
    joinedAt: "2026-09-25T10:00:00.000Z",
    leftAt: null,
    createdAt: "2026-09-25T10:00:00.000Z",
    updatedAt: "2026-09-25T10:00:00.000Z",
  };
  let requestedUrl = "";
  let sentBody: Record<string, unknown> = {};
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl = String(input);
    sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ room, membership }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const token = "private-token-must-not-appear-in-url";
  const result = await joinGroupFocusRoom(
    roomId,
    { inviteToken: token },
    fakeFetch,
  );
  assert.equal(result.room.id, roomId);
  assert.equal(sentBody.inviteToken, token);
  assert.equal(requestedUrl.includes(token), false);
  assert.equal(requestedUrl.includes("?"), false);

  const leakingFetch = (async () => new Response(JSON.stringify({
    room: { ...room, inviteTokenHash: "private hash" },
    membership,
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  await assert.rejects(
    joinGroupFocusRoom(roomId, {}, leakingFetch),
    (error: unknown) => error instanceof GroupFocusApiError
      && error.code === "INVALID_RESPONSE",
  );
});