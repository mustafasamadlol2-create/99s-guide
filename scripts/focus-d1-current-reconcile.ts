/** Phase 5: audit authoritative Focus sessions versus strict D1 reads.
 * Read-only unless --repair is explicitly provided. Never completes a session.
 */
import "dotenv/config";
import type { PrismaClient } from "@prisma/client";
import { getPrisma, disconnectPrisma } from "../server/services/prismaClient.js";
import { buildFocusSessionProjection } from "../server/features/study-core/projection.js";
import { enqueuePrivateD1Projection } from "../server/services/privateD1Sync.js";

const base = String(process.env.PRIVATE_DATA_WORKER_BASE_URL || "").trim().replace(/\/+$/, "");
const secret = String(process.env.PRIVATE_DATA_SYNC_SECRET || "").trim();
const repair = process.argv.includes("--repair");
const all = process.argv.includes("--all");
const userArg = process.argv.find((value) => value.startsWith("--user-id="));
const onlyUser = userArg ? userArg.slice("--user-id=".length) : null;
const live = ["CREATED", "ACTIVE", "PAUSED", "RESOURCE_HANDOFF", "RECONCILIATION_REQUIRED"];
if (!base || !secret) throw new Error("Configure PRIVATE_DATA_WORKER_BASE_URL and PRIVATE_DATA_SYNC_SECRET.");
if (repair && !process.argv.includes("--confirm-repair")) throw new Error("Repair requires --repair --confirm-repair. Run audit first.");

async function readWorker(userId: string): Promise<Array<Record<string, unknown>>> {
  const url = new URL("/internal/private-read/focus-sessions", `${base}/`);
  url.searchParams.set("userId", userId);
  url.searchParams.set("nonterminal", "1");
  url.searchParams.set("limit", "50");
  const response = await fetch(url, {
    headers: { "X-Private-Data-Sync-Secret": secret, Accept: "application/json", "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Worker current-session read HTTP ${response.status}`);
  const body = await response.json() as { rows?: Array<Record<string, unknown>> };
  if (!Array.isArray(body.rows)) throw new Error("Malformed Worker focus-sessions response.");
  if (body.rows.some((row) => row.userId !== userId || row.userScope !== userId)) throw new Error("Scope mismatch in Worker response.");
  return body.rows;
}

async function main(): Promise<void> {
  const db: PrismaClient = getPrisma();
  const recent = onlyUser ? [] : await db.focusSession.findMany({
    select: { userId: true }, orderBy: { updatedAt: "desc" }, take: all ? 10000 : 50,
  });
  const active = onlyUser ? [] : await db.focusSession.findMany({
    where: { status: { in: live } }, select: { userId: true },
  });
  const selected = onlyUser ? [onlyUser] : [...new Set([...active, ...recent].map((r) => r.userId))];
  console.log(`[Focus audit] users to inspect=${selected.length}, mode=${repair ? "OUTBOX_REPAIR" : "READ_ONLY"}`);
  let failures = 0;
  let enqueued = 0;
  for (let i = 0; i < selected.length; i++) {
    const userId = selected[i];
    const canonical = await db.focusSession.findMany({
      where: { userId, status: { in: live } },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    });
    const projected = await readWorker(userId);
    if (canonical.length > 1 || projected.length > 1) {
      failures++;
      console.error(`[Focus audit] account ${i + 1}: multiple active records; manual review required (PG=${canonical.length}, D1=${projected.length}).`);
      continue;
    }
    const pgMap = new Map(canonical.map((item) => [item.id, item]));
    const repairIds = new Set<string>();
    for (const row of projected) {
      const id = String(row.id || "");
      const current = pgMap.get(id);
      if (!current || current.status !== row.status || String(current.projectionRevision) !== String(row.revision)) repairIds.add(id);
    }
    for (const item of canonical) {
      const row = projected.find((candidate) => candidate.id === item.id);
      if (!row || row.status !== item.status || String(row.revision) !== String(item.projectionRevision)) repairIds.add(item.id);
    }
    if (repairIds.size === 0) continue;
    failures++;
    console.error(`[Focus audit] account ${i + 1}: PG live=${canonical.length}, D1 live=${projected.length}, stale/missing IDs=${repairIds.size}.`);
    if (!repair) continue;
    // Resolve ghost D1 sessions to their canonical terminal state; never
    // invent status, delete rows, or mutate the actual Focus lifecycle.
    const rows = await db.focusSession.findMany({
      where: { userId, id: { in: [...repairIds] } },
    });
    if (rows.length !== repairIds.size) {
      console.error(`[Focus audit] account ${i + 1}: unmatched row, refusing repair.`);
      continue;
    }
    for (const row of rows) {
      const projection = buildFocusSessionProjection({
        session: {
          id: row.id, userId: row.userId, planId: row.planId,
          planItemId: row.planItemId, lectureId: row.lectureId,
          status: row.status, startedAt: row.startedAt?.toISOString() ?? null,
          plannedEndAt: row.plannedEndAt?.toISOString() ?? null, actualEndedAt: row.actualEndedAt?.toISOString() ?? null,
          lastCheckpointAt: row.lastCheckpointAt?.toISOString() ?? null, activeSeconds: row.activeSeconds,
          pauseSeconds: row.pauseSeconds, completionReason: row.completionReason,
          updatedAt: row.updatedAt,
        },
        revision: row.projectionRevision.toString(),
      });
      await enqueuePrivateD1Projection(db, {
        entity: "FocusSession", key: { id: row.id },
        data: projection as unknown as Record<string, unknown>,
      });
      enqueued++;
    }
  }
  const outbox = await db.$queryRawUnsafe<Array<{entity: string; state: string; count: bigint}>>(
    `SELECT "entity", COALESCE("state", 'UNKNOWN') AS "state", COUNT(*)::bigint AS "count"
       FROM "PrivateD1SyncOutbox"
      WHERE "entity" IN ('FocusSession', 'GamificationSnapshot')
      GROUP BY "entity", "state"
      ORDER BY "entity", "state"`
  );
  for (const row of outbox) {
    console.log(`[Focus audit] outbox ${row.entity} ${row.state}: ${row.count.toString()}`);
  }
  console.log(`[Focus audit] divergent accounts=${failures}, queued repairs=${enqueued}.`);
  if (repair) {
    console.log("[Focus audit] Outbox rows queued. Wait for normal Render drainer; rerun without --repair to confirm D1 parity.");
  } else if (failures > 0) {
    console.log("[Focus audit] No writes performed. Review discrepancies before using --repair --confirm-repair.");
    process.exitCode = 2;
  } else {
    console.log("[Focus audit] PASS: current Focus session identities/statuses and revisions match for inspected accounts.");
  }
}
main().catch((error) => {
  console.error(`[Focus audit] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}).finally(async () => { await disconnectPrisma().catch(() => {}); });
