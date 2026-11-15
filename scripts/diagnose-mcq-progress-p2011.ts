/**
 * Read-only Supabase schema diagnostics for MCQ submission P2011 errors.
 * Does not inspect student rows or log credentials or user identifiers.
 */
import "dotenv/config";
import { getPrisma, disconnectPrisma } from "../server/services/prismaClient.js";

type Column = {
  table_name: string;
  column_name: string;
  is_nullable: string;
  column_default: string | null;
  data_type: string;
};
type DbTrigger = {
  table_name: string;
  trigger_name: string;
  function_name: string;
};

const required = new Set([
  "userId", "lectureId", "pdfCompleted", "notesCompleted",
  "videoCompleted", "flashcardsCompleted", "quizCompleted", "lastAccessed",
]);
const optional = new Set([
  "quizScore", "pdfCompletedAt", "notesCompletedAt", "videoCompletedAt",
  "flashcardsCompletedAt", "quizCompletedAt", "lectureCompletedAt",
]);
const defaultNeeded = new Set([
  "pdfCompleted", "notesCompleted", "videoCompleted", "flashcardsCompleted",
  "quizCompleted", "lastAccessed",
]);
const known = new Set([...required, ...optional]);

async function main(): Promise<void> {
  const db = getPrisma();
  const columns = await db.$queryRaw`
    SELECT table_name, column_name, is_nullable, column_default, data_type
    FROM information_schema.columns
    WHERE table_schema = ANY (current_schemas(false))
      AND table_name IN ('LectureProgress', 'PrivateD1SyncOutbox')
    ORDER BY table_name, ordinal_position
  ` as Column[];
  const progress = columns.filter((r) => r.table_name === "LectureProgress");
  if (!progress.length) {
    console.log("[MCQ-P2011] LectureProgress table was NOT found in current schema path.");
    process.exitCode = 2;
    return;
  }

  console.log("[MCQ-P2011] Read-only schema audit (no student data queried).");
  let problems = 0;
  for (const c of progress) {
    const notNull = c.is_nullable === "NO";
    const status = optional.has(c.column_name) && notNull
      ? "MISMATCH: Prisma expects NULLABLE"
      : required.has(c.column_name) && !notNull
        ? "MISMATCH: Prisma expects NOT NULL"
        : defaultNeeded.has(c.column_name) && c.column_default === null
          ? "MISMATCH: missing expected DEFAULT"
          : !known.has(c.column_name) && notNull && c.column_default === null
            ? "CHECK: extra NOT NULL column without DEFAULT"
            : "OK";
    if (status !== "OK") problems++;
    console.log(`[MCQ-P2011] LectureProgress.${c.column_name}: nullable=${c.is_nullable} default=${c.column_default !== null ? 'yes' : 'no'} ${status}`);
  }
  for (const col of known) {
    if (!progress.some((c) => c.column_name === col)) {
      console.log(`[MCQ-P2011] MISMATCH: LectureProgress.${col} missing`);
      problems++;
    }
  }

  const triggers = await db.$queryRaw`
    SELECT cls.relname::text AS table_name, trg.tgname::text AS trigger_name,
           pro.proname::text AS function_name
    FROM pg_trigger trg
    JOIN pg_class cls ON cls.oid = trg.tgrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    JOIN pg_proc pro ON pro.oid = trg.tgfoid
    WHERE ns.nspname = ANY (current_schemas(false))
      AND cls.relname IN ('LectureProgress', 'PrivateD1SyncOutbox')
      AND NOT trg.tgisinternal
    ORDER BY cls.relname, trg.tgname
  ` as DbTrigger[];
  for (const t of triggers) {
    console.log(`[MCQ-P2011] Trigger ${t.table_name}.${t.trigger_name} -> ${t.function_name}`);
  }
  const outbox = columns.filter((r) => r.table_name === "PrivateD1SyncOutbox");
  if (!outbox.length) {
    console.log("[MCQ-P2011] CHECK: PrivateD1SyncOutbox missing from current schema path.");
    problems++;
  }
  const expectedOutboxColumns = new Set(["id", "entity", "operation", "key", "revision", "data", "attempts", "lastError", "nextAttemptAt", "updatedAt"]);
  for (const c of outbox) {
    const suspicious = c.is_nullable === "NO" && c.column_default === null && !expectedOutboxColumns.has(c.column_name);
    if (suspicious) problems++;
    console.log(`[MCQ-P2011] PrivateD1SyncOutbox.${c.column_name}: nullable=${c.is_nullable} default=${c.column_default !== null ? 'yes' : 'no'} ${suspicious ? 'CHECK: extra NOT NULL column without DEFAULT' : 'OK'}`);
  }
  console.log(`[MCQ-P2011] Audit complete: ${problems} column/schema flags. If zero, check Render [MCQ Submit Error] constraint metadata to identify an error inside a trigger.`);
}

main()
  .catch((error: unknown) => {
    const e = error as { code?: unknown; name?: unknown };
    const code = typeof e?.code === "string" ? e.code : "UNKNOWN";
    const name = typeof e?.name === "string" ? e.name : "Error";
    console.error(`[MCQ-P2011] Diagnostic failed (${name}/${code}). Check database connectivity.`);
    process.exitCode = 1;
  })
  .finally(async () => { await disconnectPrisma(); });
