import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import express, { type RequestHandler } from "express";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { requestGroupFocusCapability, GroupFocusApiError } from "../src/features/group-focus/api/groupFocusApi.js";
import type { GroupFocusAuthorizationContext } from "../server/features/group-focus/types.js";
import { createGroupFocusRouter } from "../server/routes/groupFocus.js";
import type { GroupFocusService } from "../server/features/group-focus/service.js";
import {
  GROUP_FOCUS_CAPABILITY_AUDIENCE,
  GROUP_FOCUS_CAPABILITY_ISSUER,
  GROUP_FOCUS_CAPABILITY_PURPOSE,
  GROUP_FOCUS_CAPABILITY_VERSION,
} from "../shared/group-focus-capability/contract.js";
import { decodeBase64Url, encodeBase64Url } from "../shared/group-focus-capability/encoding.js";
import {
  getActiveGroupFocusCapabilityKey,
  GroupFocusCapabilityConfigurationError,
  parseGroupFocusCapabilityKeyring,
  type GroupFocusCapabilityEnvironment,
} from "../shared/group-focus-capability/keyring.js";
import { issueGroupFocusCapability } from "../server/features/group-focus/capability.js";
import {
  GroupFocusCapabilityUnauthorizedError,
  GroupFocusCapabilityVerificationError,
  requireGroupFocusCapability,
  verifyGroupFocusCapability,
} from "../cloudflare-group-focus-worker/src/capability.js";

const fixedNow = new Date("2026-09-25T12:00:00.000Z");
const ids = {
  userId: "11111111-1111-4111-8111-111111111111",
  roomId: "22222222-2222-4222-8222-222222222222",
  membershipId: "33333333-3333-4333-8333-333333333333",
  lectureId: "44444444-4444-4444-8444-444444444444",
};

function newKey(): string {
  return randomBytes(32).toString("base64url");
}

const keyA = newKey();
const keyB = newKey();

function issuerEnvironment(
  keys: Record<string, string> = { "test-a": keyA },
  activeKid = "test-a",
) {
  return {
    GROUP_FOCUS_CAPABILITY_KEYS_JSON: JSON.stringify(keys),
    GROUP_FOCUS_CAPABILITY_ACTIVE_KID: activeKid,
  };
}

function workerEnvironment(keys: Record<string, string> = { "test-a": keyA }) {
  return { GROUP_FOCUS_CAPABILITY_KEYS_JSON: JSON.stringify(keys) };
}

function authorizationContext(
  overrides: Partial<GroupFocusAuthorizationContext> = {},
): GroupFocusAuthorizationContext {
  return {
    roomId: ids.roomId,
    membershipId: ids.membershipId,
    userId: ids.userId,
    role: "HOST",
    mode: "SHARED_LECTURE",
    visibility: "PUBLIC",
    effectiveLectureId: ids.lectureId,
    focusDurationSeconds: 2_700,
    breakDurationSeconds: 600,
    roundCount: 4,
    maxParticipants: 12,
    roomUpdatedAt: "2026-09-25T11:00:00.000Z",
    membershipUpdatedAt: "2026-09-25T11:00:00.000Z",
    ...overrides,
  };
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const iat = Math.floor(fixedNow.getTime() / 1000);
  return {
    version: GROUP_FOCUS_CAPABILITY_VERSION,
    iss: GROUP_FOCUS_CAPABILITY_ISSUER,
    aud: GROUP_FOCUS_CAPABILITY_AUDIENCE,
    purpose: GROUP_FOCUS_CAPABILITY_PURPOSE,
    sub: ids.userId,
    roomId: ids.roomId,
    membershipId: ids.membershipId,
    role: "HOST",
    mode: "SHARED_LECTURE",
    visibility: "PUBLIC",
    effectiveLectureId: ids.lectureId,
    focusDurationSeconds: 2_700,
    breakDurationSeconds: 600,
    roundCount: 4,
    maxParticipants: 12,
    roomUpdatedAt: "2026-09-25T11:00:00.000Z",
    membershipUpdatedAt: "2026-09-25T11:00:00.000Z",
    iat,
    nbf: iat,
    exp: iat + 90,
    jti: encodeBase64Url(randomBytes(16)),
    ...overrides,
  };
}

function signToken(
  payload: Record<string, unknown>,
  key = keyA,
  header: Record<string, unknown> = { alg: "HS256", typ: "GF-CAP", kid: "test-a" },
): string {
  const headerSegment = encodeBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadSegment = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signature = createHmac("sha256", Buffer.from(key, "base64url"))
    .update(signingInput, "ascii")
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

function decodeToken(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [headerSegment, payloadSegment] = token.split(".");
  assert.ok(headerSegment);
  assert.ok(payloadSegment);
  const headerBytes = decodeBase64Url(headerSegment);
  const payloadBytes = decodeBase64Url(payloadSegment);
  assert.ok(headerBytes);
  assert.ok(payloadBytes);
  return {
    header: JSON.parse(new TextDecoder().decode(headerBytes)) as Record<string, unknown>,
    payload: JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<string, unknown>,
  };
}

test("keyring parsing is bounded, strict, and requires an explicit active key", () => {
  const valid = issuerEnvironment();
  const parsed = parseGroupFocusCapabilityKeyring(valid.GROUP_FOCUS_CAPABILITY_KEYS_JSON);
  assert.equal(parsed.size, 1);
  assert.equal(parsed.get("test-a")?.byteLength, 32);
  assert.equal(getActiveGroupFocusCapabilityKey(valid).kid, "test-a");

  for (const value of [
    undefined,
    "",
    "{",
    "[]",
    "null",
    JSON.stringify({ "bad kid": keyA }),
    JSON.stringify({ "test-a": "too-short" }),
    JSON.stringify({ "test-a": `${keyA}=` }),
    JSON.stringify({ "test-a": "!" }),
    JSON.stringify({ "test-a": randomBytes(129).toString("base64url") }),
    JSON.stringify({
      a: newKey(),
      b: newKey(),
      c: newKey(),
      d: newKey(),
      e: newKey(),
    }),
  ]) {
    assert.throws(
      () => parseGroupFocusCapabilityKeyring(value),
      GroupFocusCapabilityConfigurationError,
    );
  }
  assert.throws(
    () => getActiveGroupFocusCapabilityKey({
      GROUP_FOCUS_CAPABILITY_KEYS_JSON: valid.GROUP_FOCUS_CAPABILITY_KEYS_JSON,
    }),
    GroupFocusCapabilityConfigurationError,
  );
  assert.throws(
    () => getActiveGroupFocusCapabilityKey({
      ...valid,
      GROUP_FOCUS_CAPABILITY_ACTIVE_KID: "not-present",
    }),
    GroupFocusCapabilityConfigurationError,
  );
});

test("Node issuer creates a compact token verified by the Worker Web Crypto module", async () => {
  const environment = issuerEnvironment();
  const issued = issueGroupFocusCapability(authorizationContext(), environment, fixedNow);
  assert.equal(issued.expiresInSeconds, 90);
  assert.ok(issued.capabilityToken.length < 4 * 1024);
  assert.equal(issued.expiresAt, "2026-09-25T12:01:30.000Z");

  const { header, payload } = decodeToken(issued.capabilityToken);
  assert.deepEqual(header, { alg: "HS256", typ: "GF-CAP", kid: "test-a" });
  assert.equal(payload.sub, ids.userId);
  assert.equal(payload.roomId, ids.roomId);
  assert.equal(payload.membershipId, ids.membershipId);
  assert.equal(payload.effectiveLectureId, ids.lectureId);
  assert.equal(payload.role, "HOST");
  assert.equal(payload.exp, Math.floor(Date.parse(issued.expiresAt) / 1000));
  assert.deepEqual(Object.keys(payload).sort(), [
    "aud",
    "breakDurationSeconds",
    "effectiveLectureId",
    "exp",
    "focusDurationSeconds",
    "iat",
    "iss",
    "jti",
    "maxParticipants",
    "membershipId",
    "membershipUpdatedAt",
    "mode",
    "nbf",
    "purpose",
    "role",
    "roomId",
    "roomUpdatedAt",
    "roundCount",
    "sub",
    "version",
    "visibility",
  ].sort());
  assert.equal("email" in payload, false);
  assert.equal("inviteTokenHash" in payload, false);

  const verified = await verifyGroupFocusCapability(
    issued.capabilityToken,
    workerEnvironment(),
    fixedNow,
  );
  assert.equal(verified.userId, ids.userId);
  assert.equal(verified.roomId, ids.roomId);
  assert.equal(verified.role, "HOST");
  assert.equal(verified.issuedAt, fixedNow.toISOString());
  assert.equal(verified.expiresAt, issued.expiresAt);
  assert.equal("iss" in verified, false);
  assert.equal("kid" in verified, false);
  assert.equal("secret" in verified, false);

  const second = issueGroupFocusCapability(authorizationContext(), environment, fixedNow);
  assert.notEqual(decodeToken(second.capabilityToken).payload.jti, payload.jti);
});

test("key rotation accepts overlap and rejects removed keys", async () => {
  const oldOnly = issuerEnvironment({ "test-a": keyA }, "test-a");
  const oldToken = issueGroupFocusCapability(authorizationContext(), oldOnly, fixedNow);
  const overlap = { "test-a": keyA, "test-b": keyB };
  const newOnlyForIssuer = issuerEnvironment(overlap, "test-b");
  const newToken = issueGroupFocusCapability(
    authorizationContext(),
    newOnlyForIssuer,
    fixedNow,
  );

  const overlapEnvironment = workerEnvironment(overlap);
  assert.equal(
    (await verifyGroupFocusCapability(oldToken.capabilityToken, overlapEnvironment, fixedNow)).userId,
    ids.userId,
  );
  assert.equal(
    decodeToken(newToken.capabilityToken).header.kid,
    "test-b",
  );
  assert.equal(
    (await verifyGroupFocusCapability(newToken.capabilityToken, overlapEnvironment, fixedNow)).userId,
    ids.userId,
  );

  const newKeyOnlyWorker = workerEnvironment({ "test-b": keyB });
  await assert.rejects(
    verifyGroupFocusCapability(oldToken.capabilityToken, newKeyOnlyWorker, fixedNow),
    GroupFocusCapabilityVerificationError,
  );
  assert.equal(
    (await verifyGroupFocusCapability(newToken.capabilityToken, newKeyOnlyWorker, fixedNow)).userId,
    ids.userId,
  );
});

test("payload, header, algorithm, key, issuer, audience, purpose, and version attacks fail closed", async () => {
  const issued = issueGroupFocusCapability(
    authorizationContext(),
    issuerEnvironment(),
    fixedNow,
  ).capabilityToken;
  const [headerSegment, payloadSegment, signatureSegment] = issued.split(".");
  assert.ok(headerSegment && payloadSegment && signatureSegment);

  const originalPayload = decodeToken(issued).payload;
  for (const mutate of [
    (payload: Record<string, unknown>) => { payload.role = "MEMBER"; },
    (payload: Record<string, unknown>) => { payload.effectiveLectureId = ids.roomId; },
    (payload: Record<string, unknown>) => { payload.roomId = ids.lectureId; },
    (payload: Record<string, unknown>) => { payload.maxParticipants = 25; },
  ]) {
    const payload = { ...originalPayload };
    mutate(payload);
    const modified = `${headerSegment}.${encodeBase64Url(
      new TextEncoder().encode(JSON.stringify(payload)),
    )}.${signatureSegment}`;
    await assert.rejects(
      verifyGroupFocusCapability(modified, workerEnvironment(), fixedNow),
      GroupFocusCapabilityVerificationError,
    );
  }

  const originalHeader = decodeToken(issued).header;
  for (const header of [
    { ...originalHeader, alg: "HS384" },
    { ...originalHeader, alg: "HS512" },
    { ...originalHeader, alg: "RS256" },
    { ...originalHeader, alg: "none" },
    { ...originalHeader, typ: "JWT" },
    { ...originalHeader, kid: "unknown" },
    { ...originalHeader, extra: "not-accepted" },
  ]) {
    const modified = `${encodeBase64Url(
      new TextEncoder().encode(JSON.stringify(header)),
    )}.${payloadSegment}.${signatureSegment}`;
    await assert.rejects(
      verifyGroupFocusCapability(modified, workerEnvironment(), fixedNow),
      GroupFocusCapabilityVerificationError,
    );
  }

  await assert.rejects(
    verifyGroupFocusCapability(
      signToken(validClaims(), newKey(), { alg: "HS256", typ: "GF-CAP", kid: "test-a" }),
      workerEnvironment(),
      fixedNow,
    ),
    GroupFocusCapabilityVerificationError,
  );

  for (const claims of [
    validClaims({ aud: "another-service" }),
    validClaims({ iss: "another-issuer" }),
    validClaims({ purpose: "another-purpose" }),
    validClaims({ version: 2 }),
    validClaims({ email: "unexpected@example.test" }),
  ]) {
    await assert.rejects(
      verifyGroupFocusCapability(signToken(claims), workerEnvironment(), fixedNow),
      GroupFocusCapabilityVerificationError,
    );
  }

  const unsignedHeader = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify({ alg: "none", typ: "GF-CAP", kid: "test-a" })),
  );
  await assert.rejects(
    verifyGroupFocusCapability(
      `${unsignedHeader}.${payloadSegment}.eA`,
      workerEnvironment(),
      fixedNow,
    ),
    GroupFocusCapabilityVerificationError,
  );
});

test("time, TTL, enum, identifier, numeric, and timestamp claims are bounded", async () => {
  const env = workerEnvironment();
  const valid = signToken(validClaims());
  assert.equal((await verifyGroupFocusCapability(valid, env, fixedNow)).userId, ids.userId);

  const validPayload = decodeToken(valid).payload;
  const exp = validPayload.exp as number;
  assert.equal(
    (await verifyGroupFocusCapability(valid, env, new Date((exp + 9) * 1000))).userId,
    ids.userId,
  );
  await assert.rejects(
    verifyGroupFocusCapability(valid, env, new Date((exp + 10) * 1000)),
    GroupFocusCapabilityVerificationError,
  );

  const iat = Math.floor(fixedNow.getTime() / 1000);
  const rejectedClaims = [
    validClaims({ iat: iat + 11, nbf: iat + 11, exp: iat + 101 }),
    validClaims({ iat: iat + 11, nbf: iat + 11, exp: iat + 12 }),
    validClaims({ nbf: iat - 1 }),
    validClaims({ exp: iat + 121 }),
    validClaims({ role: "ADMIN" }),
    validClaims({ mode: "UNKNOWN" }),
    validClaims({ visibility: "UNLISTED" }),
    validClaims({ sub: " " }),
    validClaims({ effectiveLectureId: "lecture-1" }),
    validClaims({ focusDurationSeconds: 59 }),
    validClaims({ focusDurationSeconds: 21_601 }),
    validClaims({ breakDurationSeconds: -1 }),
    validClaims({ breakDurationSeconds: 10_801 }),
    validClaims({ roundCount: 0 }),
    validClaims({ roundCount: 21 }),
    validClaims({ maxParticipants: 1 }),
    validClaims({ maxParticipants: 26 }),
    validClaims({ roomUpdatedAt: "not-a-date" }),
    validClaims({ membershipUpdatedAt: "2026-02-30T10:00:00.000Z" }),
    validClaims({ jti: "too-short" }),
    validClaims({ exp: "2026-09-25T12:01:30.000Z" }),
  ];
  for (const claims of rejectedClaims) {
    await assert.rejects(
      verifyGroupFocusCapability(signToken(claims), env, fixedNow),
      GroupFocusCapabilityVerificationError,
    );
  }
});

test("malformed, noncanonical, oversized, and extra-segment compact tokens are rejected", async () => {
  const env = workerEnvironment();
  const malformedTokens = [
    "",
    "one",
    "one.two",
    "one.two.three.four",
    "*.e30.eA",
    "eA==.e30.eA",
    `${encodeBase64Url(new TextEncoder().encode("{"))}.e30.eA`,
    `eA.${encodeBase64Url(new TextEncoder().encode("{}"))}.`,
    "a".repeat(8 * 1024 + 1),
  ];
  for (const token of malformedTokens) {
    await assert.rejects(
      verifyGroupFocusCapability(token, env, fixedNow),
      GroupFocusCapabilityVerificationError,
    );
  }
});

test("Worker bearer helper accepts only a single Authorization bearer value", async () => {
  const token = issueGroupFocusCapability(
    authorizationContext(),
    issuerEnvironment(),
    fixedNow,
  ).capabilityToken;
  const workerEnv = workerEnvironment();
  const accepted = await requireGroupFocusCapability(
    new Request("https://worker.example/room", {
      headers: { authorization: `bEaReR ${token}` },
    }),
    workerEnv,
    fixedNow,
  );
  assert.equal(accepted.userId, ids.userId);

  for (const request of [
    new Request("https://worker.example/room"),
    new Request("https://worker.example/room", {
      headers: { authorization: "Basic abc" },
    }),
    new Request("https://worker.example/room", {
      headers: { authorization: "Bearer " },
    }),
    new Request("https://worker.example/room", {
      headers: { authorization: `Bearer ${token}, Bearer ${token}` },
    }),
    new Request(`https://worker.example/room?token=${encodeURIComponent(token)}`),
  ]) {
    await assert.rejects(
      requireGroupFocusCapability(request, workerEnv, fixedNow),
      GroupFocusCapabilityUnauthorizedError,
    );
  }

  const brokenConfiguration = { GROUP_FOCUS_CAPABILITY_KEYS_JSON: "{}" };
  await assert.rejects(
    requireGroupFocusCapability(
      new Request("https://worker.example/room", {
        headers: { authorization: `Bearer ${token}` },
      }),
      brokenConfiguration,
      fixedNow,
    ),
    GroupFocusCapabilityConfigurationError,
  );
});

test("authenticated capability endpoint uses canonical context and non-cacheable responses", async () => {
  const calls: Array<{ userId: string; roomId: string }> = [];
  const service = {
    getGroupFocusAuthorizationContext: async (userId: string, roomId: string) => {
      calls.push({ userId, roomId });
      return authorizationContext({ userId });
    },
  } as unknown as GroupFocusService;
  const app = express();
  app.use(express.json());
  const requireUser: RequestHandler = (req, res, next) => {
    const authenticatedId = req.header("x-test-user");
    if (!authenticatedId) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    (req as express.Request & { user: { id: string } }).user = { id: authenticatedId };
    next();
  };
  app.use(createGroupFocusRouter({
    requireUser,
    service,
    isEnabled: () => true,
    capabilityEnvironment: () => issuerEnvironment(),
    capabilityNow: () => fixedNow,
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(
      `${baseUrl}/rooms/${encodeURIComponent(ids.roomId)}/capability`,
      { method: "POST", headers: { "x-test-user": ids.userId } },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    assert.equal(response.headers.get("pragma"), "no-cache");
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), [
      "capabilityToken",
      "expiresAt",
      "expiresInSeconds",
    ].sort());
    assert.equal(body.expiresInSeconds, 90);
    assert.deepEqual(calls, [{ userId: ids.userId, roomId: ids.roomId }]);
    const verified = await verifyGroupFocusCapability(
      body.capabilityToken as string,
      workerEnvironment(),
      fixedNow,
    );
    assert.equal(verified.userId, ids.userId);
    assert.equal(verified.role, "HOST");

    const claimOverride = await fetch(
      `${baseUrl}/rooms/${encodeURIComponent(ids.roomId)}/capability`,
      {
        method: "POST",
        headers: {
          "x-test-user": ids.userId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "HOST", effectiveLectureId: ids.roomId }),
      },
    );
    assert.equal(claimOverride.status, 400);
    assert.equal(calls.length, 1);

    const unauthorized = await fetch(
      `${baseUrl}/rooms/${encodeURIComponent(ids.roomId)}/capability`,
      { method: "POST" },
    );
    assert.equal(unauthorized.status, 401);
    assert.equal(calls.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("capability endpoint denies missing canonical context and fails closed on missing config", async () => {
  let lookups = 0;
  const startRouter = async (
    context: GroupFocusAuthorizationContext | null,
    environment: () => GroupFocusCapabilityEnvironment,
  ) => {
    const service = {
      getGroupFocusAuthorizationContext: async () => {
        lookups += 1;
        return context;
      },
    } as unknown as GroupFocusService;
    const app = express();
    app.use(createGroupFocusRouter({
      requireUser: ((req, _res, next) => {
        (req as express.Request & { user: { id: string } }).user = { id: ids.userId };
        next();
      }) as RequestHandler,
      service,
      isEnabled: () => true,
      capabilityEnvironment: environment,
      capabilityNow: () => fixedNow,
    }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address() as AddressInfo;
    return {
      url: `http://127.0.0.1:${address.port}/rooms/${ids.roomId}/capability`,
      close: () => new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      }),
    };
  };

  const denied = await startRouter(null, () => issuerEnvironment());
  try {
    const response = await fetch(denied.url, { method: "POST" });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: "Group Focus Room was not found.",
      code: "ROOM_NOT_FOUND",
    });
  } finally {
    await denied.close();
  }

  const misconfigured = await startRouter(authorizationContext(), () => ({}));
  try {
    const response = await fetch(misconfigured.url, { method: "POST" });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Group Focus capability signing is not configured.",
      code: "CAPABILITY_NOT_CONFIGURED",
    });
  } finally {
    await misconfigured.close();
  }
  assert.equal(lookups, 2);
});

test("disabled capability route returns before authentication and authorization lookup", async () => {
  let authenticationCalls = 0;
  const app = express();
  app.use(createGroupFocusRouter({
    requireUser: ((_req, _res, next) => {
      authenticationCalls += 1;
      next();
    }) as RequestHandler,
    service: {} as never,
    isEnabled: () => false,
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/rooms/${ids.roomId}/capability`,
      { method: "POST" },
    );
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

test("client requests a capability without claim overrides or browser storage", async () => {
  const token = issueGroupFocusCapability(
    authorizationContext(),
    issuerEnvironment(),
    fixedNow,
  );
  let requestedUrl = "";
  let requestInit: RequestInit | undefined;
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify(token), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const result = await requestGroupFocusCapability(ids.roomId, fakeFetch);
  assert.deepEqual(result, token);
  assert.equal(requestedUrl, `/api/group-focus/rooms/${ids.roomId}/capability`);
  assert.equal(requestInit?.method, "POST");
  assert.equal(requestInit?.body, undefined);

  const leakingFetch = (async () => new Response(JSON.stringify({
    ...token,
    signingSecret: "must be rejected",
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  await assert.rejects(
    requestGroupFocusCapability(ids.roomId, leakingFetch),
    (error: unknown) => error instanceof GroupFocusApiError
      && error.code === "INVALID_RESPONSE",
  );

  for (const invalidPayload of [
    { ...token, expiresAt: "2026" },
    { ...token, expiresInSeconds: 121 },
    { ...token, capabilityToken: "x".repeat(8 * 1024 + 1) },
  ]) {
    const invalidFetch = (async () => new Response(JSON.stringify(invalidPayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
    await assert.rejects(
      requestGroupFocusCapability(ids.roomId, invalidFetch),
      (error: unknown) => error instanceof GroupFocusApiError
        && error.code === "INVALID_RESPONSE",
    );
  }

  const source = await readFile(
    new URL("../src/features/group-focus/api/groupFocusApi.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|indexedDB)\b/u);
});