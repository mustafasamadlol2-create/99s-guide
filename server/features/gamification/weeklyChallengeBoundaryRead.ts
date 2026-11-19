/**
 * Phase 6 boundary bridge for Weekly Challenges only.
 *
 * During D1 read cutover, new Baghdad week enrollment/rewards are authoritative
 * in PostgreSQL. D1 can temporarily contain last week's snapshot while the
 * scheduled outbox catch-up is being delivered. On the one explicit stale-week
 * error, read the user's canonical Challenges and do not expose expired data.
 * All other D1 failures remain fail-closed; never fall back for malformed data,
 * authentication, missing snapshots, or network errors.
 *
 * This is intentionally a narrow transitional canonical READ+refresh, not a
 * general D1 fallback. Rewards remain managed by the canonical, idempotent
 * Challenge service; no reward logic is implemented here.
 */
export async function readWeeklyChallengesWithBoundaryBridge<T>(
  userId: string,
  d1Read: (userId: string) => Promise<T>,
  canonicalRead: (userId: string) => Promise<T>,
): Promise<T> {
  try {
    return await d1Read(userId);
  } catch (error: unknown) {
    // The D1 client uses this class name and this exact error code. Do not
    // accidentally accept an unrelated network failure with a similar message.
    if (
      error instanceof Error &&
      error.name === "Phase6GamificationReadError" &&
      (error as Error & { code?: unknown }).code === "PHASE6_WEEKLY_CHALLENGES_EXPIRED"
    ) {
      return canonicalRead(userId);
    }
    throw error;
  }
}
