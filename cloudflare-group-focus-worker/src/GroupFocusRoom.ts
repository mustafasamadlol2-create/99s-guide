import {
  GroupFocusCapabilityVerificationError,
  verifyGroupFocusCapability,
  type GroupFocusCapabilityWorkerEnvironment,
} from "./capability.js";
import {
  GroupFocusCapabilityConfigurationError,
} from "../../shared/group-focus-capability/keyring.js";
import {
  closeGroupFocusRoom,
  createInitialGroupFocusRoomState,
  advanceGroupFocusRoomState,
  groupFocusRoomConfigurationMatches,
  isValidGroupFocusRoomState,
  pauseGroupFocusRoom,
  resumeGroupFocusRoom,
  startGroupFocusCountdown,
  type GroupFocusRoomState,
} from "./roomState.js";
import {
  GROUP_FOCUS_CAPABILITY_MAX_TOKEN_BYTES,
} from "../../shared/group-focus-capability/contract.js";
import {
  GROUP_FOCUS_REALTIME_INTERNAL_CAPABILITY_HEADER,
  GROUP_FOCUS_REALTIME_MAX_MESSAGE_BYTES,
  GROUP_FOCUS_REALTIME_PROTOCOL,
  parseGroupFocusRealtimeClientMessage,
  type GroupFocusRealtimeParticipant,
  type GroupFocusRealtimeServerMessage,
  type GroupFocusRealtimeServerMessageType,
  type GroupFocusRealtimeSocketAttachment,
} from "../../shared/group-focus-realtime/protocol.js";

const ROOM_STATE_KEY = "group-focus-room-state-v1";
const ROOM_PATH = /^\/rooms\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/connect$/iu;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ATTACHMENT_KEYS = [
  "connectionId",
  "userId",
  "membershipId",
  "role",
  "effectiveLectureId",
  "connectedAt",
].sort();

type GroupFocusRoomEnvironment =
  & GroupFocusCapabilityWorkerEnvironment
  & Env;

type RoomStateSnapshot = {
  mode: GroupFocusRoomState["mode"];
  phase: GroupFocusRoomState["phase"];
  currentRound: number;
  roundCount: number;
  focusDurationSeconds: number;
  breakDurationSeconds: number;
  maxParticipants: number;
  phaseStartedAt: number | null;
  phaseEndsAt: number | null;
  pausedFromPhase: GroupFocusRoomState["pausedFromPhase"];
  pausedRemainingMilliseconds: number | null;
};

class RoomRuntimeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function jsonError(status: number, code: string): Response {
  return Response.json(
    { error: "Group Focus realtime request was rejected.", code },
    {
      status,
      headers: {
        "Cache-Control": "no-store, private",
        Pragma: "no-cache",
      },
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSocketAttachment(value: unknown): value is GroupFocusRealtimeSocketAttachment {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value).sort();
  return actualKeys.length === ATTACHMENT_KEYS.length
    && actualKeys.every((key, index) => key === ATTACHMENT_KEYS[index])
    && typeof value.connectionId === "string"
    && UUID.test(value.connectionId)
    && typeof value.userId === "string"
    && UUID.test(value.userId)
    && typeof value.membershipId === "string"
    && UUID.test(value.membershipId)
    && (value.role === "HOST" || value.role === "MEMBER")
    && typeof value.effectiveLectureId === "string"
    && UUID.test(value.effectiveLectureId)
    && typeof value.connectedAt === "number"
    && Number.isSafeInteger(value.connectedAt)
    && value.connectedAt >= 0;
}

function publicParticipant(
  attachment: GroupFocusRealtimeSocketAttachment,
): GroupFocusRealtimeParticipant {
  return {
    userId: attachment.userId,
    role: attachment.role,
    effectiveLectureId: attachment.effectiveLectureId,
    connectedAt: attachment.connectedAt,
  };
}

function roomStateSnapshot(state: GroupFocusRoomState): RoomStateSnapshot {
  return {
    mode: state.mode,
    phase: state.phase,
    currentRound: state.currentRound,
    roundCount: state.roundCount,
    focusDurationSeconds: state.focusDurationSeconds,
    breakDurationSeconds: state.breakDurationSeconds,
    maxParticipants: state.maxParticipants,
    phaseStartedAt: state.phaseStartedAt,
    phaseEndsAt: state.phaseEndsAt,
    pausedFromPhase: state.pausedFromPhase,
    pausedRemainingMilliseconds: state.pausedRemainingMilliseconds,
  };
}

function messageEnvelope(
  type: GroupFocusRealtimeServerMessageType,
  revision: number,
  serverNow: number,
  payload: Record<string, unknown>,
): GroupFocusRealtimeServerMessage {
  return { v: 1, type, revision, serverNow, payload };
}

function isUpgradeRequest(request: Request): boolean {
  return request.headers.get("upgrade")?.toLowerCase() === "websocket";
}

export class GroupFocusRoom {
  private eventQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: GroupFocusRoomEnvironment,
  ) {}

  fetch(request: Request): Promise<Response> {
    return this.serialize(() => this.handleFetch(request));
  }

  alarm(): Promise<void> {
    return this.serialize(async () => {
      const state = await this.readState();
      if (!state) return;
      const now = Date.now();
      if (state.phaseEndsAt === null) {
        await this.ctx.storage.deleteAlarm();
        return;
      }
      if (state.phaseEndsAt > now) {
        await this.ctx.storage.setAlarm(state.phaseEndsAt);
        return;
      }
      const advanced = advanceGroupFocusRoomState(state, now);
      if (advanced.transitions.length === 0) {
        await this.ctx.storage.deleteAlarm();
        return;
      }
      await this.persistTimedState(advanced.state);
      this.broadcastTransitions(advanced.transitions, now);
    });
  }

  webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    return this.serialize(() => this.handleSocketMessage(socket, message));
  }

  webSocketClose(socket: WebSocket): Promise<void> {
    return this.serialize(() => this.handleSocketClosed(socket));
  }

  webSocketError(socket: WebSocket): Promise<void> {
    return this.serialize(() => this.handleSocketClosed(socket));
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.eventQueue.then(operation, operation);
    this.eventQueue = current.then(() => undefined, () => undefined);
    return current;
  }

  private async readState(): Promise<GroupFocusRoomState | null> {
    const value = await this.ctx.storage.get<unknown>(ROOM_STATE_KEY);
    if (value === undefined) return null;
    if (!isValidGroupFocusRoomState(value)) {
      throw new RoomRuntimeError(503, "ROOM_STATE_VERSION_UNSUPPORTED");
    }
    return value;
  }

  private async persistState(state: GroupFocusRoomState): Promise<void> {
    await this.ctx.storage.put(ROOM_STATE_KEY, state);
  }

  private async persistTimedState(state: GroupFocusRoomState): Promise<void> {
    await this.persistState(state);
    if (
      (state.phase === "COUNTDOWN" || state.phase === "FOCUS" || state.phase === "BREAK")
      && state.phaseEndsAt !== null
    ) {
      await this.ctx.storage.setAlarm(state.phaseEndsAt);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  private attachmentFor(socket: WebSocket): GroupFocusRealtimeSocketAttachment | null {
    try {
      const attachment: unknown = socket.deserializeAttachment();
      return isSocketAttachment(attachment) ? attachment : null;
    } catch {
      return null;
    }
  }

  private liveConnections(exceptConnectionId?: string): GroupFocusRealtimeSocketAttachment[] {
    const byId = new Map<string, GroupFocusRealtimeSocketAttachment>();
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== 1) continue;
      const attachment = this.attachmentFor(socket);
      if (!attachment || attachment.connectionId === exceptConnectionId) continue;
      byId.set(attachment.connectionId, attachment);
    }
    return [...byId.values()].sort((left, right) =>
      left.userId.localeCompare(right.userId));
  }

  private send(
    socket: WebSocket,
    message: GroupFocusRealtimeServerMessage,
  ): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // A closing peer is removed by its WebSocket close/error event.
    }
  }

  private broadcast(
    message: GroupFocusRealtimeServerMessage,
    exceptConnectionId?: string,
  ): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.attachmentFor(socket);
      if (
        attachment
        && attachment.connectionId !== exceptConnectionId
        && socket.readyState === 1
      ) {
        this.send(socket, message);
      }
    }
  }

  private broadcastTransitions(
    transitions: readonly GroupFocusRoomState[],
    serverNow: number,
  ): void {
    for (const state of transitions) {
      this.broadcast(messageEnvelope(
        "PHASE_CHANGED",
        state.revision,
        serverNow,
        { roomState: roomStateSnapshot(state) },
      ));
    }
  }

  private async normalizeDueState(
    state: GroupFocusRoomState,
    now: number,
  ): Promise<GroupFocusRoomState> {
    const advanced = advanceGroupFocusRoomState(state, now);
    if (advanced.transitions.length === 0) return state;
    await this.persistTimedState(advanced.state);
    this.broadcastTransitions(advanced.transitions, now);
    return advanced.state;
  }

  private async handleFetch(request: Request): Promise<Response> {
    if (request.method !== "GET") return jsonError(405, "METHOD_NOT_ALLOWED");
    if (!isUpgradeRequest(request)) return jsonError(426, "WEBSOCKET_UPGRADE_REQUIRED");
    if (request.headers.get("authorization")) return jsonError(401, "UNAUTHORIZED");

    const url = new URL(request.url);
    if (
      url.searchParams.has("token")
      || url.searchParams.has("capability")
      || url.searchParams.has("auth")
    ) {
      return jsonError(400, "QUERY_CREDENTIALS_NOT_SUPPORTED");
    }
    const match = url.pathname.match(ROOM_PATH);
    const roomId = match?.[1];
    if (!roomId || !UUID.test(roomId)) return jsonError(404, "NOT_FOUND");

    const offeredProtocols = request.headers.get("sec-websocket-protocol")
      ?.split(",")
      .map((protocol) => protocol.trim());
    if (
      !offeredProtocols
      || offeredProtocols.length !== 1
      || offeredProtocols[0] !== GROUP_FOCUS_REALTIME_PROTOCOL
    ) {
      return jsonError(400, "INVALID_WEBSOCKET_PROTOCOL");
    }

    const token = request.headers.get(GROUP_FOCUS_REALTIME_INTERNAL_CAPABILITY_HEADER);
    if (
      !token
      || new TextEncoder().encode(token).byteLength > GROUP_FOCUS_CAPABILITY_MAX_TOKEN_BYTES
    ) {
      return jsonError(401, "UNAUTHORIZED");
    }

    let capability;
    try {
      capability = await verifyGroupFocusCapability(token, this.env);
    } catch (error) {
      if (error instanceof GroupFocusCapabilityConfigurationError) {
        return jsonError(503, "CAPABILITY_NOT_CONFIGURED");
      }
      if (error instanceof GroupFocusCapabilityVerificationError) {
        return jsonError(401, "INVALID_CAPABILITY");
      }
      return jsonError(401, "INVALID_CAPABILITY");
    }
    if (capability.roomId !== roomId) return jsonError(403, "ROOM_CAPABILITY_MISMATCH");

    const now = Date.now();
    let state: GroupFocusRoomState;
    try {
      const stored = await this.readState();
      if (stored) {
        if (!groupFocusRoomConfigurationMatches(stored, capability)) {
          return jsonError(409, "ROOM_CONFIGURATION_MISMATCH");
        }
        state = await this.normalizeDueState(stored, now);
      } else {
        state = createInitialGroupFocusRoomState(capability, now);
      }
    } catch (error) {
      if (error instanceof RoomRuntimeError) return jsonError(error.status, error.code);
      return jsonError(503, "ROOM_STATE_UNAVAILABLE");
    }

    if (state.phase === "CLOSED" || state.phase === "COMPLETED") {
      return jsonError(410, "ROOM_UNAVAILABLE");
    }

    const existingSockets = this.ctx.getWebSockets();
    const liveConnections = this.liveConnections();
    if (liveConnections.some((participant) => participant.userId === capability.userId)) {
      return jsonError(409, "ALREADY_CONNECTED");
    }
    if (liveConnections.length >= state.maxParticipants) {
      return jsonError(409, "ROOM_CAPACITY_REACHED");
    }

    const attachment: GroupFocusRealtimeSocketAttachment = {
      connectionId: crypto.randomUUID(),
      userId: capability.userId,
      membershipId: capability.membershipId,
      role: capability.role,
      effectiveLectureId: capability.effectiveLectureId,
      connectedAt: now,
    };
    const pair = new WebSocketPair();
    const clientSocket = pair[0];
    const serverSocket = pair[1];
    try {
      this.ctx.acceptWebSocket(serverSocket);
      serverSocket.serializeAttachment(attachment);
      const connections = [...liveConnections, attachment]
        .sort((left, right) => left.userId.localeCompare(right.userId));
      state = {
        ...state,
        connections,
        revision: state.revision + 1,
        updatedAt: now,
      };
      await this.persistState(state);
    } catch {
      try {
        serverSocket.close(1011, "Room unavailable");
      } catch {
        // The handshake will fail when the accepted server side closes.
      }
      return jsonError(503, "ROOM_STATE_UNAVAILABLE");
    }

    this.send(
      serverSocket,
      messageEnvelope(
        "CONNECTED",
        state.revision,
        now,
        {
          connectionId: attachment.connectionId,
          userId: attachment.userId,
          role: attachment.role,
          roomId,
        },
      ),
    );
    this.send(
      serverSocket,
      messageEnvelope(
        "ROOM_STATE",
        state.revision,
        now,
        { roomState: roomStateSnapshot(state) },
      ),
    );
    this.send(
      serverSocket,
      messageEnvelope(
        "PRESENCE_SNAPSHOT",
        state.revision,
        now,
        {
          sequence: state.revision,
          participants: state.connections.map(publicParticipant),
        },
      ),
    );
    const joined = messageEnvelope(
      "PRESENCE_JOINED",
      state.revision,
      now,
      { sequence: state.revision, participant: publicParticipant(attachment) },
    );
    for (const socket of existingSockets) {
      const current = this.attachmentFor(socket);
      if (current && current.connectionId !== attachment.connectionId && socket.readyState === 1) {
        this.send(socket, joined);
      }
    }

    return new Response(null, {
      status: 101,
      webSocket: clientSocket,
      headers: { "Sec-WebSocket-Protocol": GROUP_FOCUS_REALTIME_PROTOCOL },
    });
  }

  private async handleSocketMessage(
    socket: WebSocket,
    input: string | ArrayBuffer,
  ): Promise<void> {
    const attachment = this.attachmentFor(socket);
    if (!attachment) {
      try {
        socket.close(1008, "Invalid connection");
      } catch {
        // Already closed.
      }
      return;
    }
    const now = Date.now();
    let state: GroupFocusRoomState | null;
    try {
      state = await this.readState();
      if (state) state = await this.normalizeDueState(state, now);
    } catch {
      this.send(
        socket,
        messageEnvelope("ERROR", 0, now, { code: "ROOM_STATE_UNAVAILABLE" }),
      );
      return;
    }
    if (!state) {
      this.send(socket, messageEnvelope("ERROR", 0, now, { code: "ROOM_STATE_UNAVAILABLE" }));
      return;
    }
    if (typeof input !== "string") {
      this.send(
        socket,
        messageEnvelope("ERROR", state.revision, now, { code: "TEXT_MESSAGES_REQUIRED" }),
      );
      return;
    }
    if (new TextEncoder().encode(input).byteLength > GROUP_FOCUS_REALTIME_MAX_MESSAGE_BYTES) {
      this.send(
        socket,
        messageEnvelope("ERROR", state.revision, now, { code: "MESSAGE_TOO_LARGE" }),
      );
      return;
    }
    const message = parseGroupFocusRealtimeClientMessage(input);
    if (!message) {
      this.send(
        socket,
        messageEnvelope("ERROR", state.revision, now, { code: "INVALID_MESSAGE" }),
      );
      return;
    }
    if (message.type === "ROOM_STATE_REQUEST") {
      this.send(
        socket,
        messageEnvelope(
          "ROOM_STATE",
          state.revision,
          now,
          { roomState: roomStateSnapshot(state) },
        ),
      );
      return;
    }
    if (attachment.role !== "HOST") {
      this.send(
        socket,
        messageEnvelope("ERROR", state.revision, now, { code: "NOT_ROOM_HOST" }),
      );
      return;
    }
    if (state.phase === "CLOSED" || state.phase === "COMPLETED") {
      this.send(
        socket,
        messageEnvelope("ERROR", state.revision, now, { code: "ROOM_UNAVAILABLE" }),
      );
      return;
    }

    let next: GroupFocusRoomState | null = null;
    switch (message.type) {
      case "HOST_START":
        next = startGroupFocusCountdown(state, now);
        break;
      case "HOST_PAUSE":
        next = pauseGroupFocusRoom(state, now);
        break;
      case "HOST_RESUME":
        next = resumeGroupFocusRoom(state, now);
        break;
      case "HOST_CLOSE":
        next = closeGroupFocusRoom(state, now);
        break;
    }
    if (!next) {
      this.send(
        socket,
        messageEnvelope("ERROR", state.revision, now, { code: "INVALID_STATE_TRANSITION" }),
      );
      return;
    }

    if (message.type === "HOST_CLOSE") {
      next = { ...next, connections: [] };
      try {
        await this.persistTimedState(next);
      } catch {
        this.send(
          socket,
          messageEnvelope("ERROR", state.revision, now, { code: "ROOM_STATE_UNAVAILABLE" }),
        );
        return;
      }
      const closed = messageEnvelope(
        "ROOM_CLOSED",
        next.revision,
        now,
        { roomState: roomStateSnapshot(next) },
      );
      this.broadcast(closed);
      for (const connected of this.ctx.getWebSockets()) {
        try {
          connected.close(1000, "Room closed");
        } catch {
          // The peer may already be closing.
        }
      }
      return;
    }

    try {
      await this.persistTimedState(next);
    } catch {
      this.send(
        socket,
        messageEnvelope("ERROR", state.revision, now, { code: "ROOM_STATE_UNAVAILABLE" }),
      );
      return;
    }

    if (message.type === "HOST_RESUME" && next.phaseEndsAt === now) {
      const advanced = advanceGroupFocusRoomState(next, now);
      if (advanced.transitions.length > 0) {
        try {
          await this.persistTimedState(advanced.state);
        } catch {
          this.send(
            socket,
            messageEnvelope(
              "ERROR",
              next.revision,
              now,
              { code: "ROOM_STATE_UNAVAILABLE" },
            ),
          );
          return;
        }
        this.broadcastTransitions(advanced.transitions, now);
        return;
      }
    }
    this.broadcastTransitions([next], now);
  }

  private async handleSocketClosed(socket: WebSocket): Promise<void> {
    const attachment = this.attachmentFor(socket);
    if (!attachment) return;
    let state: GroupFocusRoomState | null;
    try {
      state = await this.readState();
    } catch {
      return;
    }
    if (!state || !state.connections.some((item) =>
      item.connectionId === attachment.connectionId)) {
      return;
    }
    const now = Date.now();
    const connections = state.connections.filter((item) =>
      item.connectionId !== attachment.connectionId);
    const next: GroupFocusRoomState = {
      ...state,
      connections,
      revision: state.revision + 1,
      updatedAt: now,
    };
    try {
      await this.persistState(next);
    } catch {
      return;
    }
    this.broadcast(
      messageEnvelope(
        "PRESENCE_LEFT",
        next.revision,
        now,
        {
          sequence: next.revision,
          participant: publicParticipant(attachment),
        },
      ),
      attachment.connectionId,
    );
  }
}