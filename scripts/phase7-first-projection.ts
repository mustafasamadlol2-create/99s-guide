/**
 * 99's Guide — Phase 7 first Leaderboard projection.
 * Default: read-only checks. Explicit --apply --confirm-initial-projection
 * creates fresh canonical LIVE leaderboard snapshots, enqueues their D1
 * projections and drains only the Leaderboard outbox. Never changes points.
 * Requires Phase7.2 server + Worker v2 to have been deployed first.
 */
import "dotenv/config";
import type { PrismaClient } from "@prisma/client";
import { getPrisma, disconnectPrisma } from "../server/services/prismaClient.js";
import {
  LEADERBOARD_CACHE_RANKING_VERSION,
  getLeaderboardD1Config,
  requestLeaderboardD1,
  toCacheEntry,
} from "../server/features/leaderboard/cacheProtocol.js";
import { getLeaderboardSeasonWindow } from "../server/features/leaderboard/periods.js";
import {
  rebuildLeaderboardSnapshot,
} from "../server/features/leaderboard/snapshots.js";
import {
  drainLeaderboardD1Outbox,
  stopLeaderboardD1OutboxDrainer,
} from "../server/features/leaderboard/d1Outbox.js";

type Scope = "MONTHLY" | "SEMESTER" | "ALL_TIME";
type CurrentResult = { ok: boolean; manifest?: { snapshotId?: string } | null };
const SCOPES: Scope[] = ["MONTHLY", "SEMESTER", "ALL_TIME"];
const APPLY = process.argv.includes("--apply");
const CONFIRM = process.argv.includes("--confirm-initial-projection");
const PREFIX = "[Phase7 first projection]";
const database = getPrisma() as PrismaClient;

async function getRemoteCurrent(scope: Scope, seasonKey: string) {
  const params = new URLSearchParams({ scope, seasonKey });
  const response = await requestLeaderboardD1<CurrentResult>(
    `/internal/leaderboard-cache/current?${params.toString()}`,
    undefined,
    { method: "GET" },
  );
  if (!response || response.ok !== true || !("manifest" in response)) {
    throw new Error(`${scope}: Worker current response invalid.`);
  }
  return response.manifest ?? null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply" && arg !== "--confirm-initial-projection")) {
    throw new Error("Usage: npx tsx scripts/phase7-first-projection.ts [--apply --confirm-initial-projection]");
  }
  if (APPLY !== CONFIRM) {
    throw new Error("Writing requires BOTH --apply and --confirm-initial-projection.");
  }
  console.log(`${PREFIX} MODE=${APPLY ? "CONTROLLED_APPLY" : "READ_ONLY_PREFLIGHT"}`);
  if (process.env.LEADERBOARD_D1_READ_ENABLED?.toLowerCase() !== "false") {
    throw new Error("LEADERBOARD_D1_READ_ENABLED must explicitly equal false in local .env.");
  }
  if (!getLeaderboardD1Config()) {
    throw new Error("Worker URL or LEADERBOARD_D1_SYNC_SECRET missing/invalid.");
  }
  if (LEADERBOARD_CACHE_RANKING_VERSION !== "leaderboard-ranking-v2") {
    throw new Error("Phase7.2 v2 projection code not installed.");
  }
  // Phase7.2 allows scores of exactly 0; older code throws here.
  toCacheEntry({ userId: "preflight", rank: 1, tieSize: 1, score: 0n, levelSnapshot: null });

  const outboxBefore = await database.leaderboardD1SyncOutbox.count();
  console.log(`${PREFIX} canonical outbox rows=${outboxBefore}`);
  if (outboxBefore !== 0) {
    throw new Error("Outbox is nonempty. Inspect with Phase7.2 audit before first projection; do not duplicate jobs.");
  }
  const now = new Date();
  const plans: Array<{ scope: Scope; seasonKey: string; seasonId: string; count: number }> = [];
  for (const scope of SCOPES) {
    const window = getLeaderboardSeasonWindow(scope, now);
    const season = await database.leaderboardSeason.findUnique({
      where: { scope_seasonKey: { scope, seasonKey: window.seasonKey } },
    });
    if (!season || season.status !== "ACTIVE") {
      throw new Error(`${scope}: active canonical season not available. No writes performed by preflight.`);
    }
    const latest = await database.leaderboardSnapshot.findFirst({
      where: { seasonId: season.id, snapshotType: "LIVE", status: "READY" },
      orderBy: { revision: "desc" },
    });
    if (!latest || latest.entryCount < 1 || latest.entryCount > 20_000) {
      throw new Error(`${scope}: READY LIVE snapshot missing or entry count invalid.`);
    }
    const remote = await getRemoteCurrent(scope, season.seasonKey);
    if (remote !== null) {
      throw new Error(`${scope}: D1 already has a current snapshot. This first-projection command must not overwrite it.`);
    }
    console.log(`${PREFIX} ${scope}: season=${season.seasonKey}, canonicalRows=${latest.entryCount}, remoteCurrent=EMPTY`);
    plans.push({ scope, seasonKey: season.seasonKey, seasonId: season.id, count: latest.entryCount });
  }
  if (!APPLY) {
    console.log(`${PREFIX} PREFLIGHT_PASS scopes=3/3; NO_BUSINESS_WRITES. Deploy Worker v2 and then rerun with both apply flags.`);
    return;
  }
  // Only this CLI process enables the projection writer; Render and .env stay unchanged.
  const oldProjectionFlag = process.env.LEADERBOARD_D1_PROJECTION_ENABLED;
  process.env.LEADERBOARD_D1_PROJECTION_ENABLED = "true";
  const created: Array<{ scope: Scope; seasonKey: string; id: string; count: number }> = [];
  try {
    for (const p of plans) {
      const snapshot = await rebuildLeaderboardSnapshot({
        seasonId: p.seasonId,
        now: new Date(),
        forceRevision: true,
      }, database);
      if (snapshot.snapshotType !== "LIVE" || snapshot.status !== "READY" || snapshot.entryCount < 1) {
        throw new Error(`${p.scope}: canonical LIVE snapshot validation failed after rebuild.`);
      }
      created.push({ scope: p.scope, seasonKey: p.seasonKey, id: snapshot.id, count: snapshot.entryCount });
      console.log(`${PREFIX} ${p.scope}: snapshot created, rows=${snapshot.entryCount}, projection queued`);
    }
    // Each 123-student snapshot creates BEGIN + two CHUNK + COMMIT rows.
    // One drain can process up to 25 jobs; limit to three rounds for bounded work.
    for (let attempt = 1; attempt <= 3; attempt++) {
      await drainLeaderboardD1Outbox();
      const outstanding = await database.leaderboardD1SyncOutbox.count({
        where: { state: { not: "SUCCEEDED" } },
      });
      console.log(`${PREFIX} drain round=${attempt}, outstanding=${outstanding}`);
      if (outstanding === 0) break;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    const status = await database.leaderboardD1SyncOutbox.groupBy({
      by: ["state"],
      _count: { _all: true },
    });
    console.log(`${PREFIX} Outbox state counts ${JSON.stringify(Object.fromEntries(status.map((s) => [s.state, s._count._all])))}`);
    if (status.some((row) => row.state !== "SUCCEEDED")) {
      throw new Error("One or more projections not delivered. Preserve the Outbox and inspect logs; do not rerun --apply.");
    }
    for (const item of created) {
      const current = await getRemoteCurrent(item.scope, item.seasonKey);
      if (!current || current.snapshotId !== item.id) {
        throw new Error(`${item.scope}: Worker current snapshot does not match newly built canonical snapshot.`);
      }
      console.log(`${PREFIX} ${item.scope}: D1 CURRENT_OK`);
    }
    console.log(`${PREFIX} FIRST_PROJECTION_PASS scopes=3/3. LEADERBOARD_D1_READ_ENABLED remains false.`);
  } finally {
    stopLeaderboardD1OutboxDrainer();
    if (oldProjectionFlag === undefined) delete process.env.LEADERBOARD_D1_PROJECTION_ENABLED;
    else process.env.LEADERBOARD_D1_PROJECTION_ENABLED = oldProjectionFlag;
  }
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : "Unknown error";
  // Do not echo secrets, URLs or database query strings.
  const sanitized = reason.replace(/https?:\/\/\S+/giu, "[REDACTED_URL]").slice(0, 220);
  console.error(`${PREFIX} STOP: ${sanitized}`);
  process.exitCode = 1;
}).finally(async () => {
  stopLeaderboardD1OutboxDrainer();
  await disconnectPrisma();
});
