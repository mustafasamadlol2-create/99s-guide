import { createHash } from "node:crypto";

export type RevocationRecord = { expiresAt?: unknown } | null;

export function getRevokedSessionKey(rawToken: string): string {
  const hash = createHash("sha256").update(rawToken).digest("hex");
  return `__revoked_session__:${hash}`;
}

export function isRevocationActive(record: RevocationRecord, now = Date.now()): boolean {
  return typeof record?.expiresAt === "number" && record.expiresAt > now;
}
