/**
 * Study Points V2 competitive epoch.
 *
 * All competitive balances, caps, history, gamification totals, and
 * leaderboards ignore entries whose canonical effectiveAt is before this
 * instant. This lets the app start the new verified points system cleanly
 * without deleting historical ledger rows.
 *
 * Override STUDY_POINTS_V2_EPOCH once at deployment if you need a different
 * cutover instant. Keep it stable after launch; changing it later changes the
 * competitive accounting window.
 */
export const DEFAULT_STUDY_POINTS_V2_EPOCH_ISO =
  "2026-10-18T12:32:00.000Z" as const;

export function getStudyPointsCompetitiveEpoch(
  configured = process.env.STUDY_POINTS_V2_EPOCH,
): Date {
  const raw = typeof configured === "string" && configured.trim().length > 0
    ? configured.trim()
    : DEFAULT_STUDY_POINTS_V2_EPOCH_ISO;
  const epoch = new Date(raw);
  if (!Number.isFinite(epoch.getTime())) {
    throw new Error("STUDY_POINTS_V2_EPOCH must be a valid ISO-8601 timestamp.");
  }
  return epoch;
}

export function isAtOrAfterStudyPointsCompetitiveEpoch(
  at: Date,
  configured = process.env.STUDY_POINTS_V2_EPOCH,
): boolean {
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) return false;
  return at.getTime() >= getStudyPointsCompetitiveEpoch(configured).getTime();
}

export function clampStudyPointsRangeStart(
  start: Date,
  configured = process.env.STUDY_POINTS_V2_EPOCH,
): Date {
  const epoch = getStudyPointsCompetitiveEpoch(configured);
  return start.getTime() >= epoch.getTime() ? start : epoch;
}
