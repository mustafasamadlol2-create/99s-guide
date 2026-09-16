
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SERVER_FILE = path.join(ROOT, "server.ts");
const SERVER_DIR = path.join(ROOT, "server");
const SCHEMA_FILE = path.join(ROOT, "prisma", "schema.prisma");
const OUT_TXT = path.join(ROOT, "stage8a-final-report-v3.txt");
const OUT_JSON = path.join(ROOT, "stage8a-final-report-v3.json");

const READ_METHODS = new Set([
  "findMany","findUnique","findUniqueOrThrow","findFirst","findFirstOrThrow",
  "count","aggregate","groupBy"
]);
const WRITE_METHODS = new Set([
  "create","createMany","update","updateMany","upsert","delete","deleteMany"
]);
const SHARED_D1 = new Set(["Lecture","Material","Mcq","Flashcard","DailyMotto"]);
const PARTIAL_D1 = new Set(["CalendarEvent"]);

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    if (process.env[key] !== undefined) continue;
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1,-1);
    process.env[key] = value;
  }
}
loadEnv(path.join(ROOT, ".env"));
loadEnv(path.join(ROOT, ".env.production"));

if (!fs.existsSync(SERVER_FILE) || !fs.existsSync(SCHEMA_FILE)) {
  console.error("Run from project root containing server.ts and prisma/schema.prisma.");
  process.exit(2);
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out=[];
  for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
    if (["node_modules","dist",".git",".wrangler"].includes(e.name)) continue;
    const full=path.join(dir,e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile() && /\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) out.push(full);
  }
  return out;
}

const files=[SERVER_FILE,...walk(SERVER_DIR)];
const sources=files.map(file=>({
  file, rel:path.relative(ROOT,file), text:fs.readFileSync(file,"utf8")
}));
const schema=fs.readFileSync(SCHEMA_FILE,"utf8");

function parseModels(text) {
  const out=[];
  const re=/model\s+([A-Za-z0-9_]+)\s*\{[\s\S]*?\n\}/g;
  let m;
  while ((m=re.exec(text))) out.push(m[1]);
  return out;
}
const models=parseModels(schema);
const delegates=new Map(models.map(m=>[m[0].toLowerCase()+m.slice(1),m]));

function scanSource(src) {
  const hits=[];
  // Generic delegate scan catches prisma.user.*, db.user.*, client["user"].*, etc.
  const dot=/\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g;
  const bracket=/\b([A-Za-z_$][\w$]*)\s*\[\s*["']([A-Za-z_$][\w$]*)["']\s*\]\.([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m=dot.exec(src.text))) {
    const model=delegates.get(m[2]);
    if (!model) continue;
    hits.push({client:m[1],model,method:m[3],syntax:"dot"});
  }
  while ((m=bracket.exec(src.text))) {
    const model=delegates.get(m[2]);
    if (!model) continue;
    hits.push({client:m[1],model,method:m[3],syntax:"bracket"});
  }

  // Supabase-style table access if present.
  const supa=/\.from\s*\(\s*["']([^"']+)["']\s*\)/g;
  const from=[];
  while ((m=supa.exec(src.text))) from.push(m[1]);

  // Raw SQL / raw Prisma signals.
  const rawSignals=[];
  const rawRe=/\$(queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe)\b/g;
  while ((m=rawRe.exec(src.text))) rawSignals.push(m[1]);

  return {hits,from,rawSignals};
}

const scans=sources.map(src=>({...src,...scanSource(src)}));

const modelUsage={};
for (const model of models) {
  const perFile=[];
  let reads=[],writes=[],other=[];
  for (const s of scans) {
    const h=s.hits.filter(x=>x.model===model);
    if (!h.length) continue;
    const r=h.filter(x=>READ_METHODS.has(x.method));
    const w=h.filter(x=>WRITE_METHODS.has(x.method));
    const o=h.filter(x=>!READ_METHODS.has(x.method)&&!WRITE_METHODS.has(x.method));
    reads.push(...r); writes.push(...w); other.push(...o);
    perFile.push({
      file:s.rel,
      clients:[...new Set(h.map(x=>x.client))],
      reads:[...new Set(r.map(x=>x.method))],
      writes:[...new Set(w.map(x=>x.method))],
      other:[...new Set(o.map(x=>x.method))]
    });
  }
  modelUsage[model]={reads,writes,other,perFile};
}

const dbUrl=process.env.AUDIT_DATABASE_URL||process.env.DATABASE_URL||process.env.DIRECT_URL||"";
if (!dbUrl) {
  console.error("No DATABASE_URL / DIRECT_URL / AUDIT_DATABASE_URL found.");
  process.exit(2);
}
process.env.DATABASE_URL=dbUrl;

let PrismaClient;
try {
  ({PrismaClient}=await import("@prisma/client"));
} catch(e) {
  console.error(`@prisma/client unavailable: ${e.message}`);
  process.exit(2);
}

const prisma=new PrismaClient();
let dbTables=[];
try {
  const rows=await prisma.$queryRawUnsafe(`
    SELECT
      c.relname AS "tableName",
      pg_total_relation_size(c.oid)::bigint AS "totalBytes",
      pg_relation_size(c.oid)::bigint AS "tableBytes",
      pg_indexes_size(c.oid)::bigint AS "indexBytes",
      COALESCE(s.seq_scan,0)::bigint AS "seqScan",
      COALESCE(s.seq_tup_read,0)::bigint AS "seqRowsRead",
      COALESCE(s.idx_scan,0)::bigint AS "idxScan",
      COALESCE(s.idx_tup_fetch,0)::bigint AS "idxRowsFetched",
      COALESCE(s.n_tup_ins,0)::bigint AS "rowsInserted",
      COALESCE(s.n_tup_upd,0)::bigint AS "rowsUpdated",
      COALESCE(s.n_tup_del,0)::bigint AS "rowsDeleted"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid
    WHERE n.nspname='public' AND c.relkind='r'
    ORDER BY pg_total_relation_size(c.oid) DESC
  `);

  for (const row of rows) {
    const name=String(row.tableName);
    const quoted=`"${name.replaceAll('"','""')}"`;
    const count=await prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS "count" FROM ${quoted}`);
    dbTables.push({
      tableName:name,
      exactRows:Number(count?.[0]?.count??0),
      totalBytes:Number(row.totalBytes??0),
      tableBytes:Number(row.tableBytes??0),
      indexBytes:Number(row.indexBytes??0),
      seqScan:Number(row.seqScan??0),
      seqRowsRead:Number(row.seqRowsRead??0),
      idxScan:Number(row.idxScan??0),
      idxRowsFetched:Number(row.idxRowsFetched??0),
      rowsInserted:Number(row.rowsInserted??0),
      rowsUpdated:Number(row.rowsUpdated??0),
      rowsDeleted:Number(row.rowsDeleted??0)
    });
  }
} finally {
  await prisma.$disconnect().catch(()=>{});
}

function fmt(n) {
  if (n==null) return "n/a";
  const units=["B","KB","MB","GB"]; let v=Number(n),i=0;
  while(v>=1024&&i<3){v/=1024;i++;}
  return `${v.toFixed(i?2:0)} ${units[i]}`;
}

const dbMap=new Map(dbTables.map(x=>[x.tableName.toLowerCase(),x]));
const modelAudit=models.map(model=>{
  const delegate=model[0].toLowerCase()+model.slice(1);
  const db=dbMap.get(model.toLowerCase())||dbMap.get(delegate.toLowerCase())||null;
  const u=modelUsage[model];
  let className="remaining-supabase";
  if (SHARED_D1.has(model)) className="already-shared-d1";
  else if (PARTIAL_D1.has(model)) className="partial-d1";
  return {
    model,classification:className,
    exactRows:db?.exactRows??null,totalBytes:db?.totalBytes??null,
    seqScan:db?.seqScan??null,seqRowsRead:db?.seqRowsRead??null,
    idxScan:db?.idxScan??null,idxRowsFetched:db?.idxRowsFetched??null,
    rowsInserted:db?.rowsInserted??null,rowsUpdated:db?.rowsUpdated??null,rowsDeleted:db?.rowsDeleted??null,
    codeReadCalls:u.reads.length,codeWriteCalls:u.writes.length,codeOtherCalls:u.other.length,
    backendFiles:u.perFile
  };
});

const remaining=modelAudit.filter(x=>x.classification!=="already-shared-d1");

const rawSqlFiles=scans
  .filter(s=>s.rawSignals.length||s.from.length)
  .map(s=>({file:s.rel,rawSignals:[...new Set(s.rawSignals)],supabaseFrom:[...new Set(s.from)]}));

const report={
  generatedAt:new Date().toISOString(),
  mode:"READ_ONLY",
  root:ROOT,
  backendFilesScanned:files.map(x=>path.relative(ROOT,x)),
  totals:{
    models:models.length,
    dbTables:dbTables.length,
    remainingTables:remaining.length
  },
  modelAudit,
  remainingTables:remaining,
  rawSqlFiles
};

fs.writeFileSync(OUT_JSON,JSON.stringify(report,null,2));

const lines=[];
lines.push("99's Guide — Stage 8A FINAL Remaining Supabase Audit V3");
lines.push("========================================================");
lines.push(`Project root: ${ROOT}`);
lines.push(`Generated: ${report.generatedAt}`);
lines.push("Mode: READ-ONLY");
lines.push("");
lines.push("MODEL / DATABASE SUMMARY");
lines.push("------------------------");
lines.push("Model | Class | Rows | Size | Seq scans | Seq rows read | Index scans | Index rows fetched | Code reads | Code writes");
for(const x of modelAudit){
  lines.push(`${x.model} | ${x.classification} | ${x.exactRows??"n/a"} | ${fmt(x.totalBytes)} | ${x.seqScan??"n/a"} | ${x.seqRowsRead??"n/a"} | ${x.idxScan??"n/a"} | ${x.idxRowsFetched??"n/a"} | ${x.codeReadCalls} | ${x.codeWriteCalls}`);
}
lines.push("");
lines.push("REMAINING SUPABASE TABLES");
lines.push("-------------------------");
for(const x of remaining){
  lines.push(`${x.model} — rows=${x.exactRows??"n/a"}, size=${fmt(x.totalBytes)}, seqRowsRead=${x.seqRowsRead??"n/a"}, idxRowsFetched=${x.idxRowsFetched??"n/a"}, codeReads=${x.codeReadCalls}, codeWrites=${x.codeWriteCalls}`);
  for(const f of x.backendFiles){
    lines.push(`   ${f.file} | clients=${f.clients.join(",")} | reads=${f.reads.join(",")||"-"} | writes=${f.writes.join(",")||"-"} | other=${f.other.join(",")||"-"}`);
  }
}
lines.push("");
lines.push("RAW SQL / SUPABASE-CLIENT SIGNALS");
lines.push("---------------------------------");
if(!rawSqlFiles.length) lines.push("None detected in scanned backend files.");
for(const x of rawSqlFiles){
  lines.push(`${x.file} | raw=${x.rawSignals.join(",")||"-"} | from=${x.supabaseFrom.join(",")||"-"}`);
}
lines.push("");
lines.push("TOP TABLES BY OBSERVED POSTGRES READ ACTIVITY");
lines.push("---------------------------------------------");
const byActivity=[...dbTables].sort((a,b)=>(b.seqRowsRead+b.idxRowsFetched)-(a.seqRowsRead+a.idxRowsFetched));
for(const t of byActivity.slice(0,25)){
  lines.push(`${t.tableName} — rows=${t.exactRows}, size=${fmt(t.totalBytes)}, seqRowsRead=${t.seqRowsRead}, idxRowsFetched=${t.idxRowsFetched}, seqScan=${t.seqScan}, idxScan=${t.idxScan}`);
}
lines.push("");
lines.push("IMPORTANT");
lines.push("---------");
lines.push("PostgreSQL pg_stat_user_tables counters are cumulative since their last stats reset.");
lines.push("They are not Supabase egress bytes, but they reveal which tables have actually been read heavily.");
lines.push("");
lines.push("No database was modified.");
lines.push("No source file was modified.");
lines.push("STAGE 8A FINAL V3 AUDIT COMPLETED");

fs.writeFileSync(OUT_TXT,lines.join("\n"));
console.log(lines.join("\n"));
console.log(`\nSaved: ${path.basename(OUT_TXT)}`);
console.log(`Saved: ${path.basename(OUT_JSON)}`);
