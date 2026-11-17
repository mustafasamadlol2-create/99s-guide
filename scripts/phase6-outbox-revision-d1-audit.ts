/**
 * READ-ONLY targeted Phase 6 delivery check by Outbox ID.
 * Confirms that a SUCCEEDED GamificationSnapshot outbox revision is present
 * in D1, that its challenge period is current, and that scope is consistent.
 * Does NOT assert canonical Points/Achievement parity or refresh rewards.
 */
import "dotenv/config";
import { getPrisma, disconnectPrisma } from "../server/services/prismaClient.js";
import { getBaghdadWeekPeriod } from "../server/features/gamification/challengePeriods.js";

const rawId = process.argv.find((v) => v.startsWith("--outbox-id="))?.slice(12);
if (!rawId || !/^[1-9][0-9]*$/.test(rawId)) {
  throw new Error("Specify a positive numeric --outbox-id=36 (not a user ID).");
}
const base = String(process.env.PRIVATE_DATA_WORKER_BASE_URL || "").trim().replace(/\/+$/, "");
const secret = String(process.env.PRIVATE_DATA_SYNC_SECRET || "").trim();
if (!base.startsWith("https://") || !secret) {
  throw new Error("Set PRIVATE_DATA_WORKER_BASE_URL (https) and PRIVATE_DATA_SYNC_SECRET in local .env.");
}
const db = getPrisma();
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const code = (err: unknown) => {
  if (!err || typeof err !== "object") return "UNKNOWN";
  const value = err as { code?: unknown; errorCode?: unknown; name?: unknown };
  return String(value.code || value.errorCode || value.name || "UNKNOWN").slice(0, 64);
};
async function retryRead<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); }
    catch (err) {
      if (attempt >= 3) throw new Error(`${label} failed after 3 read attempts (${code(err)})`);
      console.warn(`[Phase6 revision audit] ${label} temporary failure (${code(err)}); retrying read ${attempt}/2.`);
      await sleep(attempt * 1300);
    }
  }
}

type OutboxRow = {
  id: bigint; revision: bigint; state: string; key: unknown;
};

async function main() {
  console.log("[Phase6 revision audit] READ_ONLY; no snapshots, rewards, or Outbox writes.");
  const rows = await retryRead("PostgreSQL outbox lookup", () => db.$queryRaw<OutboxRow[]>`
    SELECT "id", "revision", "state", "key"
    FROM public."PrivateD1SyncOutbox"
    WHERE "id" = ${BigInt(rawId)} AND "entity" = 'GamificationSnapshot'
    LIMIT 1
  `);
  const outbox = rows[0];
  if (!outbox) throw new Error("Outbox ID not found for GamificationSnapshot.");
  if (typeof outbox.key !== "object" || outbox.key === null || Array.isArray(outbox.key)) {
    throw new Error("Outbox key is malformed.");
  }
  const userId = (outbox.key as Record<string, unknown>).id;
  if (typeof userId !== "string" || !userId || userId.length > 128) {
    throw new Error("Outbox key.id is invalid.");
  }
  console.log(`[Phase6 revision audit] outbox id=${outbox.id} revision=${outbox.revision} state=${outbox.state}.`);
  if (outbox.state !== "SUCCEEDED") {
    console.log("[Phase6 revision audit] NOT_DELIVERED: Outbox state is not SUCCEEDED; stop here.");
    process.exitCode = 2;
    return;
  }
  const url = new URL("/internal/private-read/gamification-snapshot", base + "/");
  url.searchParams.set("userId", userId);
  const payload = await retryRead("Worker D1 read", async () => {
    const response = await fetch(url, {
      headers: { "X-Private-Data-Sync-Secret": secret, Accept: "application/json", "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(15_000), cache: "no-store",
    });
    if (!response.ok) throw new Error(`D1_HTTP_${response.status}`);
    return response.json() as Promise<{ row?: Record<string, unknown> | null }>;
  });
  const row = payload?.row;
  if (!row || typeof row !== "object") throw new Error("D1 row missing or invalid.");
  if (row.id !== userId || row.userId !== userId || row.userScope !== userId) {
    throw new Error("D1 row scope mismatch.");
  }
  const d1Revision = String(row.revision ?? "");
  const revisionOK = /^\d+$/.test(d1Revision) && BigInt(d1Revision) >= outbox.revision;
  let challenges: unknown;
  try { challenges = JSON.parse(String(row.challengesJson || "null")); }
  catch { throw new Error("D1 challenge JSON malformed."); }
  const week = getBaghdadWeekPeriod(new Date());
  const currentWeek = (challenges as { currentPeriod?: { periodKey?: string } } | null)?.currentPeriod?.periodKey;
  const periodEndMs = Date.parse(String(row.challengePeriodEndsAt || ""));
  const weekOK = currentWeek === week.periodKey && Number.isFinite(periodEndMs) && periodEndMs > Date.now();
  console.log(`[Phase6 revision audit] D1 revision=${d1Revision}; >= Outbox revision=${revisionOK ? "YES" : "NO"}.`);
  console.log(`[Phase6 revision audit] current Baghdad challenge week=${week.periodKey}; D1 current week=${currentWeek ?? "MISSING"}; valid unexpired period=${weekOK ? "YES" : "NO"}.`);
  if (revisionOK && weekOK) {
    console.log("[Phase6 revision audit] DELIVERY_OK: Revision and challenge week match. FULL canonical Points/Achievement parity NOT checked.");
  } else {
    console.log("[Phase6 revision audit] DELIVERY_MISMATCH: D1 revision or week is stale; inspect Worker/drainer logs.");
    process.exitCode = 2;
  }
}
main().catch((err) => {
  console.error(`[Phase6 revision audit] FAILED: ${err instanceof Error ? err.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_URL]') : code(err)}`);
  process.exitCode = 1;
}).finally(async () => disconnectPrisma().catch(() => {}));
