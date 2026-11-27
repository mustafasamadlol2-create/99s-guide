import type { GamificationUpdateResource } from "./realtime.js";

type RefreshRequest = {
  userId: string;
  full: boolean;
  metricIds: readonly string[];
  resources: readonly GamificationUpdateResource[];
};

type PendingRefresh = {
  full: boolean;
  metricIds: Set<string>;
  resources: Set<GamificationUpdateResource>;
};

export function createGamificationPostCommitScheduler(
  refresh: (request: RefreshRequest) => Promise<void>,
  onError: () => void,
): (request: RefreshRequest) => void {
  const accounts = new Map<string, { pending?: PendingRefresh }>();

  async function run(userId: string, account: { pending?: PendingRefresh }) {
    const pending = account.pending!;
    account.pending = undefined;
    try {
      await refresh({
        userId,
        full: pending.full,
        metricIds: [...pending.metricIds],
        resources: [...pending.resources],
      });
    } catch {
      try { onError(); } catch { /* A logging failure cannot block the next refresh. */ }
    } finally {
      // A post-commit notification received during the refresh may represent
      // data it never saw. Always process those notifications in another pass.
      if (account.pending) setImmediate(() => void run(userId, account));
      else accounts.delete(userId);
    }
  }

  return ({ userId, full, metricIds, resources }) => {
    let account = accounts.get(userId);
    if (!account) {
      account = {};
      accounts.set(userId, account);
      const scheduled = account;
      setImmediate(() => void run(userId, scheduled));
    }

    const pending = account.pending ??= { full: false, metricIds: new Set(), resources: new Set() };
    pending.full ||= full;
    for (const metricId of metricIds) pending.metricIds.add(metricId);
    for (const resource of resources) pending.resources.add(resource);
  };
}
