import {
  createGroupFocusRealtimeRuntime,
  type GroupFocusRealtimeRuntime,
  type GroupFocusRealtimeRuntimeOptions,
} from "./groupFocusRealtime.js";

export type GroupFocusRuntimeEntry = {
  accountId: string;
  roomId: string;
  runtime: GroupFocusRealtimeRuntime;
  connectionAttempt: Promise<void> | null;
};

const runtimes = new Map<string, GroupFocusRuntimeEntry>();

function runtimeKey(accountId: string, roomId: string): string {
  return `${accountId}:${roomId}`;
}

export function getOrCreateGroupFocusRuntime(
  options: GroupFocusRealtimeRuntimeOptions & { accountId: string },
): GroupFocusRuntimeEntry {
  const key = runtimeKey(options.accountId, options.roomId);
  const existing = runtimes.get(key);
  if (existing) return existing;

  const entry: GroupFocusRuntimeEntry = {
    accountId: options.accountId,
    roomId: options.roomId,
    runtime: createGroupFocusRealtimeRuntime(options),
    connectionAttempt: null,
  };
  runtimes.set(key, entry);
  return entry;
}

export function connectGroupFocusRuntime(
  entry: GroupFocusRuntimeEntry,
): Promise<void> {
  const status = entry.runtime.getSnapshot().status;
  if (status === "CONNECTED" || status === "CONNECTING" || status === "RECONNECTING") {
    return entry.connectionAttempt ?? Promise.resolve();
  }
  if (entry.connectionAttempt) return entry.connectionAttempt;

  const attempt = status === "ERROR" || status === "DISCONNECTED"
    ? Promise.resolve().then(() => entry.runtime.retryConnection())
    : entry.runtime.connect();
  const trackedAttempt = attempt.finally(() => {
    if (entry.connectionAttempt === trackedAttempt) entry.connectionAttempt = null;
  });
  entry.connectionAttempt = trackedAttempt;
  return trackedAttempt;
}

export async function leaveAndRemoveGroupFocusRuntime(
  entry: GroupFocusRuntimeEntry,
): Promise<void> {
  try {
    await entry.runtime.leave();
  } finally {
    const key = runtimeKey(entry.accountId, entry.roomId);
    if (runtimes.get(key) === entry) runtimes.delete(key);
  }
}

export function removeTerminalGroupFocusRuntime(
  accountId: string,
  roomId: string,
): void {
  const key = runtimeKey(accountId, roomId);
  const entry = runtimes.get(key);
  if (!entry) return;
  runtimes.delete(key);
  entry.runtime.dispose();
}

export function getGroupFocusRuntime(
  accountId: string,
  roomId: string,
): GroupFocusRuntimeEntry | null {
  return runtimes.get(runtimeKey(accountId, roomId)) ?? null;
}

const hotModule = (
  import.meta as ImportMeta & {
    hot?: { dispose(callback: () => void): void };
  }
).hot;

if (hotModule) {
  hotModule.dispose(() => {
    for (const entry of runtimes.values()) {
      entry.runtime.disposeForHotReload();
    }
    runtimes.clear();
  });
}