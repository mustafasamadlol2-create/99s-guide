/**
 * Phase 6: read-only investigation of P2010 in weekly Challenge reconciliation.
 * No Challenge refresh, no rewards, no D1 writes, no outbox mutations.
 */
import "dotenv/config";
import { getPrisma, disconnectPrisma } from "../server/services/prismaClient.js";

type Column = { column_name: string; data_type: string; udt_name: string; is_nullable: string };
type OutboxCount = { entity: string; state: string | null; count: string };

const db = getPrisma();
const safeValue = (value: unknown): string => String(value ?? "")
  .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[DATABASE_URL_REDACTED]")
  .replace(/(password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
  .slice(0, 500);

function reportError(stage: string, error: unknown): void {
  const e = (error && typeof error === "object" ? error : {}) as {
    code?: unknown; meta?: { code?: unknown; message?: unknown }; message?: unknown;
  };
  console.error(`[Phase6 P2010] FAIL stage=${stage}; prismaCode=${safeValue(e.code || "UNKNOWN")}; dbCode=${safeValue(e.meta?.code || "UNKNOWN")}`);
  if (e.meta?.message) console.error(`[Phase6 P2010] dbMessage=${safeValue(e.meta.message)}`);
  else if (e.message) console.error(`[Phase6 P2010] error=${safeValue(e.message)}`);
  process.exitCode = 2;
}

async function main(): Promise<void> {
  console.log("[Phase6 P2010] READ_ONLY: inspecting Outbox SQL compatibility; no changes or reward writes.");
  let columns: Column[];
  try {
    columns = await db.$queryRaw<Column[]>`
      SELECT column_name, data_type, udt_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'PrivateD1SyncOutbox'
        AND column_name IN ('key', 'state', 'entity', 'id')
      ORDER BY column_name
    `;
    for (const c of columns) {
      console.log(`[Phase6 P2010] Outbox.${c.column_name}: type=${c.data_type} (${c.udt_name}), nullable=${c.is_nullable}`);
    }
    if (!columns.some(c => c.column_name === "key" && c.udt_name === "jsonb")) {
      console.warn("[Phase6 P2010] WARNING: Outbox.key is not jsonb; the reconcile query uses the JSONB ->> operator.");
    }
    if (!["key", "state", "entity", "id"].every(name => columns.some(c => c.column_name === name))) {
      console.error("[Phase6 P2010] WARNING: one or more required Outbox columns are absent.");
    }
  } catch (error) { reportError("OUTBOX_SCHEMA", error); return; }

  try {
    const stats = await db.$queryRaw<OutboxCount[]>`
      SELECT "entity", "state", COUNT(*)::text AS "count"
      FROM public."PrivateD1SyncOutbox"
      WHERE "entity" IN ('FocusSession', 'GamificationSnapshot')
      GROUP BY "entity", "state"
      ORDER BY "entity", "state"
    `;
    for (const stat of stats) console.log(`[Phase6 P2010] outbox ${stat.entity} ${stat.state ?? "NULL"}: ${stat.count}`);
  } catch (error) { reportError("OUTBOX_COUNTS", error); return; }

  let user: { id: string } | null;
  try {
    user = await db.user.findFirst({ where: { accountStatus: "ACTIVE" }, select: { id: true }, orderBy: { id: "asc" } });
  } catch (error) { reportError("ACCOUNT_READ", error); return; }
  if (!user) { console.log("[Phase6 P2010] No active account available for parameterized read test."); return; }

  try {
    const rows = await db.$queryRaw<Array<{ state: string }>>`
      SELECT "state"
      FROM public."PrivateD1SyncOutbox"
      WHERE "entity" = 'GamificationSnapshot'
        AND "key"->>'id' = ${user.id}
        AND "state" IN ('PENDING', 'RETRY', 'BLOCKED', 'POISON')
      ORDER BY "id" DESC LIMIT 1
    `;
    console.log(`[Phase6 P2010] Exact original outstandingOutboxState query: OK (result count=${rows.length}).`);
    console.log("[Phase6 P2010] If weekly --apply still fails P2010, it occurs AFTER this Outbox lookup; inspect canonical Challenge refresh or enqueue stage. Do not retry --apply blindly.");
  } catch (error) { reportError("OUTSTANDING_OUTBOX_LOOKUP", error); }
}

main().catch(error => reportError("STARTUP", error))
  .finally(async () => { await disconnectPrisma().catch(() => {}); });
