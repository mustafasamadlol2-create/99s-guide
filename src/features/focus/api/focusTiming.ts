export type FocusTimingOutcome = "success" | "error" | "optimistic" | "reconciled";

export function focusTimingNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export function formatFocusTiming(
  name: string,
  durationMs: number,
  outcome: FocusTimingOutcome = "success",
): string {
  return `[FocusTiming] ${JSON.stringify({
    name,
    durationMs: Math.max(0, Math.round(durationMs)),
    outcome,
  })}`;
}

export function logFocusTiming(
  name: string,
  startedAt: number,
  outcome: FocusTimingOutcome = "success",
): number {
  const durationMs = Math.max(0, focusTimingNow() - startedAt);
  if (typeof window !== "undefined") {
    console.info(formatFocusTiming(name, durationMs, outcome));
  }
  return durationMs;
}
