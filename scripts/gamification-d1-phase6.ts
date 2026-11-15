/** Phase 6 — explicit canonical-to-D1 backfill and per-user parity check. */
import "dotenv/config";
import { getPrisma, disconnectPrisma } from "../server/services/prismaClient.js";
import {
  buildCanonicalGamificationD1Snapshot,
  gamificationD1Projection,
  type GamificationD1Snapshot,
} from "../server/features/gamification/d1Replica.js";

const base = String(process.env.PRIVATE_DATA_WORKER_BASE_URL || "").trim().replace(/\/+$/, "");
const secret = String(process.env.PRIVATE_DATA_SYNC_SECRET || "").trim();
const verifyOnly = process.argv.includes("--verify-only");
if (!base || !secret) throw new Error("PRIVATE_DATA_WORKER_BASE_URL and PRIVATE_DATA_SYNC_SECRET required.");

// The Supabase session pooler may briefly drop a connection during a long
// per-account backfill. Retry ONLY transient connectivity/availability errors;
// do not mask data validation, permissions, or migration failures.
const DB_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 12_000];
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isTransientDatabaseError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    if (typeof current === "object") {
      const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
      const code = typeof candidate.code === "string" ? candidate.code : "";
      if (["P1001", "P1002", "P1017", "P2024", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"].includes(code)) {
        return true;
      }
      const message = typeof candidate.message === "string" ? candidate.message : "";
      if (/can't reach database server|server has closed the connection|connection terminated|connection reset|connection refused|timed out (?:fetching|connecting|waiting)|connection pool timeout/i.test(message)) {
        return true;
      }
      current = candidate.cause;
    } else {
      break;
    }
  }
  return false;
}

async function withDatabaseRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientDatabaseError(error) || attempt >= DB_RETRY_DELAYS_MS.length) {
        throw error;
      }
      const delay = DB_RETRY_DELAYS_MS[attempt];
      const code = typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code || "DB_CONNECTION")
        : "DB_CONNECTION";
      console.warn(`[Phase6] ${label}: temporary Supabase error (${code}); retry ${attempt + 1}/${DB_RETRY_DELAYS_MS.length} in ${delay / 1000}s.`);
      // Re-create the pool after a broken session, without creating a new client.
      await getPrisma().$disconnect().catch(() => {});
      await wait(delay);
    }
  }
}

async function worker<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "X-Private-Data-Sync-Secret": secret,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Phase 6 Worker ${path} HTTP ${response.status}: ${text.slice(0, 250)}`);
  return JSON.parse(text) as T;
}

async function main(): Promise<void> {
  if (/^(1|true|yes|on)$/i.test(String(process.env.PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED || "").trim())) {
    throw new Error("Disable Phase 6 read cutover before rebuilding the replica.");
  }
  const db = getPrisma();
  // Fail before touching D1 if Supabase is unavailable at startup.
  await withDatabaseRetry("preflight", () => db.$queryRaw`SELECT 1`);
  const users = await withDatabaseRetry("active accounts", () => db.user.findMany({
    where: { accountStatus: "ACTIVE" },
    select: { id: true },
    orderBy: { id: "asc" },
  }));
  console.log(`[Phase6] Canonical active accounts: ${users.length}`);
  if (!verifyOnly) {
    console.log("[Phase6] Rebuilding ONLY disposable Gamification D1 snapshot table...");
    await worker("/internal/private-maintenance/phase6-gamification-reset", { method: "POST" });
  }
  let mismatches = 0;
  for (let index = 0; index < users.length; index++) {
    const userId = users[index].id;
    let canonical: GamificationD1Snapshot | undefined;
    if (!verifyOnly) {
      canonical = await withDatabaseRetry(`account ${index + 1}/${users.length} canonical snapshot`, () =>
        buildCanonicalGamificationD1Snapshot(userId),
      );
      const data = gamificationD1Projection(userId, canonical);
      await worker("/internal/private-sync", {
        method: "POST",
        body: JSON.stringify({
          version: 1, entity: "GamificationSnapshot", operation: "upsert",
          key: { id: userId }, revision: "0", projectionVersion: 1,
          userScope: userId, updatedAt: data.updatedAt, data,
          occurredAt: new Date().toISOString(),
        }),
      });
    }
    const replica = await worker<{ row?: Record<string, unknown> }>(
      `/internal/private-read/gamification-snapshot?userId=${encodeURIComponent(userId)}`,
    );
    const row = replica.row;
    if (!row || row.userScope !== userId) {
      mismatches++;
      console.error(`[Phase6] verify ${userId}: missing or wrong scope`);
      continue;
    }
    if (!canonical) canonical = await withDatabaseRetry(
      `account ${index + 1}/${users.length} canonical verification`,
      () => buildCanonicalGamificationD1Snapshot(userId),
    );
    const summary = JSON.parse(String(row.summaryJson || "null")) as GamificationD1Snapshot["summary"];
    const challenges = JSON.parse(String(row.challengesJson || "null")) as GamificationD1Snapshot["challenges"];
    const same = summary?.points?.totalPoints === canonical.summary.points.totalPoints
      && summary?.ruleSetVersion === canonical.summary.ruleSetVersion
      && summary?.achievements?.length === canonical.summary.achievements.length
      && challenges?.currentPeriod?.periodKey === canonical.challenges.currentPeriod.periodKey;
    if (!same) {
      mismatches++;
      console.error(`[Phase6] verify ${userId}: MISMATCH`);
    }
    if ((index + 1) % 25 === 0 || index + 1 === users.length) {
      console.log(`[Phase6] verified ${index + 1}/${users.length}`);
    }
  }
  const counts = await worker<{ snapshots: number }>("/internal/private-read/phase6-counts");
  const parity = counts.snapshots === users.length && mismatches === 0;
  console.log(`[Phase6] verify snapshot accounts: Supabase=${users.length} D1=${counts.snapshots} ${parity ? "OK" : "MISMATCH"}`);
  console.log(`[Phase6] per-account parity: ${users.length - mismatches}/${users.length}`);
  if (!parity) throw new Error("Phase 6 reconciliation failed; do not activate cutover.");
  console.log("[Phase6] Replica backfill verified. Cutover NOT automatically approved.");
}

main().catch((error) => {
  console.error(`[Phase6] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}).finally(async () => { await disconnectPrisma().catch(() => {}); });
