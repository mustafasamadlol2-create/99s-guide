import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  GROUP_FOCUS_CAPABILITY_ALGORITHM,
  GROUP_FOCUS_CAPABILITY_AUDIENCE,
  GROUP_FOCUS_CAPABILITY_ISSUER,
  GROUP_FOCUS_CAPABILITY_PURPOSE,
  GROUP_FOCUS_CAPABILITY_TYP,
  GROUP_FOCUS_CAPABILITY_VERSION,
  type GroupFocusCapabilityMode,
  type GroupFocusCapabilityRole,
  type GroupFocusCapabilityVisibility,
} from "../shared/group-focus-capability/contract.js";
import { GROUP_FOCUS_REALTIME_PROTOCOL } from "../shared/group-focus-realtime/protocol.js";

type TokenOptions = {
  roomId: string;
  userId?: string;
  membershipId?: string;
  role?: GroupFocusCapabilityRole;
  mode?: GroupFocusCapabilityMode;
  visibility?: GroupFocusCapabilityVisibility;
  focusDurationSeconds?: number;
  breakDurationSeconds?: number;
  roundCount?: number;
  maxParticipants?: number;
  roomUpdatedAt?: string;
};

type ServerMessage = {
  v: 1;
  type: string;
  revision: number;
  serverNow: number;
  payload: Record<string, unknown>;
};

class MessageQueue {
  private readonly messages: ServerMessage[] = [];
  private readonly waiters: Array<{
    type: string;
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        this.push(message);
      } catch {
        // Invalid messages stay visible as a test failure through a timeout.
      }
    });
  }

  next(
    type: string,
    predicate: (message: ServerMessage) => boolean = () => true,
    timeoutMs = 10_000,
  ): Promise<ServerMessage> {
    const index = this.messages.findIndex((message) =>
      message.type === type && predicate(message));
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]!);
    return new Promise((resolve, reject) => {
      const waiter = {
        type,
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          const position = this.waiters.indexOf(waiter);
          if (position >= 0) this.waiters.splice(position, 1);
          reject(new Error(`Timed out waiting for ${type}.`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  private push(message: ServerMessage): void {
    const index = this.waiters.findIndex((waiter) =>
      waiter.type === message.type && waiter.predicate(message));
    if (index < 0) {
      this.messages.push(message);
      return;
    }
    const waiter = this.waiters.splice(index, 1)[0]!;
    clearTimeout(waiter.timer);
    waiter.resolve(message);
  }
}

function createToken(
  key: Buffer,
  options: TokenOptions,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: GROUP_FOCUS_CAPABILITY_ALGORITHM,
    typ: GROUP_FOCUS_CAPABILITY_TYP,
    kid: "test-a",
  };
  const payload = {
    version: GROUP_FOCUS_CAPABILITY_VERSION,
    iss: GROUP_FOCUS_CAPABILITY_ISSUER,
    aud: GROUP_FOCUS_CAPABILITY_AUDIENCE,
    purpose: GROUP_FOCUS_CAPABILITY_PURPOSE,
    sub: options.userId ?? randomUUID(),
    roomId: options.roomId,
    membershipId: options.membershipId ?? randomUUID(),
    role: options.role ?? "MEMBER",
    mode: options.mode ?? "STUDY_TOGETHER",
    visibility: options.visibility ?? "PUBLIC",
    effectiveLectureId: randomUUID(),
    focusDurationSeconds: options.focusDurationSeconds ?? 60,
    breakDurationSeconds: options.breakDurationSeconds ?? 0,
    roundCount: options.roundCount ?? 2,
    maxParticipants: options.maxParticipants ?? 4,
    roomUpdatedAt: options.roomUpdatedAt ?? new Date((now - 1) * 1000).toISOString(),
    membershipUpdatedAt: new Date((now - 1) * 1000).toISOString(),
    iat: now,
    nbf: now,
    exp: now + 90,
    jti: randomBytes(16).toString("base64url"),
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", key)
    .update(signingInput, "ascii")
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

type LocalWorker = {
  baseUrl: URL;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not allocate a local Worker test port.");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

async function withLocalWorker(
  run: (context: {
    worker: LocalWorker;
    key: Buffer;
    baseUrl: URL;
  }) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "99s-group-focus-worker-"));
  const persistencePath = join(directory, "state");
  const key = randomBytes(32);
  const keyring = JSON.stringify({ "test-a": key.toString("base64url") });
  const baseUrl = new URL(`http://127.0.0.1:${await unusedPort()}`);
  let child: ChildProcessWithoutNullStreams | null = null;
  let childOutput = "";

  const stop = async (): Promise<void> => {
    const running = child;
    child = null;
    if (!running || running.exitCode !== null || running.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const forceKill = setTimeout(() => {
        running.kill("SIGKILL");
      }, 5_000);
      running.once("exit", () => {
        clearTimeout(forceKill);
        resolve();
      });
      running.kill("SIGTERM");
    });
  };

  const start = async (): Promise<void> => {
    if (child && child.exitCode === null && child.signalCode === null) return;
    childOutput = "";
    let spawnError: Error | null = null;
    child = spawn(process.execPath, [
      resolve("node_modules/wrangler/bin/wrangler.js"),
      "dev",
      "--config",
      resolve("cloudflare-group-focus-worker/wrangler.jsonc"),
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(Number(baseUrl.port)),
      "--persist-to",
      persistencePath,
      "--var",
      `GROUP_FOCUS_CAPABILITY_KEYS_JSON:${keyring}`,
      "--log-level",
      "error",
    ], {
      cwd: process.cwd(),
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.once("error", (error) => {
      spawnError = error;
    });
    const capture = (chunk: Buffer): void => {
      childOutput = `${childOutput}${chunk.toString("utf8")}`.slice(-8_000);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (spawnError) throw new Error(`Could not start local Wrangler: ${spawnError.message}`);
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Local Wrangler exited before becoming ready.\n${childOutput}`);
      }
      try {
        const response = await fetch(new URL("/health", baseUrl));
        if (response.ok) return;
      } catch {
        // The local server is still starting.
      }
      await delay(100);
    }
    await stop();
    throw new Error(`Local Wrangler did not become ready.\n${childOutput}`);
  };

  const worker: LocalWorker = { baseUrl, start, stop };
  try {
    await run({ worker, key, baseUrl });
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
}

function workerWebSocketUrl(baseUrl: URL, roomId: string): string {
  const url = new URL(`/rooms/${roomId}/connect`, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function connect(
  baseUrl: URL,
  roomId: string,
  token: string,
  resumeToken?: string,
): { socket: WebSocket; messages: MessageQueue; opened: Promise<void> } {
  const protocols = [GROUP_FOCUS_REALTIME_PROTOCOL, `gf-auth.${token}`];
  if (resumeToken) protocols.push(`gf-resume.${resumeToken}`);
  const socket = new WebSocket(
    workerWebSocketUrl(baseUrl, roomId),
    protocols,
  );
  const messages = new MessageQueue(socket);
  const opened = new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket handshake failed.")), {
      once: true,
    });
    socket.addEventListener("close", () => reject(new Error("WebSocket closed before opening.")), {
      once: true,
    });
  });
  return { socket, messages, opened };
}

async function dispatchUpgrade(
  worker: LocalWorker,
  roomId: string,
  protocols: string,
  query = "",
  authorization?: string,
): Promise<{ status: number; json: () => Record<string, unknown> }> {
  const url = new URL(`/rooms/${roomId}/connect${query}`, worker.baseUrl);
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      method: "GET",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Protocol": protocols,
        ...(authorization ? { Authorization: authorization } : {}),
      },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          json: () => JSON.parse(body) as Record<string, unknown>,
        });
      });
    });
    request.once("upgrade", (response, socket) => {
      socket.destroy();
      resolve({
        status: response.statusCode ?? 0,
        json: () => ({}),
      });
    });
    request.once("error", reject);
    request.end();
  });
}

function roomPhase(message: ServerMessage): unknown {
  const roomState = message.payload.roomState;
  return typeof roomState === "object" && roomState !== null
    ? (roomState as Record<string, unknown>).phase
    : undefined;
}

test("local workerd enforces capability admission, presence, commands, and alarm transitions", {
  timeout: 30_000,
}, async () => {
  await withLocalWorker(async ({ worker, key, baseUrl }) => {
    await worker.start();
    const roomId = randomUUID();
    const hostId = randomUUID();
    const hostToken = createToken(key, {
      roomId,
      userId: hostId,
      role: "HOST",
      maxParticipants: 2,
    });
    const memberToken = createToken(key, {
      roomId,
      role: "MEMBER",
      maxParticipants: 2,
    });

    const health = await fetch(new URL("/health", baseUrl));
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });

    const queryTokenResponse = await dispatchUpgrade(
      worker,
      roomId,
      `gf-v1, gf-auth.${hostToken}`,
      "?token=forbidden",
    );
    assert.equal(queryTokenResponse.status, 400);
    assert.equal((await queryTokenResponse.json()).code, "QUERY_CREDENTIALS_NOT_SUPPORTED");

    const invalidTokenResponse = await dispatchUpgrade(
      worker,
      roomId,
      "gf-v1, gf-auth.invalid.invalid.invalid",
    );
    assert.equal(invalidTokenResponse.status, 401);

    const wrongRoom = randomUUID();
    const wrongRoomToken = createToken(key, { roomId: wrongRoom });
    const mismatchResponse = await dispatchUpgrade(
      worker,
      roomId,
      `gf-v1, gf-auth.${wrongRoomToken}`,
    );
    assert.equal(mismatchResponse.status, 403);
    assert.equal((await mismatchResponse.json()).code, "ROOM_CAPABILITY_MISMATCH");

    const ambiguousResponse = await dispatchUpgrade(
      worker,
      roomId,
      `gf-v1, gf-auth.${hostToken}`,
      "",
      `Bearer ${hostToken}`,
    );
    assert.equal(ambiguousResponse.status, 400);
    assert.equal((await ambiguousResponse.json()).code, "AMBIGUOUS_CREDENTIALS");

    const host = connect(baseUrl, roomId, hostToken);
    const member = connect(baseUrl, roomId, memberToken);
    await Promise.all([host.opened, member.opened]);
    assert.equal(host.socket.protocol, "gf-v1");
    assert.equal(member.socket.protocol, "gf-v1");

    const hostConnected = await host.messages.next("CONNECTED");
    assert.equal(hostConnected.payload.userId, hostId);
    assert.equal(hostConnected.payload.role, "HOST");
    assert.equal(hostConnected.payload.roomId, roomId);
    assert.equal(typeof hostConnected.payload.connectionId, "string");
    assert.equal(host.socket.protocol.includes("gf-auth."), false);
    await host.messages.next("ROOM_STATE");
    const hostPresence = await host.messages.next("PRESENCE_SNAPSHOT");
    const presenceFields = Object.keys(
      (hostPresence.payload.participants as Record<string, unknown>[])[0]!,
    ).sort();
    assert.deepEqual(presenceFields, [
      "connectedAt",
      "connectionState",
      "effectiveLectureId",
      "role",
      "userId",
    ]);
    await member.messages.next("CONNECTED");
    await member.messages.next("ROOM_STATE");
    const memberPresence = await member.messages.next("PRESENCE_SNAPSHOT");
    assert.equal((memberPresence.payload.participants as unknown[]).length, 2);
    await host.messages.next("PRESENCE_JOINED");

    await delay(100);
    member.socket.send(JSON.stringify({ v: 1, type: "ROOM_STATE_REQUEST" }));
    await member.messages.next("ROOM_STATE");

    const duplicateResponse = await dispatchUpgrade(
      worker,
      roomId,
      `gf-v1, gf-auth.${hostToken}`,
    );
    assert.equal(duplicateResponse.status, 409);
    assert.equal((await duplicateResponse.json()).code, "RESUME_REQUIRED");

    const thirdToken = createToken(key, {
      roomId,
      maxParticipants: 2,
    });
    const capacityResponse = await dispatchUpgrade(
      worker,
      roomId,
      `gf-v1, gf-auth.${thirdToken}`,
    );
    assert.equal(capacityResponse.status, 409);
    assert.equal((await capacityResponse.json()).code, "ROOM_CAPACITY_REACHED");

    const inconsistentToken = createToken(key, {
      roomId,
      focusDurationSeconds: 120,
      maxParticipants: 2,
    });
    const inconsistentResponse = await dispatchUpgrade(
      worker,
      roomId,
      `gf-v1, gf-auth.${inconsistentToken}`,
    );
    assert.equal(inconsistentResponse.status, 409);
    assert.equal((await inconsistentResponse.json()).code, "ROOM_CONFIGURATION_MISMATCH");

    for (const type of ["HOST_START", "HOST_PAUSE", "HOST_RESUME", "HOST_CLOSE"]) {
      member.socket.send(JSON.stringify({ v: 1, type }));
      const memberHostError = await member.messages.next("ERROR");
      assert.equal(memberHostError.payload.code, "NOT_ROOM_HOST", type);
    }

    member.socket.send("x".repeat(16 * 1024 + 1));
    const oversizedError = await member.messages.next("ERROR");
    assert.equal(oversizedError.payload.code, "MESSAGE_TOO_LARGE");

    host.socket.send(JSON.stringify({ v: 1, type: "HOST_START" }));
    const countdown = await host.messages.next(
      "PHASE_CHANGED",
      (message) => roomPhase(message) === "COUNTDOWN",
    );
    assert.equal(roomPhase(countdown), "COUNTDOWN");
    const focus = await host.messages.next(
      "PHASE_CHANGED",
      (message) => roomPhase(message) === "FOCUS",
      8_000,
    );
    assert.equal(roomPhase(focus), "FOCUS");

    host.socket.send(JSON.stringify({ v: 1, type: "HOST_PAUSE" }));
    const paused = await host.messages.next(
      "PHASE_CHANGED",
      (message) => roomPhase(message) === "PAUSED",
    );
    const pausedRoomState = paused.payload.roomState as Record<string, unknown>;
    assert.equal(pausedRoomState.currentRound, 1);
    assert.ok(Number(pausedRoomState.pausedRemainingMilliseconds) > 50_000);

    host.socket.send(JSON.stringify({ v: 1, type: "HOST_RESUME" }));
    const resumed = await host.messages.next(
      "PHASE_CHANGED",
      (message) => roomPhase(message) === "FOCUS",
    );
    assert.equal(roomPhase(resumed), "FOCUS");

    host.socket.send(JSON.stringify({ v: 1, type: "HOST_CLOSE" }));
    const closed = await host.messages.next("ROOM_CLOSED");
    assert.equal(roomPhase(closed), "CLOSED");
    await new Promise<void>((resolve) => {
      if (host.socket.readyState === WebSocket.CLOSED) return resolve();
      host.socket.addEventListener("close", () => resolve(), { once: true });
    });

    const terminalResponse = await dispatchUpgrade(
      worker,
      roomId,
      `gf-v1, gf-auth.${hostToken}`,
    );
    assert.equal(terminalResponse.status, 410);
    assert.equal((await terminalResponse.json()).code, "ROOM_UNAVAILABLE");

    member.socket.close(1000, "test complete");
  });
});

test("local Durable Object storage survives a Worker restart and catches up by timestamp", {
  timeout: 45_000,
}, async () => {
  await withLocalWorker(async ({ worker, key, baseUrl }) => {
    await worker.start();
    const roomId = randomUUID();
    const token = createToken(key, {
      roomId,
      role: "HOST",
      maxParticipants: 4,
    });
    const host = connect(baseUrl, roomId, token);
    await host.opened;
    await host.messages.next("CONNECTED");
    await host.messages.next("ROOM_STATE");
    await host.messages.next("PRESENCE_SNAPSHOT");
    const resumeMessage = await host.messages.next("RESUME_TOKEN");
    const firstResumeToken = String(resumeMessage.payload.resumeToken);

    host.socket.send(JSON.stringify({ v: 1, type: "HOST_START" }));
    await host.messages.next(
      "PHASE_CHANGED",
      (message) => roomPhase(message) === "COUNTDOWN",
    );
    host.socket.close(1000, "disconnect before Worker restart");
    await new Promise<void>((resolve) => {
      if (host.socket.readyState === WebSocket.CLOSED) return resolve();
      host.socket.addEventListener("close", () => resolve(), { once: true });
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    await delay(3_200);
    const emptyRoomReconnect = connect(baseUrl, roomId, token, firstResumeToken);
    await emptyRoomReconnect.opened;
    await emptyRoomReconnect.messages.next("CONNECTED");
    const rotatedResumeMessage = await emptyRoomReconnect.messages.next("RESUME_TOKEN");
    const rotatedResumeToken = String(rotatedResumeMessage.payload.resumeToken);
    const emptyRoomState = await emptyRoomReconnect.messages.next("ROOM_STATE");
    const staleResumeResponse = await dispatchUpgrade(
      worker,
      roomId,
      `gf-v1, gf-auth.${token}, gf-resume.${firstResumeToken}`,
    );
    assert.equal(staleResumeResponse.status, 401);
    assert.equal((await staleResumeResponse.json()).code, "INVALID_RESUME_TOKEN");
    assert.equal(roomPhase(emptyRoomState), "FOCUS");
    assert.equal(
      (emptyRoomState.payload.roomState as Record<string, unknown>).currentRound,
      1,
    );
    emptyRoomReconnect.socket.close(1000, "empty-room timer verified");
    await new Promise<void>((resolve) => {
      if (emptyRoomReconnect.socket.readyState === WebSocket.CLOSED) return resolve();
      emptyRoomReconnect.socket.addEventListener("close", () => resolve(), { once: true });
    });
    await delay(50);

    await worker.stop();
    await delay(100);
    await worker.start();

    const reconnected = connect(baseUrl, roomId, token, rotatedResumeToken);
    await reconnected.opened;
    await reconnected.messages.next("CONNECTED");
    await reconnected.messages.next("RESUME_TOKEN");
    const roomState = await reconnected.messages.next("ROOM_STATE");
    assert.equal(roomPhase(roomState), "FOCUS");
    assert.equal(
      (roomState.payload.roomState as Record<string, unknown>).currentRound,
      1,
    );
    reconnected.socket.close(1000, "test complete");
  });
});