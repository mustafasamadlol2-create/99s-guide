export type ClaimableOAuthSession = {
  expiresAt: number;
  processing?: boolean;
  processingUntil?: number;
};

type SystemSettingCompareAndSet = {
  updateMany(args: {
    where: { key: string; value: string };
    data: { value: string; updatedAt: Date };
  }): Promise<{ count: number }>;
};

/**
 * Atomically claim a short-lived OAuth authorization code for one exchange.
 * The stored-value comparison is a cross-process compare-and-set; a local
 * mutex would not protect requests routed to different server instances.
 */
export async function claimOAuthSessionRecord<T extends ClaimableOAuthSession>(input: {
  systemSetting: SystemSettingCompareAndSet;
  key: string;
  session: T;
  storedValue: string;
  now: number;
  leaseMs?: number;
}): Promise<(T & { processing: true; processingUntil: number }) | null> {
  const { session, now } = input;
  if (session.expiresAt < now) return null;
  if (
    session.processing &&
    (session.processingUntil === undefined || session.processingUntil > now)
  ) {
    return null;
  }

  const claimed = {
    ...session,
    processing: true as const,
    processingUntil: now + (input.leaseMs ?? 60_000),
  };
  const result = await input.systemSetting.updateMany({
    where: { key: input.key, value: input.storedValue },
    data: { value: JSON.stringify(claimed), updatedAt: new Date(now) },
  });

  return result.count === 1 ? claimed : null;
}