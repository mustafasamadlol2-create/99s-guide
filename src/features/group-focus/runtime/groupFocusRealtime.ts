import {
  requestGroupFocusCapability,
  type GroupFocusCapabilityResponse,
} from "../api/groupFocusApi.js";
import {
  GROUP_FOCUS_REALTIME_PROTOCOL,
  GROUP_FOCUS_REALTIME_AUTH_PREFIX,
  parseGroupFocusRealtimeServerMessage,
  type GroupFocusRealtimeParticipant,
  type GroupFocusRealtimePhase,
  type GroupFocusRealtimeRoomState,
} from "../../../../shared/group-focus-realtime/protocol.js";

export type GroupFocusRealtimeStatus =
  | "IDLE"
  | "CONNECTING"
  | "CONNECTED"
  | "DISCONNECTED"
  | "ERROR";

export type GroupFocusRealtimeError = {
  code: string;
  message: string;
};

export type GroupFocusRealtimeSnapshot = {
  status: GroupFocusRealtimeStatus;
  roomId: string;
  connectionId: string | null;
  userId: string | null;
  role: "HOST" | "MEMBER" | null;
  revision: number;
  roomState: GroupFocusRealtimeRoomState | null;
  presence: GroupFocusRealtimeParticipant[];
  estimatedServerNow: number | null;
  error: GroupFocusRealtimeError | null;
};

export type GroupFocusRealtimeSocket = {
  readonly readyState: number;
  readonly protocol: string;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type GroupFocusRealtimeRuntimeOptions = {
  roomId: string;
  workerUrl: string;
  capabilityFetcher?: (roomId: string) => Promise<GroupFocusCapabilityResponse>;
  webSocketFactory?: (
    url: string,
    protocols: string[],
  ) => GroupFocusRealtimeSocket;
  monotonicNow?: () => number;
};

export class GroupFocusRealtimeRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GroupFocusRealtimeRuntimeError";
  }
}

function resolveWebSocketUrl(workerUrl: string, roomId: string): string {
  let url: URL;
  try {
    url = new URL(workerUrl);
  } catch {
    throw new GroupFocusRealtimeRuntimeError(
      "WORKER_URL_INVALID",
      "Group Focus realtime is not configured with a valid Worker URL.",
    );
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:"
      && url.protocol !== "wss:" && url.protocol !== "ws:")
    || url.username.length > 0
    || url.password.length > 0
    || url.search.length > 0
    || url.hash.length > 0
    || (url.pathname !== "/" && url.pathname.length > 0)
  ) {
    throw new GroupFocusRealtimeRuntimeError(
      "WORKER_URL_INVALID",
      "Group Focus realtime requires a Worker origin without credentials or query parameters.",
    );
  }
  url.protocol = url.protocol === "https:" ? "wss:"
    : url.protocol === "http:" ? "ws:"
      : url.protocol;
  url.pathname = `/rooms/${encodeURIComponent(roomId)}/connect`;
  return url.toString();
}

function defaultWebSocketFactory(
  url: string,
  protocols: string[],
): GroupFocusRealtimeSocket {
  return new WebSocket(url, protocols);
}

function defaultMonotonicNow(): number {
  return globalThis.performance?.now?.() ?? 0;
}

function safeServerMessageCode(code: unknown): string {
  return typeof code === "string" && /^[A-Z0-9_]{1,64}$/u.test(code)
    ? code
    : "INVALID_SERVER_MESSAGE";
}

function phaseHasDeadline(phase: GroupFocusRealtimePhase): boolean {
  return phase === "COUNTDOWN" || phase === "FOCUS" || phase === "BREAK";
}

export class GroupFocusRealtimeRuntime {
  private readonly capabilityFetcher: (roomId: string) => Promise<GroupFocusCapabilityResponse>;
  private readonly webSocketFactory: (
    url: string,
    protocols: string[],
  ) => GroupFocusRealtimeSocket;
  private readonly monotonicNow: () => number;
  private readonly webSocketUrl: string;
  private listeners = new Set<(snapshot: GroupFocusRealtimeSnapshot) => void>();
  private socket: GroupFocusRealtimeSocket | null = null;
  private snapshot: GroupFocusRealtimeSnapshot;
  private sampleReceivedAt: number | null = null;
  private lastPresenceSequence = -1;
  private generation = 0;
  private pendingConnectionReject:
    | ((error: GroupFocusRealtimeRuntimeError) => void)
    | null = null;

  constructor(private readonly options: GroupFocusRealtimeRuntimeOptions) {
    this.capabilityFetcher = options.capabilityFetcher ?? requestGroupFocusCapability;
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory;
    this.monotonicNow = options.monotonicNow ?? defaultMonotonicNow;
    this.webSocketUrl = resolveWebSocketUrl(options.workerUrl, options.roomId);
    this.snapshot = {
      status: "IDLE",
      roomId: options.roomId,
      connectionId: null,
      userId: null,
      role: null,
      revision: -1,
      roomState: null,
      presence: [],
      estimatedServerNow: null,
      error: null,
    };
  }

  getSnapshot(): GroupFocusRealtimeSnapshot {
    return {
      ...this.snapshot,
      roomState: this.snapshot.roomState ? { ...this.snapshot.roomState } : null,
      presence: this.snapshot.presence.map((participant) => ({ ...participant })),
      error: this.snapshot.error ? { ...this.snapshot.error } : null,
    };
  }

  subscribe(listener: (snapshot: GroupFocusRealtimeSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  getRemainingMilliseconds(): number | null {
    const roomState = this.snapshot.roomState;
    if (!roomState) return null;
    if (roomState.phase === "PAUSED") {
      return roomState.pausedRemainingMilliseconds;
    }
    if (!phaseHasDeadline(roomState.phase) || roomState.phaseEndsAt === null) return null;
    const elapsed = this.sampleReceivedAt === null
      ? 0
      : Math.max(0, this.monotonicNow() - this.sampleReceivedAt);
    const serverNow = this.snapshot.estimatedServerNow ?? 0;
    return Math.max(0, roomState.phaseEndsAt - serverNow - elapsed);
  }

  async connect(): Promise<void> {
    if (this.snapshot.status === "CONNECTING" || this.snapshot.status === "CONNECTED") {
      throw new GroupFocusRealtimeRuntimeError(
        "ALREADY_CONNECTING",
        "This Group Focus realtime runtime is already connecting or connected.",
      );
    }
    if (this.socket) {
      const previous = this.socket;
      this.socket = null;
      previous.onopen = null;
      previous.onmessage = null;
      previous.onerror = null;
      previous.onclose = null;
      try {
        previous.close(1000, "Replacing failed connection");
      } catch {
        // The previous socket is already closed.
      }
    }
    this.generation += 1;
    const generation = this.generation;
    this.sampleReceivedAt = null;
    this.lastPresenceSequence = -1;
    this.update({
      status: "CONNECTING",
      connectionId: null,
      userId: null,
      role: null,
      revision: -1,
      roomState: null,
      presence: [],
      estimatedServerNow: null,
      error: null,
    });

    let capability: GroupFocusCapabilityResponse;
    try {
      capability = await this.capabilityFetcher(this.options.roomId);
    } catch (error) {
      if (generation !== this.generation) return;
      const failure = new GroupFocusRealtimeRuntimeError(
        "CAPABILITY_ISSUANCE_FAILED",
        "Group Focus could not issue a short-lived realtime capability.",
      );
      this.update({
        status: "ERROR",
        error: { code: failure.code, message: failure.message },
      });
      throw failure;
    }
    if (generation !== this.generation) return;

    let socket: GroupFocusRealtimeSocket;
    try {
      const protocols = [
        GROUP_FOCUS_REALTIME_PROTOCOL,
        `${GROUP_FOCUS_REALTIME_AUTH_PREFIX}${capability.capabilityToken}`,
      ];
      socket = this.webSocketFactory(this.webSocketUrl, protocols);
      protocols[1] = "";
      capability = { ...capability, capabilityToken: "" };
    } catch (error) {
      if (generation !== this.generation) return;
      const failure = error instanceof GroupFocusRealtimeRuntimeError
        ? error
        : new GroupFocusRealtimeRuntimeError(
          "CONNECTION_FAILED",
          "Group Focus realtime could not start a WebSocket connection.",
        );
      this.update({
        status: "ERROR",
        error: { code: failure.code, message: failure.message },
      });
      throw failure;
    }

    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let transportError: GroupFocusRealtimeError | null = null;
      const fail = (failure: GroupFocusRealtimeRuntimeError) => {
        if (settled) return;
        settled = true;
        this.pendingConnectionReject = null;
        if (this.socket === socket) this.socket = null;
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        try {
          socket.close(1002, "Connection failed");
        } catch {
          // The connection is already closing.
        }
        this.update({
          status: "ERROR",
          error: { code: failure.code, message: failure.message },
        });
        reject(failure);
      };

      socket.onopen = () => {
        if (generation !== this.generation || settled) return;
        if (socket.protocol !== GROUP_FOCUS_REALTIME_PROTOCOL) {
          fail(new GroupFocusRealtimeRuntimeError(
            "PROTOCOL_NEGOTIATION_FAILED",
            "Group Focus realtime did not negotiate the supported protocol.",
          ));
          return;
        }
        settled = true;
        this.pendingConnectionReject = null;
        this.update({ status: "CONNECTED", error: null });
        resolve();
      };

      socket.onmessage = (event) => {
        if (generation === this.generation) this.handleMessage(event.data);
      };

      socket.onerror = () => {
        if (generation !== this.generation) return;
        const failure = new GroupFocusRealtimeRuntimeError(
          "CONNECTION_FAILED",
          "The Group Focus realtime connection failed.",
        );
        if (!settled) {
          fail(failure);
        } else {
          transportError = { code: failure.code, message: failure.message };
          this.update({
            status: "ERROR",
            error: transportError,
          });
        }
      };

      socket.onclose = () => {
        if (generation !== this.generation) return;
        this.socket = null;
        if (!settled) {
          fail(new GroupFocusRealtimeRuntimeError(
            "CONNECTION_CLOSED",
            "The Group Focus realtime connection closed before it was established.",
          ));
          return;
        }
        this.update({
          status: "DISCONNECTED",
          error: transportError,
        });
      };
      this.pendingConnectionReject = fail;
    });
  }

  requestRoomState(): void {
    this.send("ROOM_STATE_REQUEST");
  }

  start(): void {
    this.send("HOST_START");
  }

  pause(): void {
    this.send("HOST_PAUSE");
  }

  resume(): void {
    this.send("HOST_RESUME");
  }

  closeRoom(): void {
    this.send("HOST_CLOSE");
  }

  dispose(): void {
    this.pendingConnectionReject?.(
      new GroupFocusRealtimeRuntimeError(
        "CONNECTION_CANCELLED",
        "The Group Focus realtime connection was cancelled.",
      ),
    );
    this.pendingConnectionReject = null;
    this.generation += 1;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close(1000, "Client disposed");
      } catch {
        // Already closed.
      }
    }
    this.update({ status: "DISCONNECTED" });
    this.listeners.clear();
  }

  private send(type: "ROOM_STATE_REQUEST" | "HOST_START" | "HOST_PAUSE" | "HOST_RESUME" | "HOST_CLOSE"): void {
    if (!this.socket || this.socket.readyState !== 1) {
      throw new GroupFocusRealtimeRuntimeError(
        "NOT_CONNECTED",
        "Connect to Group Focus realtime before sending a room command.",
      );
    }
    this.socket.send(JSON.stringify({ v: 1, type }));
  }

  private handleMessage(data: unknown): void {
    const message = parseGroupFocusRealtimeServerMessage(data);
    if (!message) {
      this.update({
        error: {
          code: "INVALID_SERVER_MESSAGE",
          message: "Group Focus realtime sent an invalid message.",
        },
      });
      return;
    }
    if (message.revision < this.snapshot.revision) return;
    this.sampleReceivedAt = this.monotonicNow();
    this.snapshot = {
      ...this.snapshot,
      revision: message.revision,
      estimatedServerNow: message.serverNow,
    };

    switch (message.type) {
      case "CONNECTED":
        this.snapshot = {
          ...this.snapshot,
          connectionId: message.payload.connectionId as string,
          userId: message.payload.userId as string,
          role: message.payload.role as "HOST" | "MEMBER",
          error: null,
        };
        break;
      case "ROOM_STATE":
      case "PHASE_CHANGED":
      case "ROOM_CLOSED":
        this.snapshot = {
          ...this.snapshot,
          roomState: message.payload.roomState as GroupFocusRealtimeRoomState,
          error: null,
        };
        break;
      case "PRESENCE_SNAPSHOT": {
        const sequence = message.payload.sequence as number;
        if (sequence < this.lastPresenceSequence) return;
        this.lastPresenceSequence = sequence;
        this.snapshot = {
          ...this.snapshot,
          presence: (message.payload.participants as GroupFocusRealtimeParticipant[])
            .map((participant) => ({ ...participant })),
        };
        break;
      }
      case "PRESENCE_JOINED": {
        const sequence = message.payload.sequence as number;
        if (sequence < this.lastPresenceSequence) return;
        this.lastPresenceSequence = sequence;
        const participant = message.payload.participant as GroupFocusRealtimeParticipant;
        const withoutUser = this.snapshot.presence.filter(
          (current) => current.userId !== participant.userId,
        );
        this.snapshot = {
          ...this.snapshot,
          presence: [...withoutUser, { ...participant }].sort(
            (left, right) => left.userId.localeCompare(right.userId),
          ),
        };
        break;
      }
      case "PRESENCE_LEFT": {
        const sequence = message.payload.sequence as number;
        if (sequence < this.lastPresenceSequence) return;
        this.lastPresenceSequence = sequence;
        const participant = message.payload.participant as GroupFocusRealtimeParticipant;
        this.snapshot = {
          ...this.snapshot,
          presence: this.snapshot.presence.filter(
            (current) => current.userId !== participant.userId,
          ),
        };
        break;
      }
      case "ERROR": {
        const code = safeServerMessageCode(message.payload.code);
        this.snapshot = {
          ...this.snapshot,
          error: {
            code,
            message: "The Group Focus realtime request was rejected.",
          },
        };
        break;
      }
    }
    this.emit();
  }

  private update(
    update: Partial<GroupFocusRealtimeSnapshot>,
  ): void {
    this.snapshot = { ...this.snapshot, ...update };
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export function createGroupFocusRealtimeRuntime(
  options: GroupFocusRealtimeRuntimeOptions,
): GroupFocusRealtimeRuntime {
  if (!options.roomId || !UUID.test(options.roomId)) {
    throw new GroupFocusRealtimeRuntimeError(
      "ROOM_ID_INVALID",
      "Group Focus realtime requires a valid Room ID.",
    );
  }
  if (!options.workerUrl) {
    throw new GroupFocusRealtimeRuntimeError(
      "WORKER_URL_MISSING",
      "Group Focus realtime Worker URL is not configured.",
    );
  }
  return new GroupFocusRealtimeRuntime(options);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;