/** READ ONLY diagnostics for FocusSession Outbox SQLSTATE 23502 and Challenge P2010.
 * Does not enqueue, refresh Challenges, change scores, or mutate any table.
 */
import "dotenv/config";
import { getPrisma, disconnectPrisma } from "../server/services/prismaClient.js";

const prisma = getPrisma();
const clean = (s: unknown) => String(s ?? "")
  .replace(/postgres(?:ql)?:\/\/[^\s'";]+/gi, "[DB_CONNECTION_REDACTED]")
  .replace(/(password|secret|token|api[_-]?key)\s*[:=]\s*[^\s'";]+/gi, "$1=[REDACTED]")
  .slice(0, 500);
type Col = { table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null; is_identity: string };
type Tr = { table_name: string; trigger_name: string; function_name: string; def: string };
type Fn = { function_name: string; body: string };

async function main() {
  console.log("[RootCause] READ_ONLY — no data mutations, no reward refreshes.");
  const cols = await prisma.$queryRaw<Col[]>`
    SELECT table_name, column_name, data_type, is_nullable, column_default, is_identity
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('PrivateD1SyncOutbox', 'FocusSession', 'UserChallengeProgress', 'ChallengeInstance')
      AND (table_name <> 'PrivateD1SyncOutbox' OR column_name IN ('id','revision','dedupeKey','entity','operation','key','data','state'))
    ORDER BY table_name, ordinal_position`;
  for (const c of cols) {
    console.log(`[RootCause] column ${c.table_name}.${c.column_name}: ${c.data_type}, nullable=${c.is_nullable}, identity=${c.is_identity}, default=${clean(c.column_default || 'NONE')}`);
  }
  const seq = await prisma.$queryRaw<Array<{ seq: string | null }>>`
    SELECT pg_get_serial_sequence('public."PrivateD1SyncOutbox"', 'id') AS seq`;
  console.log(`[RootCause] Outbox id sequence=${clean(seq[0]?.seq || 'MISSING')}`);
  const tr = await prisma.$queryRaw<Tr[]>`
    SELECT c.relname AS table_name, t.tgname AS trigger_name, p.proname AS function_name,
      pg_get_triggerdef(t.oid) AS def
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
      AND c.relname IN ('PrivateD1SyncOutbox', 'FocusSession', 'UserChallengeProgress', 'ChallengeInstance')
    ORDER BY c.relname, t.tgname`;
  for (const t of tr) console.log(`[RootCause] trigger ${t.table_name}.${t.trigger_name} function=${t.function_name} ${clean(t.def)}`);
  const funcs = await prisma.$queryRaw<Fn[]>`
    SELECT p.proname AS function_name, pg_get_functiondef(p.oid) AS body
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'phase3_%' OR p.proname LIKE 'phase4_%' OR p.proname LIKE 'phase6_%')
      AND (pg_get_functiondef(p.oid) ILIKE '%PrivateD1SyncOutbox%'
        OR pg_get_functiondef(p.oid) ILIKE '%FocusSession%')
    ORDER BY p.proname`;
  for (const f of funcs) {
    const lines = f.body.split('\n');
    const marked = lines.map((v, i) => ({ v, i })).filter(x => /PrivateD1SyncOutbox|INSERT INTO|UPDATE |nextval|revision|dedupeKey|FocusSession|phase3_enqueue_outbox|VALUES\s*\(/i.test(x.v));
    console.log(`[RootCause] function ${f.function_name}: matched_lines=${marked.length}`);
    for (const x of marked.slice(0, 32)) console.log(`[RootCause]   L${x.i + 1}: ${clean(x.v.trim())}`);
  }
  const status = await prisma.$queryRaw<Array<{ entity: string; state: string; ct: bigint }>>`
    SELECT "entity", COALESCE("state", 'UNKNOWN') AS "state", COUNT(*)::bigint AS ct
    FROM public."PrivateD1SyncOutbox" WHERE "entity" IN ('FocusSession', 'GamificationSnapshot')
    GROUP BY "entity", "state" ORDER BY "entity", "state"`;
  for (const s of status) console.log(`[RootCause] outbox ${s.entity} ${s.state} count=${s.ct.toString()}`);
  const id = cols.find(c=>c.table_name==='PrivateD1SyncOutbox' && c.column_name==='id');
  const rev = cols.find(c=>c.table_name==='PrivateD1SyncOutbox' && c.column_name==='revision');
  if (!id?.column_default && id?.is_identity!=='YES') console.log('[RootCause] WARNING: Outbox.id has no default/identity; legacy trigger INSERTs omitting id will fail.');
  if (!rev?.column_default) console.log('[RootCause] NOTE: Outbox.revision has no default, so every insert must explicitly provide revision.');
  console.log('[RootCause] DONE — inspect output before altering constraints, migrations or retrying repair.');
}
main().catch(e => {
  const x = e as {code?: string; meta?: {code?: string;message?: string}};
  console.error(`[RootCause] FAILED prisma=${clean(x.code)} db=${clean(x.meta?.code)} detail=${clean(x.meta?.message ?? (e instanceof Error ? e.message : e))}`);
  process.exitCode = 1;
}).finally(async()=>{await disconnectPrisma().catch(()=>{});});
