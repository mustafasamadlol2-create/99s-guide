import {
  GroupFocusCapabilityVerificationError,
  verifyGroupFocusCapability,
  type GroupFocusCapabilityWorkerEnvironment,
} from "./capability.js";
import {
  GROUP_FOCUS_CANONICAL_RECONCILIATION_INTERVAL_SECONDS,
  GROUP_FOCUS_SUMMARY_ACK_RETENTION_SECONDS,
  GROUP_FOCUS_SUMMARY_MAX_BODY_BYTES,
  GROUP_FOCUS_SUMMARY_RETRY_RETENTION_SECONDS,
  GROUP_FOCUS_RUNTIME_IDLE_TIMEOUT_SECONDS,
  type GroupFocusCanonicalMembershipSnapshot,
  type GroupFocusRuntimeSnapshotResponse,
  type GroupFocusRuntimeSummary,
  type GroupFocusSummaryTerminalReason,
} from "../../shared/group-focus-reconciliation/contract.js";
import {
  signGroupFocusMachineRequest,
  type GroupFocusReconciliationEnvironment,
} from "../../shared/group-focus-reconciliation/signing.js";
import {
  GROUP_FOCUS_CANONICAL_FAILURE_LIMIT_MILLISECONDS,
  GROUP_FOCUS_HOST_CONTROL_FRESHNESS_MILLISECONDS,
  GROUP_FOCUS_RECONNECT_GRACE_MILLISECONDS,
  GROUP_FOCUS_RESUME_TOKEN_TTL_MILLISECONDS,
  createFrozenSummary,
  createGroupFocusRuntimeData,
  createRuntimeParticipant,
  closeVerifiedFocusSegment,
  applyScheduledTransitions,
  hashResumeToken,
  isValidGroupFocusRuntimeData,
  nextRetryDelay,
  randomToken,
  startParticipantFocusSegment,
  stopParticipantConnection,
  type GroupFocusRuntimeData,
  type GroupFocusRuntimeParticipant,
} from "./runtimeState.js";
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
  GROUP_FOCUS_REALTIME_INTERNAL_RESUME_HEADER,
  GROUP_FOCUS_REALTIME_MAX_MESSAGE_BYTES,
  GROUP_FOCUS_REALTIME_PROTOCOL,
  parseGroupFocusRealtimeClientMessage,
  type GroupFocusRealtimeParticipant,
  type GroupFocusRealtimeServerMessage,
  type GroupFocusRealtimeServerMessageType,
  type GroupFocusRealtimeSocketAttachment,
} from "../../shared/group-focus-realtime/protocol.js";

const ROOM_STATE_KEY = "group-focus-room-state-v1";
const RUNTIME_STATE_KEY = "group-focus-runtime-state-v1";
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
  & GroupFocusReconciliationEnvironment
  & {
    GROUP_FOCUS_API_BASE_URL?: string;
  }
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

function publicParticipantFromRuntime(
  participant: GroupFocusRuntimeParticipant,
): GroupFocusRealtimeParticipant {
  return {
    userId: participant.userId,
    role: participant.role,
    effectiveLectureId: participant.effectiveLectureId,
    connectedAt: participant.firstConnectedAt,
    connectionState: participant.connectionState === "RECONNECTING"
      ? "RECONNECTING"
      : "CONNECTED",
  };
}

function constantTimeStringEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
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
      let runtime = await this.ensureRuntime(state, now);
      let currentState = state;
      const advanced = advanceGroupFocusRoomState(currentState, now);
      if (advanced.transitions.length > 0) {
        applyScheduledTransitions(runtime, currentState, advanced.transitions);
        currentState = advanced.state;
        if (currentState.phase === "COMPLETED") {
          await this.terminateRoom(
            currentState,
            runtime,
            "COMPLETED",
            currentState.phaseStartedAt ?? now,
            false,
          );
          return;
        }
        await this.persistRuntimeState(currentState, runtime);
        this.broadcastTransitions(advanced.transitions, now);
      }

      for (const participant of runtime.participants) {
        if (
          participant.connectionState !== "RECONNECTING"
          || participant.reconnectDeadlineAt === null
          || participant.reconnectDeadlineAt > now
        ) continue;
        participant.connectionState = "DISCONNECTED";
        participant.resumeTokenHash = null;
        participant.resumeTokenExpiresAt = null;
        participant.reconnectDeadlineAt = null;
        participant.connectionId = null;
        currentState = {
          ...currentState,
          revision: currentState.revision + 1,
          updatedAt: now,
        };
        this.broadcast(messageEnvelope("PRESENCE_LEFT", currentState.revision, now, {
          sequence: currentState.revision,
          participant: {
            userId: participant.userId,
            role: participant.role,
            effectiveLectureId: participant.effectiveLectureId,
            connectedAt: participant.firstConnectedAt,
          },
        }));
      }
      if (!runtime.participants.some((participant) =>
        participant.connectionState === "CONNECTED"
        || participant.connectionState === "RECONNECTING")) {
        runtime.idleSinceAt = runtime.idleSinceAt ?? now;
      }

      if (
        currentState.phase !== "CLOSED"
        && currentState.phase !== "COMPLETED"
        && runtime.nextCanonicalSyncAt <= now
      ) {
        const synced = await this.syncCanonicalRoom(currentState, runtime, now);
        currentState = synced.state;
        runtime = synced.runtime;
      }

      if (
        (currentState.phase === "LOBBY" || currentState.phase === "PAUSED")
        && runtime.idleSinceAt !== null
        && now - runtime.idleSinceAt
          >= GROUP_FOCUS_RUNTIME_IDLE_TIMEOUT_SECONDS * 1000
      ) {
        const reason = currentState.phase === "LOBBY"
          ? "LOBBY_IDLE_TIMEOUT"
          : "PAUSED_IDLE_TIMEOUT";
        await this.terminateRoom(currentState, runtime, reason, now, false);
        return;
      }

      if (runtime.summary?.status === "PENDING") {
        await this.deliverSummary(runtime, currentState, now);
      }
      if (
        runtime.summary
        && runtime.summary.status !== "PENDING"
        && runtime.summary.retentionUntil !== null
        && runtime.summary.retentionUntil <= now
      ) {
        runtime.participants = [];
        runtime.summary = null;
      }
      await this.persistRuntimeState(currentState, runtime);
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

  private async readRuntime(): Promise<GroupFocusRuntimeData | null> {
    const value = await this.ctx.storage.get<unknown>(RUNTIME_STATE_KEY);
    if (value === undefined) return null;
    if (!isValidGroupFocusRuntimeData(value)) {
      throw new RoomRuntimeError(503, "RUNTIME_STATE_VERSION_UNSUPPORTED");
    }
    return value;
  }

  private async persistState(state: GroupFocusRoomState): Promise<void> {
    await this.ctx.storage.put(ROOM_STATE_KEY, state);
  }

  private async scheduleNextAlarm(
    state: GroupFocusRoomState,
    runtime: GroupFocusRuntimeData,
  ): Promise<void> {
    const deadlines: number[] = [];
    if (
      !["COMPLETED", "CLOSED"].includes(state.phase)
      && state.phaseEndsAt !== null
    ) deadlines.push(state.phaseEndsAt);
    if (!["COMPLETED", "CLOSED"].includes(state.phase)) {
      for (const participant of runtime.participants) {
        if (
          participant.connectionState === "RECONNECTING"
          && participant.reconnectDeadlineAt !== null
        ) deadlines.push(participant.reconnectDeadlineAt);
      }
      deadlines.push(runtime.nextCanonicalSyncAt);
    }
    if (runtime.summary?.status === "PENDING") {
      if (runtime.summary.nextAttemptAt !== null) {
        deadlines.push(runtime.summary.nextAttemptAt);
      }
      if (runtime.summary.retentionUntil !== null) {
        deadlines.push(runtime.summary.retentionUntil);
      }
    } else if (runtime.summary?.retentionUntil !== null && runtime.summary) {
      deadlines.push(runtime.summary.retentionUntil);
    }
    const noLiveOrReconnecting = !runtime.participants.some((participant) =>
      participant.connectionState === "CONNECTED"
      || participant.connectionState === "RECONNECTING");
    if (
      noLiveOrReconnecting
      && runtime.idleSinceAt !== null
      && ((state.phase === "LOBBY") || (state.phase === "PAUSED"))
    ) {
      deadlines.push(
        runtime.idleSinceAt + GROUP_FOCUS_RUNTIME_IDLE_TIMEOUT_SECONDS * 1000,
      );
    }
    if (deadlines.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.min(...deadlines));
  }

  private async persistRuntimeState(
    state: GroupFocusRoomState,
    runtime: GroupFocusRuntimeData,
  ): Promise<void> {
    await this.persistState(state);
    await this.ctx.storage.put(RUNTIME_STATE_KEY, runtime);
    await this.scheduleNextAlarm(state, runtime);
  }

  private async ensureRuntime(
    state: GroupFocusRoomState,
    now: number,
  ): Promise<GroupFocusRuntimeData> {
    let runtime = await this.readRuntime();
    if (!runtime) {
      runtime = createGroupFocusRuntimeData(state.roomId, now);
      for (const attachment of this.liveConnections()) {
        const resumeToken = randomToken(32);
        const participant: GroupFocusRuntimeParticipant = {
          userId: attachment.userId,
          membershipId: attachment.membershipId,
          role: attachment.role,
          effectiveLectureId: attachment.effectiveLectureId,
          connectionState: "CONNECTED",
          connectionId: attachment.connectionId,
          firstConnectedAt: attachment.connectedAt,
          lastConnectedAt: attachment.connectedAt,
          lastDisconnectedAt: null,
          reconnectCount: 0,
          resumeTokenHash: await hashResumeToken(resumeToken),
          resumeTokenExpiresAt: now + GROUP_FOCUS_RESUME_TOKEN_TTL_MILLISECONDS,
          reconnectDeadlineAt: null,
          totalVerifiedFocusMilliseconds: 0,
          perRoundVerifiedFocusMilliseconds: Array.from(
            { length: state.roundCount },
            () => 0,
          ),
          activeFocusSegmentStartedAt: state.phase === "FOCUS" ? now : null,
        };
        runtime.participants.push(participant);
        const socket = this.ctx.getWebSockets().find((candidate) =>
          this.attachmentFor(candidate)?.connectionId === attachment.connectionId);
        if (socket) {
          this.send(socket, messageEnvelope(
            "RESUME_TOKEN",
            state.revision,
            now,
            { resumeToken },
          ));
        }
      }
      runtime.idleSinceAt = runtime.participants.length === 0 ? now : null;
      await this.persistRuntimeState(state, runtime);
    }
    return runtime;
  }

  private async postMachineJson<T>(
    path: string,
    body: unknown,
    maximumBytes: number,
  ): Promise<{ response: Response; value: T | null }> {
    const base = this.env.GROUP_FOCUS_API_BASE_URL;
    if (!base) throw new Error("RECONCILIATION_ENDPOINT_NOT_CONFIGURED");
    const baseUrl = new URL(base);
    if (
      !["https:", "http:"].includes(baseUrl.protocol)
      || baseUrl.username
      || baseUrl.password
      || baseUrl.search
      || baseUrl.hash
      || (baseUrl.pathname !== "/" && baseUrl.pathname !== "")
    ) throw new Error("RECONCILIATION_ENDPOINT_INVALID");
    const url = new URL(path, baseUrl.origin);
    const serialized = JSON.stringify(body);
    const bytes = new TextEncoder().encode(serialized);
    if (bytes.byteLength > maximumBytes) throw new Error("RECONCILIATION_BODY_TOO_LARGE");
    const signed = await signGroupFocusMachineRequest(this.env, {
      method: "POST",
      path,
      body: bytes,
    });
    const headers = new Headers({
      "Content-Type": "application/json",
      "X-Requested-With": "group-focus-worker",
    });
    headers.set("X-GF-Kid", signed.kid);
    headers.set("X-GF-Timestamp", signed.timestamp);
    headers.set("X-GF-Nonce", signed.nonce);
    headers.set("X-GF-Signature", signed.signature);
    const response = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: serialized,
      signal: AbortSignal.timeout(10_000),
    });
    let value: T | null = null;
    try {
      value = await response.json() as T;
    } catch {
      value = null;
    }
    return { response, value };
  }

  private isCanonicalSnapshot(value: unknown): value is GroupFocusRuntimeSnapshotResponse {
    if (!isRecord(value) || !isRecord(value.room) || !Array.isArray(value.memberships)) {
      return false;
    }
    const room = value.room;
    if (
      typeof room.roomId !== "string"
      || !UUID.test(room.roomId)
      || (room.status !== "OPEN" && room.status !== "CLOSED")
      || (room.mode !== "SHARED_LECTURE" && room.mode !== "STUDY_TOGETHER")
      || (room.visibility !== "PUBLIC" && room.visibility !== "PRIVATE")
      || !(room.sharedLectureId === null || (typeof room.sharedLectureId === "string"
        && UUID.test(room.sharedLectureId)))
      || !Number.isSafeInteger(room.focusDurationSeconds)
      || !Number.isSafeInteger(room.breakDurationSeconds)
      || !Number.isSafeInteger(room.roundCount)
      || !Number.isSafeInteger(room.maxParticipants)
      || typeof room.updatedAt !== "string"
      || !Number.isFinite(Date.parse(room.updatedAt))
      || value.memberships.length > 25
    ) return false;
    return value.memberships.every((membership) =>
      isRecord(membership)
      && typeof membership.userId === "string"
      && UUID.test(membership.userId)
      && typeof membership.membershipId === "string"
      && UUID.test(membership.membershipId)
      && ["ACTIVE", "LEFT", "REMOVED"].includes(String(membership.status))
      && ["HOST", "MEMBER"].includes(String(membership.role))
      && (membership.effectiveLectureId === null
        || (typeof membership.effectiveLectureId === "string"
          && UUID.test(membership.effectiveLectureId)))
      && typeof membership.updatedAt === "string"
      && Number.isFinite(Date.parse(membership.updatedAt)));
  }

  private async syncCanonicalRoom(
    state: GroupFocusRoomState,
    runtime: GroupFocusRuntimeData,
    now: number,
  ): Promise<{ state: GroupFocusRoomState; runtime: GroupFocusRuntimeData; ok: boolean }> {
    if (state.phase === "CLOSED" || state.phase === "COMPLETED") {
      return { state, runtime, ok: true };
    }
    try {
      const userIds = [...new Set(runtime.participants.map((participant) => participant.userId))]
        .sort();
      const request = {
        roomId: state.roomId,
        userIds,
        runtimeInstanceId: runtime.runtimeInstanceId,
        runtimeRevision: state.revision,
      };
      const { response, value } = await this.postMachineJson<unknown>(
        "/api/internal/group-focus/runtime/snapshot",
        request,
        32 * 1024,
      );
      if (!response.ok || !this.isCanonicalSnapshot(value)) {
        throw new Error(`CANONICAL_SNAPSHOT_HTTP_${response.status}`);
      }
      const snapshot = value;
      if (snapshot.room.roomId !== state.roomId) {
        throw new Error("CANONICAL_SNAPSHOT_ROOM_MISMATCH");
      }
      const canonicalRoom = snapshot.room;
      if (
        canonicalRoom.mode !== state.mode
        || canonicalRoom.focusDurationSeconds !== state.focusDurationSeconds
        || canonicalRoom.breakDurationSeconds !== state.breakDurationSeconds
        || canonicalRoom.roundCount !== state.roundCount
        || canonicalRoom.maxParticipants !== state.maxParticipants
      ) {
        runtime.lastCanonicalSyncAt = now;
        runtime.lastCanonicalSyncFailureAt = null;
        runtime.canonicalSyncFailureCount = 0;
        runtime.nextCanonicalSyncAt =
          now + GROUP_FOCUS_CANONICAL_RECONCILIATION_INTERVAL_SECONDS * 1000;
        runtime.canonicalReconciliationRequired = true;
        runtime.reconciliationError = "ROOM_CONFIGURATION_MISMATCH";
        await this.persistRuntimeState(state, runtime);
        console.error("[GroupFocusRuntime] Canonical room configuration mismatch.", {
          errorCode: "ROOM_CONFIGURATION_MISMATCH",
        });
        return { state, runtime, ok: false };
      }
      if (canonicalRoom.status === "CLOSED") {
        const terminated = await this.terminateRoom(
          state,
          runtime,
          "CANONICAL_ROOM_CLOSED",
          now,
          true,
        );
        return { ...terminated, ok: true };
      }

      const byUserId = new Map<string, GroupFocusCanonicalMembershipSnapshot>();
      for (const membership of snapshot.memberships) byUserId.set(membership.userId, membership);
      let nextState = state;
      for (const participant of runtime.participants) {
        if (
          participant.connectionState === "DISCONNECTED"
          || participant.connectionState === "CANONICALLY_INVALIDATED"
        ) continue;
        const membership = byUserId.get(participant.userId);
        const expectedLectureId = canonicalRoom.mode === "SHARED_LECTURE"
          ? canonicalRoom.sharedLectureId
          : membership?.effectiveLectureId;
        let reason: string | null = null;
        if (!membership || membership.status !== "ACTIVE") {
          reason = "CANONICAL_MEMBERSHIP_INACTIVE";
        } else if (
          membership.membershipId !== participant.membershipId
          || membership.role !== participant.role
        ) {
          reason = "AUTHORIZATION_REFRESH_REQUIRED";
        } else if (expectedLectureId !== participant.effectiveLectureId) {
          reason = "AUTHORIZATION_REFRESH_REQUIRED";
        }
        if (reason) {
          const invalidated = await this.invalidateParticipant(
            nextState,
            runtime,
            participant,
            now,
            reason,
          );
          nextState = invalidated;
        }
      }
      runtime.lastCanonicalSyncAt = now;
      runtime.lastCanonicalSyncFailureAt = null;
      runtime.canonicalSyncFailureCount = 0;
      runtime.nextCanonicalSyncAt =
        now + GROUP_FOCUS_CANONICAL_RECONCILIATION_INTERVAL_SECONDS * 1000;
      runtime.canonicalReconciliationRequired = false;
      runtime.reconciliationError = null;
      await this.persistRuntimeState(nextState, runtime);
      return { state: nextState, runtime, ok: true };
    } catch (error) {
      runtime.lastCanonicalSyncFailureAt ??= now;
      runtime.canonicalSyncFailureCount = Math.min(
        runtime.canonicalSyncFailureCount + 1,
        1_000_000,
      );
      runtime.canonicalReconciliationRequired =
        now - runtime.lastCanonicalSyncAt > GROUP_FOCUS_CANONICAL_FAILURE_LIMIT_MILLISECONDS;
      const retrySeconds = Math.min(
        GROUP_FOCUS_CANONICAL_RECONCILIATION_INTERVAL_SECONDS,
        5 * 2 ** Math.min(runtime.canonicalSyncFailureCount - 1, 4),
      );
      runtime.nextCanonicalSyncAt = now + retrySeconds * 1000;
      runtime.reconciliationError = runtime.canonicalReconciliationRequired
        ? "CANONICAL_RECONCILIATION_REQUIRED"
        : runtime.reconciliationError;
      console.error("[GroupFocusRuntime] Canonical reconciliation failed.", {
        errorCode: "CANONICAL_RECONCILIATION_FAILED",
      });
      await this.persistRuntimeState(state, runtime);
      return { state, runtime, ok: false };
    }
  }

  private async invalidateParticipant(
    state: GroupFocusRoomState,
    runtime: GroupFocusRuntimeData,
    participant: GroupFocusRuntimeParticipant,
    now: number,
    reason: string,
  ): Promise<GroupFocusRoomState> {
    closeVerifiedFocusSegment(runtime, state, participant, now);
    participant.connectionState = "CANONICALLY_INVALIDATED";
    participant.connectionId = null;
    participant.lastDisconnectedAt = now;
    participant.resumeTokenHash = null;
    participant.resumeTokenExpiresAt = null;
    participant.reconnectDeadlineAt = null;
    const connections = state.connections.filter((connection) =>
      connection.userId !== participant.userId);
    const nextState = connections.length === state.connections.length
      ? state
      : {
        ...state,
        connections,
        revision: state.revision + 1,
        updatedAt: now,
      };
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.attachmentFor(socket);
      if (attachment?.userId !== participant.userId) continue;
      this.send(socket, messageEnvelope(
        "ERROR",
        nextState.revision,
        now,
        { code: reason },
      ));
      try {
        socket.close(4003, "Authorization refresh required");
      } catch {
        // The peer may already be closing.
      }
    }
    if (nextState !== state) {
      this.broadcast(
        messageEnvelope("PRESENCE_LEFT", nextState.revision, now, {
          sequence: nextState.revision,
          participant: {
            userId: participant.userId,
            role: participant.role,
            effectiveLectureId: participant.effectiveLectureId,
            connectedAt: participant.firstConnectedAt,
          },
        }),
      );
    }
    participant.connectionId = null;
    if (!runtime.participants.some((item) =>
      item.connectionState === "CONNECTED" || item.connectionState === "RECONNECTING")) {
      runtime.idleSinceAt = runtime.idleSinceAt ?? now;
    }
    return nextState;
  }

  private async terminateRoom(
    state: GroupFocusRoomState,
    runtime: GroupFocusRuntimeData,
    reason: GroupFocusSummaryTerminalReason,
    now: number,
    broadcastClosed: boolean,
  ): Promise<{ state: GroupFocusRoomState; runtime: GroupFocusRuntimeData }> {
    const endedAt = reason === "COMPLETED"
      ? (state.phaseStartedAt ?? now)
      : now;
    let terminalState = state;
    if (
      reason !== "COMPLETED"
      && state.phase !== "CLOSED"
      && state.phase !== "COMPLETED"
    ) {
      const closed = closeGroupFocusRoom(state, now);
      if (closed) terminalState = closed;
    }
    for (const participant of runtime.participants) {
      closeVerifiedFocusSegment(runtime, state, participant, endedAt);
      if (participant.connectionState === "CONNECTED") {
        participant.lastDisconnectedAt = endedAt;
      }
      participant.connectionState = "DISCONNECTED";
      participant.connectionId = null;
      participant.resumeTokenHash = null;
      participant.resumeTokenExpiresAt = null;
      participant.reconnectDeadlineAt = null;
      participant.activeFocusSegmentStartedAt = null;
    }
    terminalState = { ...terminalState, connections: [] };
    runtime.idleSinceAt = null;
    if (!runtime.summary) {
      const body = createFrozenSummary(runtime, terminalState, reason, endedAt);
      const bodyBytes = new TextEncoder().encode(JSON.stringify(body));
      const bodyDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", bodyBytes));
      const bodyHash = Array.from(bodyDigest, (byte) =>
        byte.toString(16).padStart(2, "0")).join("");
      runtime.terminalReason = reason;
      runtime.terminalAt = endedAt;
      runtime.summary = {
        body,
        bodyHash,
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: now,
        acknowledgedAt: null,
        retentionUntil: now + GROUP_FOCUS_SUMMARY_RETRY_RETENTION_SECONDS * 1000,
      };
    }
    await this.persistRuntimeState(terminalState, runtime);
    const terminalMessage = messageEnvelope(
      broadcastClosed ? "ROOM_CLOSED" : "PHASE_CHANGED",
      terminalState.revision,
      now,
      { roomState: roomStateSnapshot(terminalState) },
    );
    this.broadcast(terminalMessage);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.close(1000, broadcastClosed ? "Room closed" : "Room completed");
      } catch {
        // The peer may already be closing.
      }
    }
    await this.deliverSummary(runtime, terminalState, now);
    return { state: terminalState, runtime };
  }

  private async deliverSummary(
    runtime: GroupFocusRuntimeData,
    state: GroupFocusRoomState,
    now: number,
  ): Promise<void> {
    const pending = runtime.summary;
    if (!pending || pending.status !== "PENDING") return;
    if (pending.retentionUntil !== null && now >= pending.retentionUntil) {
      pending.status = "FAILED_PERMANENT";
      pending.nextAttemptAt = null;
      pending.retentionUntil = now + GROUP_FOCUS_SUMMARY_ACK_RETENTION_SECONDS * 1000;
      await this.persistRuntimeState(state, runtime);
      return;
    }
    if (pending.nextAttemptAt !== null && pending.nextAttemptAt > now) return;
    try {
      const serialized = JSON.stringify(pending.body);
      const bodyBytes = new TextEncoder().encode(serialized);
      if (bodyBytes.byteLength > GROUP_FOCUS_SUMMARY_MAX_BODY_BYTES) {
        pending.status = "FAILED_PERMANENT";
        pending.nextAttemptAt = null;
        pending.retentionUntil = now + GROUP_FOCUS_SUMMARY_ACK_RETENTION_SECONDS * 1000;
      } else {
        const { response, value } = await this.postMachineJson<unknown>(
          "/api/internal/group-focus/runtime/summary",
          pending.body,
          GROUP_FOCUS_SUMMARY_MAX_BODY_BYTES,
        );
        pending.attempts += 1;
        if (
          response.ok
          && isRecord(value)
          && value.summaryId === pending.body.summaryId
          && (value.status === "APPLIED" || value.status === "REPLAY")
          && typeof value.runId === "string"
          && UUID.test(value.runId)
        ) {
          pending.status = "ACKED";
          pending.acknowledgedAt = now;
          pending.nextAttemptAt = null;
          pending.retentionUntil =
            now + GROUP_FOCUS_SUMMARY_ACK_RETENTION_SECONDS * 1000;
        } else if (
          response.status === 409
          && isRecord(value)
          && value.code === "SUMMARY_CONFLICT"
        ) {
          pending.status = "FAILED_CONFLICT";
          pending.nextAttemptAt = null;
          pending.retentionUntil = now + GROUP_FOCUS_SUMMARY_ACK_RETENTION_SECONDS * 1000;
        } else if (response.status >= 500 || response.status === 408 || response.status === 429) {
          pending.nextAttemptAt = now + nextRetryDelay(pending.attempts - 1);
        } else {
          pending.status = "FAILED_PERMANENT";
          pending.nextAttemptAt = null;
          pending.retentionUntil = now + GROUP_FOCUS_SUMMARY_ACK_RETENTION_SECONDS * 1000;
        }
      }
    } catch {
      pending.attempts += 1;
      pending.nextAttemptAt = now + nextRetryDelay(pending.attempts - 1);
      console.error("[GroupFocusRuntime] Terminal summary delivery failed.", {
        errorCode: "TERMINAL_SUMMARY_DELIVERY_FAILED",
        attemptsBucket: pending.attempts >= 5 ? "5_PLUS" : String(pending.attempts),
      });
    }
    await this.persistRuntimeState(state, runtime);
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
    runtime: GroupFocusRuntimeData,
    now: number,
  ): Promise<GroupFocusRoomState> {
    const advanced = advanceGroupFocusRoomState(state, now);
    if (advanced.transitions.length === 0) return state;
    applyScheduledTransitions(runtime, state, advanced.transitions);
    if (advanced.state.phase === "COMPLETED") {
      const terminated = await this.terminateRoom(
        advanced.state,
        runtime,
        "COMPLETED",
        advanced.state.phaseStartedAt ?? now,
        false,
      );
      return terminated.state;
    }
    await this.persistRuntimeState(advanced.state, runtime);
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
      || url.searchParams.has("resume")
      || url.searchParams.has("resumeToken")
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

    const resumeToken = request.headers.get(GROUP_FOCUS_REALTIME_INTERNAL_RESUME_HEADER);
    if (resumeToken && !/^[A-Za-z0-9_-]{43}$/u.test(resumeToken)) {
      return jsonError(401, "INVALID_RESUME_CREDENTIAL");
    }

    const now = Date.now();
    let state: GroupFocusRoomState;
    let runtime: GroupFocusRuntimeData;
    try {
      const stored = await this.readState();
      if (stored) {
        if (!groupFocusRoomConfigurationMatches(stored, capability)) {
          return jsonError(409, "ROOM_CONFIGURATION_MISMATCH");
        }
        runtime = await this.ensureRuntime(stored, now);
        state = await this.normalizeDueState(stored, runtime, now);
      } else {
        state = createInitialGroupFocusRoomState(capability, now);
        runtime = createGroupFocusRuntimeData(roomId, now);
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
    let participant = runtime.participants.find((item) => item.userId === capability.userId);
    const currentSocket = existingSockets.find((socket) =>
      this.attachmentFor(socket)?.userId === capability.userId && socket.readyState === 1);

    if (
      participant
      && participant.connectionState === "CONNECTED"
      && !currentSocket
    ) {
      stopParticipantConnection(runtime, state, participant, now, "RECONNECTING");
      await this.persistRuntimeState(state, runtime);
    }

    if (
      participant
      && participant.connectionState !== "DISCONNECTED"
      && participant.connectionState !== "CANONICALLY_INVALIDATED"
      && (
        participant.membershipId !== capability.membershipId
        || participant.role !== capability.role
        || participant.effectiveLectureId !== capability.effectiveLectureId
      )
    ) {
      const invalidated = await this.invalidateParticipant(
        state,
        runtime,
        participant,
        now,
        "AUTHORIZATION_REFRESH_REQUIRED",
      );
      await this.persistRuntimeState(invalidated, runtime);
      return jsonError(403, "AUTHORIZATION_REFRESH_REQUIRED");
    }

    let reconnecting = false;
    if (resumeToken) {
      if (!participant || !participant.resumeTokenHash) {
        return jsonError(401, "INVALID_RESUME_TOKEN");
      }
      const suppliedHash = await hashResumeToken(resumeToken);
      if (
        participant.resumeTokenExpiresAt === null
        || participant.resumeTokenExpiresAt <= now
        || !constantTimeStringEqual(participant.resumeTokenHash, suppliedHash)
        || !["CONNECTED", "RECONNECTING"].includes(participant.connectionState)
      ) {
        return jsonError(401, "INVALID_RESUME_TOKEN");
      }
      if (
        participant.connectionState === "RECONNECTING"
        && participant.reconnectDeadlineAt !== null
        && participant.reconnectDeadlineAt <= now
      ) {
        participant.connectionState = "DISCONNECTED";
        participant.resumeTokenHash = null;
        participant.resumeTokenExpiresAt = null;
        participant.reconnectDeadlineAt = null;
        const expiredState = {
          ...state,
          revision: state.revision + 1,
          updatedAt: now,
        };
        await this.persistRuntimeState(expiredState, runtime);
        this.broadcast(messageEnvelope("PRESENCE_LEFT", expiredState.revision, now, {
          sequence: expiredState.revision,
          participant: publicParticipantFromRuntime(participant),
        }));
        return jsonError(401, "INVALID_RESUME_TOKEN");
      }
      reconnecting = true;
    } else if (
      participant
      && (participant.connectionState === "CONNECTED"
        || participant.connectionState === "RECONNECTING")
    ) {
      return jsonError(409, "RESUME_REQUIRED");
    }

    if (!participant && resumeToken) {
      return jsonError(401, "INVALID_RESUME_TOKEN");
    }
    if (
      !participant
      && runtime.participants.length >= 25
    ) {
      return jsonError(409, "ROOM_PARTICIPANT_LIMIT_REACHED");
    }
    const otherLiveConnections = liveConnections.filter((item) =>
      item.userId !== capability.userId);
    if (otherLiveConnections.length >= state.maxParticipants) {
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
    const nextResumeToken = randomToken(32);
    const nextResumeHash = await hashResumeToken(nextResumeToken);
    const reconnectCount = participant
      ? participant.reconnectCount + (reconnecting || participant.connectionState === "DISCONNECTED"
        || participant.connectionState === "CANONICALLY_INVALIDATED" ? 1 : 0)
      : 0;
    if (participant && participant.connectionState === "CONNECTED") {
      closeVerifiedFocusSegment(runtime, state, participant, now);
    }
    if (!participant) {
      participant = createRuntimeParticipant(
        capability,
        attachment,
        nextResumeHash,
        now,
        state.roundCount,
      );
    } else {
      const disconnectedAt = participant.lastDisconnectedAt;
      participant.membershipId = capability.membershipId;
      participant.role = capability.role;
      participant.effectiveLectureId = capability.effectiveLectureId;
      participant.connectionState = "CONNECTED";
      participant.connectionId = attachment.connectionId;
      participant.lastConnectedAt = now;
      participant.lastDisconnectedAt = disconnectedAt;
      participant.reconnectCount = reconnectCount;
      participant.resumeTokenHash = nextResumeHash;
      participant.resumeTokenExpiresAt = now + GROUP_FOCUS_RESUME_TOKEN_TTL_MILLISECONDS;
      participant.reconnectDeadlineAt = null;
    }
    participant.connectionState = "CONNECTED";
    participant.connectionId = attachment.connectionId;
    participant.lastConnectedAt = now;
    participant.resumeTokenHash = nextResumeHash;
    participant.resumeTokenExpiresAt = now + GROUP_FOCUS_RESUME_TOKEN_TTL_MILLISECONDS;
    participant.reconnectDeadlineAt = null;
    startParticipantFocusSegment(runtime, state, participant, now);
    if (!runtime.participants.includes(participant)) runtime.participants.push(participant);

    const pair = new WebSocketPair();
    const clientSocket = pair[0];
    const serverSocket = pair[1];
    try {
      this.ctx.acceptWebSocket(serverSocket);
      serverSocket.serializeAttachment(attachment);
      const connections = [
        ...otherLiveConnections,
        attachment,
      ]
        .sort((left, right) => left.userId.localeCompare(right.userId));
      state = {
        ...state,
        connections,
        revision: state.revision + 1,
        updatedAt: now,
      };
      for (const oldSocket of existingSockets) {
        const oldAttachment = this.attachmentFor(oldSocket);
        if (
          oldAttachment?.userId === capability.userId
          && oldAttachment.connectionId !== attachment.connectionId
        ) {
          try {
            oldSocket.close(4001, "Connection replaced");
          } catch {
            // A stale or replaced transport can already be closing.
          }
        }
      }
      await this.persistRuntimeState(state, runtime);
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
        "RESUME_TOKEN",
        state.revision,
        now,
        { resumeToken: nextResumeToken },
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
          participants: state.connections.map((connection) => {
            const current = runtime.participants.find((item) =>
              item.userId === connection.userId);
            return {
              ...publicParticipant(connection),
              connectionState: current?.connectionState === "RECONNECTING"
                ? "RECONNECTING"
                : "CONNECTED",
            };
          }),
        },
      ),
    );
    const joined = messageEnvelope(
      "PRESENCE_JOINED",
      state.revision,
      now,
      {
        sequence: state.revision,
        participant: {
          ...publicParticipant(attachment),
          connectionState: "CONNECTED",
        },
      },
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
    let runtime: GroupFocusRuntimeData;
    try {
      state = await this.readState();
      if (state) {
        runtime = await this.ensureRuntime(state, now);
        state = await this.normalizeDueState(state, runtime, now);
      } else {
        runtime = createGroupFocusRuntimeData("", now);
      }
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
    if (message.type === "CLIENT_LEAVE") {
      const participant = runtime.participants.find((item) =>
        item.userId === attachment.userId
        && item.connectionId === attachment.connectionId);
      const connections = state.connections.filter((item) =>
        item.connectionId !== attachment.connectionId);
      if (participant) {
        stopParticipantConnection(runtime, state, participant, now, "DISCONNECTED");
        participant.resumeTokenHash = null;
        participant.resumeTokenExpiresAt = null;
        participant.reconnectDeadlineAt = null;
      }
      const next = {
        ...state,
        connections,
        revision: state.revision + 1,
        updatedAt: now,
      };
      try {
        await this.persistRuntimeState(next, runtime);
      } catch {
        this.send(socket, messageEnvelope(
          "ERROR",
          state.revision,
          now,
          { code: "ROOM_STATE_UNAVAILABLE" },
        ));
        return;
      }
      this.broadcast(
        messageEnvelope("PRESENCE_LEFT", next.revision, now, {
          sequence: next.revision,
          participant: publicParticipant(attachment),
        }),
        attachment.connectionId,
      );
      try {
        socket.close(1000, "Client left");
      } catch {
        // The peer may already be closing.
      }
      return;
    }
    if (attachment.role !== "HOST") {
      this.send(
        socket,
        messageEnvelope("ERROR", state.revision, now, { code: "NOT_ROOM_HOST" }),
      );
      return;
    }
    if (now - runtime.lastCanonicalSyncAt > GROUP_FOCUS_HOST_CONTROL_FRESHNESS_MILLISECONDS) {
      const synced = await this.syncCanonicalRoom(state, runtime, now);
      state = synced.state;
      runtime = synced.runtime;
      if (!synced.ok) {
        this.send(socket, messageEnvelope(
          "ERROR",
          state.revision,
          now,
          { code: "CANONICAL_RECONCILIATION_REQUIRED" },
        ));
        return;
      }
    }
    const currentHost = runtime.participants.find((participant) =>
      participant.userId === attachment.userId
      && participant.connectionId === attachment.connectionId
      && participant.connectionState === "CONNECTED");
    if (!currentHost || runtime.canonicalReconciliationRequired || runtime.reconciliationError) {
      this.send(socket, messageEnvelope(
        "ERROR",
        state.revision,
        now,
        { code: "CANONICAL_RECONCILIATION_REQUIRED" },
      ));
      return;
    }
    if (state.phase === "CLOSED" || state.phase === "COMPLETED") {
      this.send(
        socket,
        messageEnvelope("ERROR", state.revision, now, { code: "ROOM_UNAVAILABLE" }),
      );
      return;
    }

    if (message.type === "HOST_PAUSE" || message.type === "HOST_CLOSE") {
      for (const participant of runtime.participants) {
        if (participant.connectionState === "CONNECTED") {
          closeVerifiedFocusSegment(runtime, state, participant, now);
        }
      }
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
      try {
        await this.terminateRoom(state, runtime, "HOST_CLOSED", now, true);
      } catch {
        this.send(
          socket,
          messageEnvelope("ERROR", state.revision, now, { code: "ROOM_STATE_UNAVAILABLE" }),
        );
      }
      return;
    }

    if (message.type === "HOST_RESUME" && next.phase === "FOCUS") {
      for (const participant of runtime.participants) {
        if (participant.connectionState === "CONNECTED") {
          participant.activeFocusSegmentStartedAt = now;
        }
      }
    }
    try {
      await this.persistRuntimeState(next, runtime);
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
        applyScheduledTransitions(runtime, next, advanced.transitions);
        if (advanced.state.phase === "COMPLETED") {
          await this.terminateRoom(
            advanced.state,
            runtime,
            "COMPLETED",
            advanced.state.phaseStartedAt ?? now,
            false,
          );
          return;
        }
        try {
          await this.persistRuntimeState(advanced.state, runtime);
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
    let runtime: GroupFocusRuntimeData;
    try {
      state = await this.readState();
      if (state) runtime = await this.ensureRuntime(state, Date.now());
      else runtime = createGroupFocusRuntimeData("", Date.now());
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
    const participant = runtime.participants.find((item) =>
      item.userId === attachment.userId
      && item.connectionId === attachment.connectionId);
    if (participant) {
      stopParticipantConnection(runtime, state, participant, now, "RECONNECTING");
    }
    try {
      await this.persistRuntimeState(next, runtime);
    } catch {
      return;
    }
    this.broadcast(
      messageEnvelope(
        "PRESENCE_JOINED",
        next.revision,
        now,
        {
          sequence: next.revision,
          participant: {
            ...publicParticipant(attachment),
            connectionState: "RECONNECTING",
          },
        },
      ),
      attachment.connectionId,
    );
  }
}