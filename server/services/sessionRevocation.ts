import { createHash } from "node:crypto";

export type RevocationRecord = { expiresAt?: unknown } | null;

export const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
export const REVOKED_SESSION_KEY_PREFIX = "__revoked_session__:";

export function getRevokedSessionKey(rawToken: string): string {
  const hash = createHash("sha256").update(rawToken).digest("hex");
  return `${REVOKED_SESSION_KEY_PREFIX}${hash}`;
}

export function isRevocationActive(record: RevocationRecord, now = Date.now()): boolean {
  return typeof record?.expiresAt === "number" && record.expiresAt > now;
}
