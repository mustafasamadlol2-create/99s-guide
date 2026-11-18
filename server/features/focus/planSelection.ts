/**
 * Selects the first unfinished planned Focus session, beginning at the
 * requested item and wrapping only if needed. The caller owns the canonical
 * per-user lock; this function performs no mutations or speculative awards.
 */
export async function nextUnfinishedFocusPlanItem<T extends {
  id: string;
  sequence: number;
  sessionCount: number;
}>(
  items: readonly T[],
  requestedItemId: string,
  completedCount: (itemId: string) => Promise<number>,
): Promise<{ item: T; priorCompletedCount: number } | null> {
  const ordered = [...items].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
  const start = ordered.findIndex((item) => item.id === requestedItemId);
  if (start < 0) return null;
  for (const candidate of [...ordered.slice(start), ...ordered.slice(0, start)]) {
    const count = await completedCount(candidate.id);
    if (count < candidate.sessionCount) {
      return { item: candidate, priorCompletedCount: count };
    }
  }
  return null;
}
