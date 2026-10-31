import "dotenv/config";
import { getPrisma, disconnectPrisma } from "../server/services/prismaClient.js";

type Mutation = {
  version: 1;
  entity: "UserAuthReplica" | "UserBan";
  operation: "upsert" | "delete";
  key: Record<string, unknown>;
  data?: Record<string, unknown>;
  occurredAt: string;
};

const workerBaseUrl = String(process.env.PRIVATE_DATA_WORKER_BASE_URL || "").trim().replace(/\/+$/, "");
const secret = String(process.env.PRIVATE_DATA_SYNC_SECRET || "").trim();
const verifyOnly = process.argv.includes("--verify-only");

if (!workerBaseUrl || !secret) {
  throw new Error("PRIVATE_DATA_WORKER_BASE_URL and PRIVATE_DATA_SYNC_SECRET are required.");
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function workerJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${workerBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "X-Private-Data-Sync-Secret": secret,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Private Data Worker ${path} failed with HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  return (body ? JSON.parse(body) : {}) as T;
}

async function send(mutation: Mutation): Promise<void> {
  await workerJson("/internal/private-sync", {
    method: "POST",
    body: JSON.stringify(mutation),
  });
}

async function canonical() {
  const prisma = getPrisma();
  const [users, appleIdentities, bans] = await Promise.all([
    prisma.user.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true, email: true, profileEmail: true, role: true, sessionVersion: true,
        name: true, avatar: true, avatarUrl: true, signature: true, totalPoints: true,
        level: true, levelBadge: true, streakDays: true, totalTimeSpent: true,
        lastActive: true, lastSeen: true, createdAt: true, updatedAt: true,
        accountStatus: true, isOnline: true, studentGroup: true, isPrimaryOwner: true,
        emailVerified: true, preferences: true,
      },
    }),
    prisma.oAuthIdentity.findMany({
      where: { provider: "apple" },
      select: { userId: true },
    }),
    prisma.userBan.findMany({ orderBy: { id: "asc" } }),
  ]);

  const appleUsers = new Set(appleIdentities.map((row) => row.userId));
  return {
    users: users.map((row) => ({
      id: row.id,
      email: row.email,
      profileEmail: row.profileEmail ?? null,
      role: row.role,
      sessionVersion: row.sessionVersion,
      name: row.name || "",
      avatar: row.avatar || "",
      avatarUrl: row.avatarUrl || row.avatar || "",
      signature: row.signature || "",
      totalPoints: row.totalPoints || 0,
      level: row.level,
      levelBadge: row.levelBadge,
      streakDays: row.streakDays || 0,
      totalTimeSpent: row.totalTimeSpent || 0,
      lastActive: iso(row.lastActive),
      lastSeen: iso(row.lastSeen),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      accountStatus: row.accountStatus,
      isOnline: row.isOnline,
      studentGroup: row.studentGroup,
      isPrimaryOwner: row.isPrimaryOwner,
      emailVerified: row.emailVerified,
      hasAppleIdentity: appleUsers.has(row.id),
      preferences: row.preferences ?? null,
    })),
    bans: bans.map((row) => ({
      id: row.id,
      userId: row.userId,
      reason: row.reason,
      startTime: iso(row.startTime),
      endTime: iso(row.endTime),
      isPermanent: row.isPermanent,
      createdBy: row.createdBy,
      createdAt: iso(row.createdAt),
    })),
  };
}

function upsert(entity: Mutation["entity"], data: Record<string, unknown>): Mutation {
  return {
    version: 1,
    entity,
    operation: "upsert",
    key: { id: String(data.id) },
    data,
    occurredAt: new Date().toISOString(),
  };
}

function deletion(entity: Mutation["entity"], id: string): Mutation {
  return {
    version: 1,
    entity,
    operation: "delete",
    key: { id },
    occurredAt: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  console.log(`[Phase3] Private Data Worker: ${workerBaseUrl}`);
  const health = await fetch(`${workerBaseUrl}/health`);
  if (!health.ok) throw new Error(`Private Data Worker health check failed with HTTP ${health.status}.`);

  console.log("[Phase3] Reading canonical users/auth state from Supabase...");
  const rows = await canonical();

  if (!verifyOnly) {
    for (let i = 0; i < rows.users.length; i += 1) {
      await send(upsert("UserAuthReplica", rows.users[i] as Record<string, unknown>));
      if ((i + 1) % 50 === 0 || i + 1 === rows.users.length) {
        console.log(`[Phase3] UserAuthReplica: ${i + 1}/${rows.users.length}`);
      }
    }
    for (let i = 0; i < rows.bans.length; i += 1) {
      await send(upsert("UserBan", rows.bans[i] as Record<string, unknown>));
      if ((i + 1) % 50 === 0 || i + 1 === rows.bans.length) {
        console.log(`[Phase3] UserBan: ${i + 1}/${rows.bans.length}`);
      }
    }

    const keys = await workerJson<{ userIds: string[]; banIds: string[] }>("/internal/private-read/phase3-keys");
    const userIds = new Set(rows.users.map((row) => String(row.id)));
    const banIds = new Set(rows.bans.map((row) => String(row.id)));
    for (const id of keys.userIds || []) {
      if (!userIds.has(id)) await send(deletion("UserAuthReplica", id));
    }
    for (const id of keys.banIds || []) {
      if (!banIds.has(id)) await send(deletion("UserBan", id));
    }
  }

  const counts = await workerJson<{ users: number; bans: number }>("/internal/private-read/phase3-counts");
  const usersOk = Number(counts.users) === rows.users.length;
  const bansOk = Number(counts.bans) === rows.bans.length;
  console.log(`[Phase3] verify Users: Supabase=${rows.users.length} D1=${counts.users} ${usersOk ? "OK" : "MISMATCH"}`);
  console.log(`[Phase3] verify UserBan: Supabase=${rows.bans.length} D1=${counts.bans} ${bansOk ? "OK" : "MISMATCH"}`);
  if (!usersOk || !bansOk) throw new Error("Phase 3 D1 verification failed.");

  console.log(verifyOnly
    ? "[Phase3] Verification passed. User/auth replica matches canonical Supabase counts."
    : "[Phase3] Backfill + prune + verification passed. User/auth replica is ready for cutover.");
}

main()
  .catch((error) => {
    console.error(`[Phase3] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma().catch(() => {});
  });
