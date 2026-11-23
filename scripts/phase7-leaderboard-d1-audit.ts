/** Phase 7.2: bounded, read-only PostgreSQL/Worker leaderboard audit.
 * No tables or worker cache entries are modified. No user IDs or secrets are printed.
 */
import "dotenv/config";
import { getPrisma } from "../server/services/prismaClient.js";
import { getLeaderboardD1Config } from "../server/features/leaderboard/cacheProtocol.js";
import { reconcileLeaderboardD1Cache } from "../server/features/leaderboard/cacheReconciliation.js";

const SCOPES = ["MONTHLY", "SEMESTER", "ALL_TIME"] as const;
const YES = new Set(["true", "1", "yes", "on"]);
const flag = (name: string) => YES.has((process.env[name] ?? "").trim().toLowerCase());

async function main(): Promise<void> {
  const database = getPrisma();
  const workerConfigured = !!getLeaderboardD1Config();
  console.log("[Phase7.2] READ_ONLY. No writes, repair, replay or backfill.");
  console.log(`[Phase7.2] flags: projection=${flag("LEADERBOARD_D1_PROJECTION_ENABLED")}, reads=${flag("LEADERBOARD_D1_READ_ENABLED")}, workerConfigured=${workerConfigured}`);
  const [states, recent] = await Promise.all([
    database.leaderboardD1SyncOutbox.groupBy({ by: ["state"], _count: { _all: true } }),
    database.leaderboardSeason.findMany({
      where: { scope: { in: [...SCOPES] } },
      orderBy: { updatedAt: "desc" },
      take: 90,
      select: {
        id: true, scope: true, seasonKey: true, status: true, startsAt: true, endsAt: true,
        snapshots: { where: { status: "READY" }, orderBy: [{ generatedAt: "desc" }], take: 2,
          select: { id: true, snapshotType: true, generatedAt: true, entryCount: true, revision: true } },
      },
    }),
  ]);
  const summary = Object.fromEntries(states.map((item) => [item.state, item._count._all]));
  console.log(`[Phase7.2] Outbox counts ${JSON.stringify(summary)}`);
  let blocked = Number(summary.BLOCKED || 0) + Number(summary.POISON || 0);
  let unmatched = 0;
  for (const scope of SCOPES) {
    const candidates = recent.filter((item) => item.scope === scope);
    const season = candidates.find((item) => item.status === "ACTIVE") ?? candidates[0];
    if (!season) {
      console.log(`[Phase7.2] ${scope}: NO_CANONICAL_SEASON`);
      continue;
    }
    const snapshot = season.snapshots[0];
    if (!snapshot) {
      console.log(`[Phase7.2] ${scope}: season=${season.seasonKey}, NO_READY_SNAPSHOT`);
      continue;
    }
    console.log(`[Phase7.2] ${scope}: season=${season.seasonKey}, type=${snapshot.snapshotType}, entries=${snapshot.entryCount}, ageMinutes=${Math.floor((Date.now()-snapshot.generatedAt.getTime())/60_000)}`);
    if (!workerConfigured) {
      console.log(`[Phase7.2] ${scope}: SKIP_D1_NO_CONFIG`);
      continue;
    }
    const result = await reconcileLeaderboardD1Cache({ snapshotId: snapshot.id, database });
    const issues = result.checks.filter((check) => check.status !== "PASS").map((check) => check.code);
    console.log(`[Phase7.2] ${scope}: D1=${result.status}${issues.length ? ` issues=${issues.join(",")}` : ""}`);
    if (result.status !== "MATCHED") unmatched += 1;
  }
  console.log(`[Phase7.2] SUMMARY: blockedOutbox=${blocked}, unmatchedSnapshots=${unmatched}; no state changed.`);
  if (blocked > 0 || unmatched > 0) process.exitCode = 2;
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "UNAVAILABLE";
  // Avoid printing transport/URL/connection strings, IDs or credentials.
  console.error(`[Phase7.2] FAILED: category=${/P1001|P1002|DB_CONNECTION|connect/i.test(message) ? "DATABASE_CONNECTION" : "AUDIT_ERROR"} code=${/^[A-Z][A-Z0-9_]{0,30}$/.test(code) ? code : "UNAVAILABLE"}`);
  process.exitCode = 2;
});
