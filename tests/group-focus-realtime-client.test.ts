import assert from "node:assert/strict";
import test from "node:test";
import {
  createGroupFocusRealtimeRuntime,
  type GroupFocusRealtimeSocket,
} from "../src/features/group-focus/runtime/groupFocusRealtime.js";

const roomId = "00000000-0000-4000-8000-000000000020";
const userId = "00000000-0000-4000-8000-000000000021";
const lectureId = "00000000-0000-4000-8000-000000000022";

class FakeSocket implements GroupFocusRealtimeSocket {
  readyState = 0;
  protocol = "";
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly sent: string[] = [];
  readonly selectedProtocols: string[];

  constructor(protocols: string[]) {
    this.selectedProtocols = [...protocols];
  }

  open(protocol = "gf-v1"): void {
    this.readyState = 1;
    this.protocol = protocol;
    this.onopen?.(new Event("open"));
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({
      code: 1000,
      reason: "closed",
      wasClean: true,
    } as CloseEvent);
  }

  disconnect(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({
      code,
      reason: "transport lost",
      wasClean: false,
    } as CloseEvent);
  }
}

function envelope(
  type: string,
  revision: number,
  serverNow: number,
  payload: Record<string, unknown>,
) {
  return { v: 1, type, revision, serverNow, payload };
}

test("headless realtime runtime uses the browser-safe subprotocol handshake", async () => {
  let requestedRoom: string | null = null;
  let createdUrl = "";
  let createdProtocols: string[] = [];
  let socket: FakeSocket | null = null;
  const runtime = createGroupFocusRealtimeRuntime({
    roomId,
    workerUrl: "https://focus.example",
    capabilityFetcher: async (requested) => {
      requestedRoom = requested;
      return {
        capabilityToken: "header.payload.signature",
        expiresAt: "2026-09-25T11:01:30.000Z",
        expiresInSeconds: 90,
      };
    },
    webSocketFactory: (url, protocols) => {
      createdUrl = url;
      createdProtocols = [...protocols];
      socket = new FakeSocket(protocols);
      return socket;
    },
  });

  const connecting = runtime.connect();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(socket);
  socket.open();
  await connecting;

  assert.equal(requestedRoom, roomId);
  assert.equal(createdUrl, `wss://focus.example/rooms/${roomId}/connect`);
  assert.equal(new URL(createdUrl).search, "");
  assert.deepEqual(createdProtocols, [
    "gf-v1",
    "gf-auth.header.payload.signature",
  ]);
  assert.equal(socket.selectedProtocols[0], "gf-v1");
  assert.equal(socket.selectedProtocols[1], "gf-auth.header.payload.signature");
  assert.equal(runtime.getSnapshot().status, "CONNECTED");

  runtime.requestRoomState();
  runtime.start();
  assert.deepEqual(
    socket.sent.map((message) => JSON.parse(message)),
    [
      { v: 1, type: "ROOM_STATE_REQUEST" },
      { v: 1, type: "HOST_START" },
    ],
  );

  runtime.dispose();
  assert.equal(runtime.getSnapshot().status, "DISCONNECTED");
});

test("reconnect fetches a fresh capability and rotates a room-scoped session token", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const sockets: FakeSocket[] = [];
  let capabilityCalls = 0;
  let secondSocketReady: ((socket: FakeSocket) => void) | null = null;
  const secondSocket = new Promise<FakeSocket>((resolve) => {
    secondSocketReady = resolve;
  });
  const runtime = createGroupFocusRealtimeRuntime({
    roomId,
    accountId: userId,
    workerUrl: "https://focus.example",
    resumeTokenStorage: storage,
    capabilityFetcher: async () => ({
      capabilityToken: `capability-${++capabilityCalls}`,
      expiresAt: "2026-09-25T11:01:30.000Z",
      expiresInSeconds: 90,
    }),
    webSocketFactory: (_url, protocols) => {
      const socket = new FakeSocket(protocols);
      sockets.push(socket);
      if (sockets.length === 2) secondSocketReady?.(socket);
      return socket;
    },
  });

  const opening = runtime.connect();
  await new Promise((resolve) => setImmediate(resolve));
  sockets[0]!.open();
  await opening;
  sockets[0]!.receive(envelope("CONNECTED", 1, Date.now(), {
    connectionId: "connection-1",
    userId,
    role: "HOST",
    roomId,
  }));
  const firstToken = "A".repeat(43);
  sockets[0]!.receive(envelope("RESUME_TOKEN", 1, Date.now(), {
    resumeToken: firstToken,
  }));
  const storageKey = `group-focus:resume:v1:${userId}:${roomId}`;
  assert.equal(values.get(storageKey), firstToken);

  sockets[0]!.disconnect();
  runtime.retryConnection();
  const reconnectedSocket = await secondSocket;
  assert.equal(capabilityCalls, 2);
  assert.deepEqual(reconnectedSocket.selectedProtocols, [
    "gf-v1",
    "gf-auth.capability-2",
    `gf-resume.${firstToken}`,
  ]);
  reconnectedSocket.open();
  reconnectedSocket.receive(envelope("CONNECTED", 2, Date.now(), {
    connectionId: "connection-2",
    userId,
    role: "HOST",
    roomId,
  }));
  const rotatedToken = "B".repeat(43);
  reconnectedSocket.receive(envelope("RESUME_TOKEN", 2, Date.now(), {
    resumeToken: rotatedToken,
  }));
  assert.equal(values.get(storageKey), rotatedToken);

  await runtime.leave();
  assert.equal(values.has(storageKey), false);
  assert.equal(runtime.getSnapshot().status, "DISCONNECTED");
  assert.deepEqual(JSON.parse(reconnectedSocket.sent[0]!), {
    v: 1,
    type: "CLIENT_LEAVE",
  });
});

test("disposing on account logout clears the stored room resume token", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  let socket: FakeSocket | null = null;
  const runtime = createGroupFocusRealtimeRuntime({
    roomId,
    accountId: userId,
    workerUrl: "https://focus.example",
    resumeTokenStorage: storage,
    capabilityFetcher: async () => ({
      capabilityToken: "fresh-capability",
      expiresAt: "2026-09-25T11:01:30.000Z",
      expiresInSeconds: 90,
    }),
    webSocketFactory: (_url, protocols) => {
      socket = new FakeSocket(protocols);
      return socket;
    },
  });

  const opening = runtime.connect();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(socket);
  socket.open();
  await opening;
  socket.receive(envelope("CONNECTED", 1, Date.now(), {
    connectionId: "connection-logout",
    userId,
    role: "MEMBER",
    roomId,
  }));
  const token = "C".repeat(43);
  socket.receive(envelope("RESUME_TOKEN", 1, Date.now(), { resumeToken: token }));
  const storageKey = `group-focus:resume:v1:${userId}:${roomId}`;
  assert.equal(values.get(storageKey), token);

  runtime.dispose();

  assert.equal(values.has(storageKey), false);
  assert.deepEqual(JSON.parse(socket.sent[0]!), {
    v: 1,
    type: "CLIENT_LEAVE",
  });
});

test("client countdown interpolation uses server time and monotonic elapsed time", async () => {
  let monotonicNow = 100;
  let socket: FakeSocket | null = null;
  const runtime = createGroupFocusRealtimeRuntime({
    roomId,
    workerUrl: "http://localhost:8787",
    monotonicNow: () => monotonicNow,
    capabilityFetcher: async () => ({
      capabilityToken: "header.payload.signature",
      expiresAt: "2026-09-25T11:01:30.000Z",
      expiresInSeconds: 90,
    }),
    webSocketFactory: (_url, protocols) => {
      socket = new FakeSocket(protocols);
      return socket;
    },
  });

  const connecting = runtime.connect();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(socket);
  socket.open();
  await connecting;
  socket.receive(envelope("CONNECTED", 1, 100_000, {
    connectionId: "00000000-0000-4000-8000-000000000023",
    userId,
    role: "HOST",
    roomId,
  }));
  socket.receive(envelope("ROOM_STATE", 1, 100_000, {
    roomState: {
      mode: "STUDY_TOGETHER",
      phase: "FOCUS",
      currentRound: 1,
      roundCount: 2,
      focusDurationSeconds: 60,
      breakDurationSeconds: 0,
      maxParticipants: 4,
      phaseStartedAt: 40_000,
      phaseEndsAt: 140_000,
      pausedFromPhase: null,
      pausedRemainingMilliseconds: null,
    },
  }));

  monotonicNow = 2_600;
  assert.equal(runtime.getRemainingMilliseconds(), 37_500);
  assert.equal(runtime.getSnapshot().estimatedServerNow, 100_000);

  socket.receive(envelope("PHASE_CHANGED", 0, 100_001, {
    roomState: {
      mode: "STUDY_TOGETHER",
      phase: "LOBBY",
      currentRound: 0,
      roundCount: 2,
      focusDurationSeconds: 60,
      breakDurationSeconds: 0,
      maxParticipants: 4,
      phaseStartedAt: null,
      phaseEndsAt: null,
      pausedFromPhase: null,
      pausedRemainingMilliseconds: null,
    },
  }));
  assert.equal(runtime.getSnapshot().roomState?.phase, "FOCUS");
  runtime.dispose();
});

test("client reports missing Worker configuration and capability issuance failures", async () => {
  assert.throws(
    () => createGroupFocusRealtimeRuntime({
      roomId,
      workerUrl: "",
    }),
    /Worker URL/u,
  );
  assert.throws(
    () => createGroupFocusRealtimeRuntime({
      roomId: "not-a-uuid",
      workerUrl: "https://focus.example",
    }),
    /Room ID/u,
  );

  const runtime = createGroupFocusRealtimeRuntime({
    roomId,
    workerUrl: "https://focus.example",
    capabilityFetcher: async () => {
      throw new Error("private upstream details");
    },
    webSocketFactory: () => {
      throw new Error("must not construct a socket");
    },
  });
  await assert.rejects(runtime.connect(), {
    code: "CAPABILITY_ISSUANCE_FAILED",
  });
  assert.equal(runtime.getSnapshot().status, "ERROR");
  assert.equal(
    runtime.getSnapshot().error?.message,
    "Group Focus could not issue a short-lived realtime capability.",
  );
  runtime.dispose();
});

test("disposal during capability issuance prevents a late socket connection", async () => {
  let resolveCapability!: (value: {
    capabilityToken: string;
    expiresAt: string;
    expiresInSeconds: number;
  }) => void;
  let socketCreated = false;
  const pendingCapability = new Promise<{
    capabilityToken: string;
    expiresAt: string;
    expiresInSeconds: number;
  }>((resolve) => {
    resolveCapability = resolve;
  });
  const runtime = createGroupFocusRealtimeRuntime({
    roomId,
    workerUrl: "https://focus.example",
    capabilityFetcher: () => pendingCapability,
    webSocketFactory: (_url, protocols) => {
      socketCreated = true;
      return new FakeSocket(protocols);
    },
  });

  const connecting = runtime.connect();
  runtime.dispose();
  resolveCapability({
    capabilityToken: "header.payload.signature",
    expiresAt: "2026-09-25T11:01:30.000Z",
    expiresInSeconds: 90,
  });
  await connecting;

  assert.equal(socketCreated, false);
  assert.equal(runtime.getSnapshot().status, "DISCONNECTED");
});

test("failed WebSocket protocol negotiation remains an error", async () => {
  let socket: FakeSocket | null = null;
  const runtime = createGroupFocusRealtimeRuntime({
    roomId,
    workerUrl: "https://focus.example",
    capabilityFetcher: async () => ({
      capabilityToken: "header.payload.signature",
      expiresAt: "2026-09-25T11:01:30.000Z",
      expiresInSeconds: 90,
    }),
    webSocketFactory: (_url, protocols) => {
      socket = new FakeSocket(protocols);
      return socket;
    },
  });
  const connecting = runtime.connect();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(socket);
  socket.open("unsupported");

  await assert.rejects(connecting, { code: "PROTOCOL_NEGOTIATION_FAILED" });
  assert.equal(runtime.getSnapshot().status, "ERROR");
  assert.equal(
    runtime.getSnapshot().error?.code,
    "PROTOCOL_NEGOTIATION_FAILED",
  );
  runtime.dispose();
});

test("runtime refuses a Worker URL containing credentials or query parameters", () => {
  assert.throws(
    () => createGroupFocusRealtimeRuntime({
      roomId,
      workerUrl: "https://user:pass@focus.example?token=not-allowed",
    }),
    /credentials or query/u,
  );
});

test("presence snapshot and events remain revision and sequence aware", async () => {
  let socket: FakeSocket | null = null;
  const runtime = createGroupFocusRealtimeRuntime({
    roomId,
    workerUrl: "https://focus.example",
    capabilityFetcher: async () => ({
      capabilityToken: "header.payload.signature",
      expiresAt: "2026-09-25T11:01:30.000Z",
      expiresInSeconds: 90,
    }),
    webSocketFactory: (_url, protocols) => {
      socket = new FakeSocket(protocols);
      return socket;
    },
  });
  const connecting = runtime.connect();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(socket);
  socket.open();
  await connecting;

  const host = {
    userId,
    role: "HOST",
    effectiveLectureId: lectureId,
    connectedAt: 100,
  };
  socket.receive(envelope("PRESENCE_SNAPSHOT", 1, 1_000, {
    sequence: 1,
    participants: [host],
  }));
  socket.receive(envelope("PRESENCE_JOINED", 2, 1_001, {
    sequence: 2,
    participant: {
      userId: "00000000-0000-4000-8000-000000000024",
      role: "MEMBER",
      effectiveLectureId: lectureId,
      connectedAt: 101,
    },
  }));
  socket.receive(envelope("PRESENCE_LEFT", 1, 1_002, {
    sequence: 1,
    participant: host,
  }));

  assert.equal(runtime.getSnapshot().presence.length, 2);
  socket.receive(envelope("PRESENCE_LEFT", 3, 1_003, {
    sequence: 3,
    participant: host,
  }));
  assert.equal(runtime.getSnapshot().presence.length, 1);
  assert.equal(runtime.getSnapshot().presence[0]?.role, "MEMBER");
  runtime.dispose();
});