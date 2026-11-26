import type { PrismaClient } from "@prisma/client";
import { isRevocationActive } from "./sessionRevocation.js";

type SessionAuthorizationRow = {
  id: string | null;
  email: string;
  sessionVersion: number;
  role: string;
  accountStatus: string;
  emailVerified: boolean;
  studentGroup: string;
  isPrimaryOwner: boolean;
  banReason: string | null;
  banIsPermanent: boolean | null;
  banEndTime: Date | null;
  revocationValue: string | null;
};

export async function readSessionAuthorization(
  database: Pick<PrismaClient, "$queryRaw">,
  userId: string,
  revocationKey: string | null,
) {
  // Share the existing revocation round trip. The private D1 projection and
  // short-lived profile cache can lag account changes.
  const [row] = await database.$queryRaw<SessionAuthorizationRow[]>`
    SELECT "u"."id", "u"."email", "u"."sessionVersion", "u"."role",
           "u"."accountStatus", "u"."emailVerified", "u"."studentGroup", "u"."isPrimaryOwner",
           "b"."reason" AS "banReason", "b"."isPermanent" AS "banIsPermanent",
           "b"."endTime" AS "banEndTime", "r"."value" AS "revocationValue"
    FROM (VALUES (${userId}::text, ${revocationKey}::text)) AS "lookup"("userId", "revocationKey")
    LEFT JOIN "User" AS "u" ON "u"."id" = "lookup"."userId"
    LEFT JOIN "UserBan" AS "b" ON "b"."userId" = "u"."id" AND lower("u"."accountStatus") = 'banned'
    LEFT JOIN "SystemSetting" AS "r" ON "r"."key" = "lookup"."revocationKey"
  `;
  if (!row) throw new Error("Database returned no session authorization result.");
  if (row.revocationValue !== null) {
    const revocation = JSON.parse(row.revocationValue);
    if (isRevocationActive(revocation)) {
      return { revokedUntil: revocation.expiresAt as number, account: null, ban: null };
    }
  }
  if (!row.id) return { revokedUntil: null, account: null, ban: null };

  const status = row.accountStatus;
  const isBanned = status.toLowerCase() === "banned";
  const activeBan = isBanned && (
    row.banIsPermanent !== false || !row.banEndTime || row.banEndTime > new Date()
  );
  const account = {
    id: row.id,
    email: row.email,
    sessionVersion: row.sessionVersion,
    role: row.role === "owner" ? "owner" as const : row.role === "admin" ? "admin" as const : "user" as const,
    accountStatus: isBanned ? "banned" as const
      : status === "PENDING_PROFILE" ? "pending_profile" as const
        : status === "PENDING" ? "pending" as const : "active" as const,
    emailVerified: row.emailVerified !== false,
    studentGroup: row.studentGroup || "A",
    isPrimaryOwner: row.isPrimaryOwner === true,
  };
  return {
    revokedUntil: null,
    account,
    ban: activeBan ? {
      reason: row.banReason || null,
      isPermanent: row.banIsPermanent ?? true,
      endTime: row.banEndTime,
    } : null,
  };
}
