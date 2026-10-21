import { Capacitor, registerPlugin } from "@capacitor/core";

export type FocusLiveActivityPhase =
  | "FOCUSING"
  | "PAUSED"
  | "BREAK"
  | "BREAK_PAUSED";

export interface FocusLiveActivitySnapshot {
  sessionId: string;
  lectureTitle: string;
  phase: FocusLiveActivityPhase;
  remainingSeconds: number;
  endAt: string | null;
  sessionNumber: number;
  plannedSessionCount: number;
  locale: "ar" | "en";
}

interface FocusLiveActivityPlugin {
  sync(options: FocusLiveActivitySnapshot): Promise<{
    supported: boolean;
    enabled: boolean;
    action: "created" | "updated" | "disabled" | "unsupported";
    activityId?: string;
  }>;
  end(options: { sessionId?: string }): Promise<{ supported: boolean; ended: number }>;
  endAll(): Promise<{ supported: boolean; ended: number }>;
  getAvailability(): Promise<{ supported: boolean; enabled: boolean }>;
}

const NativeFocusLiveActivity = registerPlugin<FocusLiveActivityPlugin>(
  "FocusLiveActivity",
);

let serial: Promise<unknown> = Promise.resolve();
let lastFingerprint: string | null = null;
let lastSessionId: string | null = null;

export function isNativeIOSFocusLiveActivityPlatform(): boolean {
  return typeof window !== "undefined" &&
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === "ios";
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = serial.then(task, task);
  serial = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function normalize(snapshot: FocusLiveActivitySnapshot): FocusLiveActivitySnapshot {
  const remainingSeconds = Number.isSafeInteger(snapshot.remainingSeconds)
    ? Math.max(0, Math.min(snapshot.remainingSeconds, 24 * 60 * 60))
    : 0;
  const sessionNumber = Number.isSafeInteger(snapshot.sessionNumber)
    ? Math.max(1, Math.min(snapshot.sessionNumber, 999))
    : 1;
  const plannedSessionCount = Number.isSafeInteger(snapshot.plannedSessionCount)
    ? Math.max(sessionNumber, Math.min(snapshot.plannedSessionCount, 999))
    : sessionNumber;
  const lectureTitle = snapshot.lectureTitle.trim().slice(0, 160) || "Focus Session";
  return {
    ...snapshot,
    lectureTitle,
    remainingSeconds,
    sessionNumber,
    plannedSessionCount,
    locale: snapshot.locale === "ar" ? "ar" : "en",
  };
}

export async function syncFocusLiveActivity(
  snapshot: FocusLiveActivitySnapshot,
  options: { force?: boolean } = {},
): Promise<void> {
  if (!isNativeIOSFocusLiveActivityPlatform()) return;
  const next = normalize(snapshot);
  const fingerprint = JSON.stringify(next);
  if (!options.force && fingerprint === lastFingerprint) return;

  await enqueue(async () => {
    const result = await NativeFocusLiveActivity.sync(next);
    if (result.supported) {
      lastFingerprint = fingerprint;
      lastSessionId = next.sessionId;
    }
  });
}

export async function endFocusLiveActivity(sessionId: string): Promise<void> {
  if (!isNativeIOSFocusLiveActivityPlatform()) return;
  await enqueue(async () => {
    await NativeFocusLiveActivity.end({ sessionId });
    if (lastSessionId === sessionId) {
      lastFingerprint = null;
      lastSessionId = null;
    }
  });
}

export async function endAllFocusLiveActivities(): Promise<void> {
  if (!isNativeIOSFocusLiveActivityPlatform()) return;
  await enqueue(async () => {
    await NativeFocusLiveActivity.endAll();
    lastFingerprint = null;
    lastSessionId = null;
  });
}

export async function getFocusLiveActivityAvailability(): Promise<{
  supported: boolean;
  enabled: boolean;
}> {
  if (!isNativeIOSFocusLiveActivityPlatform()) {
    return { supported: false, enabled: false };
  }
  return enqueue(() => NativeFocusLiveActivity.getAvailability());
}
