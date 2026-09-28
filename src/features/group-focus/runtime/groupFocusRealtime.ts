import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import {
  requestGroupFocusCapability,
  type GroupFocusCapabilityResponse,
} from "../api/groupFocusApi.js";
import {
  GROUP_FOCUS_REALTIME_PROTOCOL,
  GROUP_FOCUS_REALTIME_AUTH_PREFIX,
  GROUP_FOCUS_REALTIME_RESUME_PREFIX,
  parseGroupFocusRealtimeServerMessage,
  type GroupFocusRealtimeParticipant,
  type GroupFocusRealtimePhase,
  type GroupFocusRealtimeRoomState,
} from "../../../../shared/group-focus-realtime/protocol.js";
import { decodeBase64Url } from "../../../../shared/group-focus-capability/encoding.js";

export type GroupFocusRealtimeStatus =
  | "IDLE"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING"
  | "DISCONNECTED"
  | "TERMINAL"
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
  accountId?: string;
  capabilityFetcher?: (roomId: string) => Promise<GroupFocusCapabilityResponse>;
  webSocketFactory?: (
    url: string,
    protocols: string[],
  ) => GroupFocusRealtimeSocket;
  monotonicNow?: () => number;
  resumeTokenStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
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

function capabilitySubject(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  const decoded = decodeBase64Url(payload);
  if (!decoded) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(decoded));
    if (
      typeof value === "object"
      && value !== null
      && !Array.isArray(value)
      && typeof (value as Record<string, unknown>).sub === "string"
      && UUID.test((value as Record<string, unknown>).sub as string)
    ) return (value as Record<string, unknown>).sub as string;
  } catch {
    return null;
  }
  return null;
}

function resumeStorageKey(accountId: string, roomId: string): string {
  return `group-focus:resume:v1:${encodeURIComponent(accountId)}:${roomId}`;
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
  private reconnectAttempts = 0;
  private reconnectStartedAt: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectInFlight: Promise<void> | null = null;
  private connectionAttempt: Promise<void> | null = null;
  private reconnectEnabled = false;
  private disposed = false;
  private resumeToken: string | null = null;
  private resumeStorageKey: string | null = null;
  private currentAccountId: string | null = null;
  private nativeLifecycleListener: Promise<PluginListenerHandle | null> | null = null;
  private readonly onlineHandler = () => { void this.retryConnection(); };
  private readonly visibilityHandler = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      this.notifyApplicationActive();
    }
  };

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
    if (typeof window !== "undefined") window.addEventListener("online", this.onlineHandler);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }
    if (Capacitor.isNativePlatform()) {
      this.nativeLifecycleListener = CapacitorApp.addListener(
        "appStateChange",
        ({ isActive }) => {
          if (isActive) this.notifyApplicationActive();
        },
      ).catch(() => null);
    }
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
    if (this.snapshot.status === "TERMINAL") {
      throw new GroupFocusRealtimeRuntimeError(
        "ROOM_TERMINAL",
        "This Group Focus Room has already ended.",
      );
    }
    if (this.snapshot.status === "CONNECTING" || this.snapshot.status === "CONNECTED") {
      throw new GroupFocusRealtimeRuntimeError(
        "ALREADY_CONNECTING",
        "This Group Focus realtime runtime is already connecting or connected.",
      );
    }
    this.disposed = false;
    this.reconnectEnabled = true;
    this.reconnectAttempts = 0;
    this.reconnectStartedAt = null;
    this.clearReconnectTimer();
    const attempt = this.connectWithFreshCapability(false);
    this.connectionAttempt = attempt;
    try {
      await attempt;
    } catch (error) {
      if (this.reconnectEnabled && !this.disposed) {
        this.reconnectStartedAt ??= Date.now();
        if (this.connectionAttempt === attempt) this.connectionAttempt = null;
        this.scheduleReconnect();
      }
      throw error;
    } finally {
      if (this.connectionAttempt === attempt) this.connectionAttempt = null;
    }
  }

  private async connectWithFreshCapability(reconnecting: boolean): Promise<void> {
    if (this.snapshot.status === "TERMINAL" || this.disposed) return;
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
        status: reconnecting ? "RECONNECTING" : "ERROR",
        error: { code: failure.code, message: failure.message },
      });
      throw failure;
    }
    if (generation !== this.generation) return;

    const accountId = capabilitySubject(capability.capabilityToken)
      ?? this.options.accountId
      ?? this.currentAccountId;
    if (accountId && UUID.test(accountId)) {
      if (this.currentAccountId !== null && this.currentAccountId !== accountId) {
        this.clearStoredResumeToken();
      }
      this.currentAccountId = accountId;
      const key = resumeStorageKey(accountId, this.options.roomId);
      if (this.resumeStorageKey !== key) this.resumeToken = null;
      this.resumeStorageKey = key;
      this.resumeToken = this.resumeToken ?? this.readStoredResumeToken(key);
    } else {
      this.clearStoredResumeToken();
      this.currentAccountId = null;
    }
    let resumeToken = this.resumeToken;
    let socket: GroupFocusRealtimeSocket;
    try {
      const protocols = [
        GROUP_FOCUS_REALTIME_PROTOCOL,
        `${GROUP_FOCUS_REALTIME_AUTH_PREFIX}${capability.capabilityToken}`,
      ];
      if (resumeToken) {
        protocols.push(`${GROUP_FOCUS_REALTIME_RESUME_PREFIX}${resumeToken}`);
      }
      socket = this.webSocketFactory(this.webSocketUrl, protocols);
      for (let index = 1; index < protocols.length; index += 1) protocols[index] = "";
      capability = { ...capability, capabilityToken: "" };
      resumeToken = null;
    } catch (error) {
      if (generation !== this.generation) return;
      const failure = error instanceof GroupFocusRealtimeRuntimeError
        ? error
        : new GroupFocusRealtimeRuntimeError(
          "CONNECTION_FAILED",
          "Group Focus realtime could not start a WebSocket connection.",
        );
      this.update({
        status: reconnecting ? "RECONNECTING" : "ERROR",
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
          status: reconnecting ? "RECONNECTING" : "ERROR",
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
        this.reconnectAttempts = 0;
        this.reconnectStartedAt = null;
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
            status: reconnecting ? "RECONNECTING" : "ERROR",
            error: transportError,
          });
        }
      };

      socket.onclose = (event) => {
        if (generation !== this.generation) return;
        this.socket = null;
        if (!settled) {
          fail(new GroupFocusRealtimeRuntimeError(
            "CONNECTION_CLOSED",
            "The Group Focus realtime connection closed before it was established.",
          ));
          return;
        }
        if (this.snapshot.status === "TERMINAL") return;
        const closeCode = (event as CloseEvent | undefined)?.code;
        if (
          closeCode === 4003
          || this.snapshot.error?.code === "AUTHORIZATION_REFRESH_REQUIRED"
          || this.snapshot.error?.code === "CANONICAL_MEMBERSHIP_INACTIVE"
        ) {
          this.reconnectEnabled = false;
          this.clearStoredResumeToken();
          this.update({
            status: "ERROR",
            error: this.snapshot.error ?? {
              code: "AUTHORIZATION_REFRESH_REQUIRED",
              message: "Reconnect requires refreshed Room authorization.",
            },
          });
          return;
        }
        if (this.reconnectEnabled && !this.disposed) {
          this.update({ status: "RECONNECTING", error: transportError });
          this.scheduleReconnect();
        } else {
          this.update({ status: "DISCONNECTED", error: transportError });
        }
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

  retryConnection(): void {
    if (this.snapshot.status === "TERMINAL" || this.disposed) return;
    if (
      this.snapshot.status === "CONNECTED"
      || this.snapshot.status === "CONNECTING"
      || this.connectionAttempt
      || this.reconnectInFlight
    ) return;
    if (!this.reconnectEnabled) {
      this.reconnectAttempts = 0;
      this.reconnectStartedAt = null;
    }
    this.reconnectEnabled = true;
    this.disposed = false;
    this.reconnectStartedAt ??= Date.now();
    this.clearReconnectTimer();
    this.update({ status: "RECONNECTING" });
    this.scheduleReconnect(true);
  }

  notifyApplicationActive(): void {
    if (this.snapshot.status === "CONNECTED") {
      try {
        this.requestRoomState();
        return;
      } catch {
        // Fall through to the bounded authenticated reconnect path.
      }
    }
    this.retryConnection();
  }

  private scheduleReconnect(immediate = false): void {
    if (
      !this.reconnectEnabled
      || this.disposed
      || this.snapshot.status === "TERMINAL"
      || this.snapshot.status === "CONNECTED"
      || this.connectionAttempt
      || this.reconnectInFlight
      || this.reconnectTimer
    ) return;
    const startedAt = this.reconnectStartedAt ?? Date.now();
    this.reconnectStartedAt = startedAt;
    if (
      this.reconnectAttempts >= 8
      || Date.now() - startedAt >= 2 * 60 * 1000
    ) {
      this.reconnectEnabled = false;
      this.update({
        status: "ERROR",
        error: {
          code: "RECONNECT_EXHAUSTED",
          message: "Group Focus could not reconnect. Retry when your connection is available.",
        },
      });
      return;
    }
    const delays = [1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000, 15_000];
    const wait = immediate ? 0 : delays[Math.min(this.reconnectAttempts, delays.length - 1)];
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (
        this.resumeToken
        && this.reconnectStartedAt !== null
        && Date.now() - this.reconnectStartedAt >= 45_000
      ) this.clearStoredResumeToken();
      this.reconnectAttempts += 1;
      const attempt = this.connectWithFreshCapability(true);
      this.connectionAttempt = attempt;
      this.reconnectInFlight = attempt;
      attempt.catch(() => undefined).finally(() => {
        if (this.connectionAttempt === attempt) this.connectionAttempt = null;
        if (this.reconnectInFlight === attempt) this.reconnectInFlight = null;
        if (
          this.snapshot.status !== "CONNECTED"
          && this.snapshot.status !== "TERMINAL"
          && this.reconnectEnabled
        ) this.scheduleReconnect();
      });
    }, wait);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private removeNativeLifecycleListener(): void {
    const listener = this.nativeLifecycleListener;
    this.nativeLifecycleListener = null;
    if (listener) {
      void listener.then((handle) => handle?.remove()).catch(() => undefined);
    }
  }

  private removeLifecycleListeners(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onlineHandler);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
    this.removeNativeLifecycleListener();
  }

  private readStoredResumeToken(key: string): string | null {
    try {
      const value = (this.options.resumeTokenStorage ?? globalThis.sessionStorage)
        ?.getItem(key);
      if (typeof value === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value)) return value;
      if (value !== null && value !== undefined) {
        (this.options.resumeTokenStorage ?? globalThis.sessionStorage)?.removeItem(key);
      }
    } catch {
      // sessionStorage can be unavailable in restricted browser contexts.
    }
    return null;
  }

  private persistResumeToken(value: string): void {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) return;
    this.resumeToken = value;
    const accountId = this.snapshot.userId ?? this.options.accountId;
    if (!accountId || !UUID.test(accountId)) return;
    this.currentAccountId = accountId;
    const key = resumeStorageKey(accountId, this.options.roomId);
    this.resumeStorageKey = key;
    try {
      (this.options.resumeTokenStorage ?? globalThis.sessionStorage)?.setItem(key, value);
    } catch {
      // The token remains memory-only if sessionStorage is blocked.
    }
  }

  private clearStoredResumeToken(): void {
    this.resumeToken = null;
    const key = this.resumeStorageKey;
    if (!key) return;
    try {
      (this.options.resumeTokenStorage ?? globalThis.sessionStorage)?.removeItem(key);
    } catch {
      // A blocked storage implementation must not break socket cleanup.
    }
  }

  private markTerminal(): void {
    this.reconnectEnabled = false;
    this.clearReconnectTimer();
    this.clearStoredResumeToken();
    this.snapshot = { ...this.snapshot, status: "TERMINAL" };
  }

  async leave(): Promise<void> {
    this.reconnectEnabled = false;
    this.disposed = true;
    this.clearReconnectTimer();
    this.pendingConnectionReject?.(
      new GroupFocusRealtimeRuntimeError(
        "CONNECTION_CANCELLED",
        "The Group Focus realtime connection was cancelled.",
      ),
    );
    this.pendingConnectionReject = null;
    this.removeLifecycleListeners();
    this.generation += 1;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ v: 1, type: "CLIENT_LEAVE" }));
        }
      } catch {
        // The connection may already be closing.
      }
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close(1000, "Client left");
      } catch {
        // Already closed.
      }
    }
    this.clearStoredResumeToken();
    this.update({ status: "DISCONNECTED" });
  }

  dispose(): void {
    this.pendingConnectionReject?.(
      new GroupFocusRealtimeRuntimeError(
        "CONNECTION_CANCELLED",
        "The Group Focus realtime connection was cancelled.",
      ),
    );
    this.pendingConnectionReject = null;
    this.reconnectEnabled = false;
    this.disposed = true;
    this.clearReconnectTimer();
    this.removeLifecycleListeners();
    this.generation += 1;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ v: 1, type: "CLIENT_LEAVE" }));
        }
      } catch {
        // The connection may already be closing.
      }
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
    this.clearStoredResumeToken();
    this.update({ status: "DISCONNECTED" });
    this.listeners.clear();
  }

  /**
   * HMR cleanup closes development sockets without sending CLIENT_LEAVE or
   * deleting the sessionStorage resume token. The replacement module reconnects
   * through the normal authenticated capability flow.
   */
  disposeForHotReload(): void {
    this.pendingConnectionReject?.(
      new GroupFocusRealtimeRuntimeError(
        "CONNECTION_CANCELLED",
        "The Group Focus realtime connection was replaced during development.",
      ),
    );
    this.pendingConnectionReject = null;
    this.reconnectEnabled = false;
    this.disposed = true;
    this.clearReconnectTimer();
    this.removeLifecycleListeners();
    this.generation += 1;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close(1000, "Development module replaced");
      } catch {
        // The socket may already be closed.
      }
    }
    this.snapshot = {
      ...this.snapshot,
      status: "DISCONNECTED",
      connectionId: null,
      error: null,
    };
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
        if (
          message.type === "ROOM_CLOSED"
          || this.snapshot.roomState?.phase === "COMPLETED"
          || this.snapshot.roomState?.phase === "CLOSED"
        ) this.markTerminal();
        break;
      case "RESUME_TOKEN":
        this.persistResumeToken(message.payload.resumeToken as string);
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
        if (
          code === "AUTHORIZATION_REFRESH_REQUIRED"
          || code === "CANONICAL_MEMBERSHIP_INACTIVE"
        ) this.clearStoredResumeToken();
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