import type { FocusSessionDto } from "../../../../server/features/focus/types";
import { isValidServerTimestamp } from "./clock";

export interface FocusTimerBaseline {
  sessionId: string;
  status: FocusSessionDto["status"];
  serverNowAtSync: string;
  serverNowAtSyncMs: number;
  clientMonotonicAtSync: number;
  remainingSecondsAtSync: number | null;
}

export interface FocusDisplayEstimate {
  estimatedServerNow: string | null;
  displayRemainingSeconds: number | null;
  displayMayBeComplete: boolean;
}

export class FocusTimerSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FocusTimerSnapshotError";
  }
}

export function createFocusTimerBaseline(
  session: FocusSessionDto,
  serverNow: string,
  clientMonotonicAtSync: number,
): FocusTimerBaseline {
  if (!session.id || !isValidServerTimestamp(serverNow)) {
    throw new FocusTimerSnapshotError("Focus timer snapshot has an invalid server timestamp.");
  }
  if (!Number.isFinite(clientMonotonicAtSync)) {
    throw new FocusTimerSnapshotError("Focus timer snapshot has an invalid monotonic baseline.");
  }
  if (
    session.remainingSeconds !== null &&
    (!Number.isSafeInteger(session.remainingSeconds) || session.remainingSeconds < 0)
  ) {
    throw new FocusTimerSnapshotError("Focus timer snapshot has invalid remaining time.");
  }

  const serverNowAtSyncMs = Date.parse(serverNow);
  if (!Number.isFinite(serverNowAtSyncMs)) {
    throw new FocusTimerSnapshotError("Focus timer snapshot has an invalid server timestamp.");
  }

  return {
    sessionId: session.id,
    status: session.status,
    serverNowAtSync: serverNow,
    serverNowAtSyncMs,
    clientMonotonicAtSync,
    remainingSecondsAtSync: session.remainingSeconds,
  };
}

/**
 * Derive display-only time from a server snapshot and monotonic elapsed time.
 * This never changes canonical session fields or requests completion.
 */
export function estimateFocusDisplay(
  session: FocusSessionDto,
  baseline: FocusTimerBaseline,
  clientMonotonicNow: number,
): FocusDisplayEstimate {
  if (
    session.id !== baseline.sessionId ||
    session.status !== baseline.status ||
    !Number.isFinite(clientMonotonicNow)
  ) {
    throw new FocusTimerSnapshotError("Focus timer baseline does not match its session.");
  }

  const elapsedMilliseconds = Math.max(
    0,
    clientMonotonicNow - baseline.clientMonotonicAtSync,
  );
  const estimatedServerNow = new Date(
    baseline.serverNowAtSyncMs + elapsedMilliseconds,
  ).toISOString();

  if (baseline.remainingSecondsAtSync === null) {
    return {
      estimatedServerNow,
      displayRemainingSeconds: null,
      displayMayBeComplete: false,
    };
  }

  const displayRemainingSeconds = session.status === "ACTIVE"
    ? Math.max(0, Math.ceil(baseline.remainingSecondsAtSync - elapsedMilliseconds / 1000))
    : baseline.remainingSecondsAtSync;

  return {
    estimatedServerNow,
    displayRemainingSeconds,
    displayMayBeComplete: session.status === "ACTIVE" && displayRemainingSeconds === 0,
  };
}