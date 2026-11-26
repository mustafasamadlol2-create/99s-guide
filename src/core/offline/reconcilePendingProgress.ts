type PendingProgress = {
  id: string;
  userId: string;
  synced: number;
  lastUpdated: string;
  payload: unknown;
};

export function matchesSubmittedProgress(
  current: PendingProgress | undefined,
  submitted: PendingProgress,
): boolean {
  return !!current && current.synced === 0
    && current.id === submitted.id && current.userId === submitted.userId
    && current.lastUpdated === submitted.lastUpdated
    && JSON.stringify(current.payload) === JSON.stringify(submitted.payload);
}
