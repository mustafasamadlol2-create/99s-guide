
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SERVER_FILE = path.join(ROOT, "server.ts");
const SERVER_DIR = path.join(ROOT, "server");
const SCHEMA_FILE = path.join(ROOT, "prisma", "schema.prisma");
const WORKER_FILE = path.join(ROOT, "cloudflare-content-api", "src", "index.ts");
const OUT_TXT = path.join(ROOT, "stage8a-audit-report-v2.txt");
const OUT_JSON = path.join(ROOT, "stage8a-audit-report-v2.json");

const SHARED_D1 = new Set(["Lecture","Material","Mcq","Flashcard","DailyMotto"]);
const PARTIAL_D1 = new Set(["CalendarEvent"]);
const READ_METHODS = new Set([
  "findMany","findUnique","findUniqueOrThrow","findFirst","findFirstOrThrow",
  "count","aggregate","groupBy"
]);
const WRITE_METHODS = new Set([
  "create","createMany","update","updateMany","upsert","delete","deleteMany"
]);

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

function walkTs(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    if (["node_modules","dist",".git"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (entry.isFile() && /\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

if (!fs.existsSync(SERVER_FILE) || !fs.existsSync(SCHEMA_FILE)) {
  console.error("Run this script from the real 99's Guide project root containing server.ts and prisma/schema.prisma.");
  process.exit(2);
}

const sourceFiles = [SERVER_FILE, ...walkTs(SERVER_DIR)];
const sources = sourceFiles.map(file => ({
  file,
  rel:path.relative(ROOT,file),
  text:fs.readFileSync(file,"utf8")
}));
const server = fs.readFileSync(SERVER_FILE,"utf8");
const schema = fs.readFileSync(SCHEMA_FILE,"utf8");
const worker = fs.existsSync(WORKER_FILE) ? fs.readFileSync(WORKER_FILE,"utf8") : "";

function parseModels(text) {
  const out=[];
  const re=/model\s+([A-Za-z0-9_]+)\s*\{[\s\S]*?\n\}/g;
  let m;
  while ((m=re.exec(text))) out.push(m[1]);
  return out;
}
function clientName(model){return model[0].toLowerCase()+model.slice(1);}
function callsIn(text, model) {
  const re=new RegExp(String.raw`\bprisma\.${clientName(model)}\.([A-Za-z0-9_]+)\s*\(`,"g");
  const arr=[]; let m;
  while ((m=re.exec(text))) arr.push(m[1]);
  return arr;
}
function parseRoutes(text) {
  const re=/\bapp\.(get|post|put|patch|delete)\s*\(\s*([`'"])(.*?)\2/g;
  const starts=[]; let m;
  while ((m=re.exec(text))) starts.push({method:m[1].toUpperCase(),path:m[3],index:m.index});
  return starts.map((r,i)=>({...r,source:text.slice(r.index,i+1<starts.length?starts[i+1].index:text.length)}));
}
function fmt(n) {
  if (n==null) return "n/a";
  const units=["B","KB","MB","GB"]; let v=Number(n),i=0;
  while(v>=1024&&i<3){v/=1024;i++;}
  return `${v.toFixed(i?2:0)} ${units[i]}`;
}

const models=parseModels(schema);
const routes=parseRoutes(server);

// Scan all backend source files, not only server.ts.
const modelUsage={};
for (const model of models) {
  let reads=[],writes=[],files=[];
  for (const src of sources) {
    const calls=callsIn(src.text,model);
    if (!calls.length) continue;
    const r=calls.filter(x=>READ_METHODS.has(x));
    const w=calls.filter(x=>WRITE_METHODS.has(x));
    if (r.length||w.length) files.push({file:src.rel,reads:r,writes:w});
    reads.push(...r); writes.push(...w);
  }
  modelUsage[model]={reads,writes,files};
}

// Direct route matrix from server.ts. This intentionally labels direct usage only.
const routeMatrix=[];
for (const route of routes) {
  const hits=[];
  for (const model of models) {
    const calls=callsIn(route.source,model);
    if (!calls.length) continue;
    hits.push({
      model,
      reads:[...new Set(calls.filter(x=>READ_METHODS.has(x)))],
      writes:[...new Set(calls.filter(x=>WRITE_METHODS.has(x)))]
    });
  }
  if (hits.length) routeMatrix.push({method:route.method,path:route.path,models:hits});
}

function dbTarget(url) {
  try {
    const u=new URL(url);
    return {hostname:u.hostname,database:u.pathname.replace(/^\//,"")};
  } catch { return null; }
}

async function auditWithPrisma(url) {
  process.env.DATABASE_URL=url;
  const mod=await import("@prisma/client");
  const prisma=new mod.PrismaClient();
  try {
    const meta=await prisma.$queryRawUnsafe(`
      SELECT c.relname AS "tableName",
             pg_total_relation_size(c.oid)::bigint AS "totalBytes",
             pg_relation_size(c.oid)::bigint AS "tableBytes",
             pg_indexes_size(c.oid)::bigint AS "indexBytes"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r'
      ORDER BY pg_total_relation_size(c.oid) DESC
    `);
    const tables=[];
    for (const row of meta) {
      const name=String(row.tableName);
      const quoted=`"${name.replaceAll('"','""')}"`;
      const c=await prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS "count" FROM ${quoted}`);
      tables.push({
        tableName:name,
        exactRows:Number(c?.[0]?.count ?? 0),
        totalBytes:Number(row.totalBytes),
        tableBytes:Number(row.tableBytes),
        indexBytes:Number(row.indexBytes)
      });
    }
    return tables;
  } finally { await prisma.$disconnect().catch(()=>{}); }
}

async function auditWithPg(url) {
  const mod=await import("pg");
  const Client=mod.Client || mod.default?.Client;
  if (!Client) throw new Error("pg Client export unavailable");
  const client=new Client({connectionString:url,ssl:{rejectUnauthorized:false}});
  await client.connect();
  try {
    const meta=await client.query(`
      SELECT c.relname AS "tableName",
             pg_total_relation_size(c.oid)::bigint AS "totalBytes",
             pg_relation_size(c.oid)::bigint AS "tableBytes",
             pg_indexes_size(c.oid)::bigint AS "indexBytes"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r'
      ORDER BY pg_total_relation_size(c.oid) DESC
    `);
    const tables=[];
    for (const row of meta.rows) {
      const quoted=`"${String(row.tableName).replaceAll('"','""')}"`;
      const c=await client.query(`SELECT COUNT(*)::bigint AS "count" FROM ${quoted}`);
      tables.push({
        tableName:String(row.tableName),
        exactRows:Number(c.rows?.[0]?.count ?? 0),
        totalBytes:Number(row.totalBytes),
        tableBytes:Number(row.tableBytes),
        indexBytes:Number(row.indexBytes)
      });
    }
    return tables;
  } finally { await client.end().catch(()=>{}); }
}

async function dbAudit() {
  const url=process.env.AUDIT_DATABASE_URL||process.env.DATABASE_URL||process.env.DIRECT_URL||"";
  if (!url) return {connected:false,driver:null,reason:"No database URL available",target:null,tables:[]};
  const target=dbTarget(url);
  try {
    const tables=await auditWithPrisma(url);
    return {connected:true,driver:"@prisma/client",reason:null,target,tables};
  } catch (e1) {
    try {
      const tables=await auditWithPg(url);
      return {connected:true,driver:"pg",reason:null,target,tables};
    } catch (e2) {
      return {
        connected:false,driver:null,target,tables:[],
        reason:`Prisma failed: ${e1.message}; pg fallback failed: ${e2.message}`
      };
    }
  }
}

const db=await dbAudit();
const dbMap=new Map(db.tables.map(x=>[x.tableName.toLowerCase(),x]));

const modelAudit=models.map(model=>{
  const u=modelUsage[model];
  const dbRow=dbMap.get(model.toLowerCase())||dbMap.get(clientName(model).toLowerCase())||null;
  let classification="not-seen-in-backend";
  if (SHARED_D1.has(model)) classification="already-shared-d1";
  else if (PARTIAL_D1.has(model)) classification="partial-d1";
  else if (u.reads.length) classification="remaining-supabase-read";
  else if (u.writes.length) classification="write-only-or-server-side";
  return {
    model,classification,
    readCalls:u.reads.length,writeCalls:u.writes.length,
    readMethods:[...new Set(u.reads)],writeMethods:[...new Set(u.writes)],
    backendFiles:u.files,
    directRoutes:routeMatrix.filter(r=>r.models.some(x=>x.model===model)).map(r=>`${r.method} ${r.path}`),
    exactRows:dbRow?.exactRows??null,totalBytes:dbRow?.totalBytes??null
  };
});

const remaining=modelAudit
  .filter(x=>x.classification==="remaining-supabase-read"||x.classification==="partial-d1")
  .sort((a,b)=>(b.readCalls-a.readCalls)||((b.totalBytes??0)-(a.totalBytes??0)));

const workerSignals={
  contentSync:worker.includes("/internal/content-sync"),
  lectures:worker.includes("/internal/content-read/lectures"),
  materials:worker.includes("/internal/content-read/materials-data"),
  mottos:worker.includes("/internal/content-read/mottos/active"),
  calendar:worker.includes("/internal/content-read/calendar/global"),
  search:worker.includes("/internal/content-read/search"),
  cacheFlag:worker.includes("CONTENT_SHARED_CACHE_ENABLED"),
  safeInvalidation:worker.includes("invalidateLocalSharedCacheAfterMutation")
};

const report={
  generatedAt:new Date().toISOString(),mode:"READ_ONLY",
  root:ROOT,sourceFilesScanned:sourceFiles.map(x=>path.relative(ROOT,x)),
  db,workerSignals,
  totals:{
    prismaModels:models.length,
    backendSourceFilesScanned:sourceFiles.length,
    expressRoutes:routes.length,
    remainingModelsWithSupabaseReads:remaining.length
  },
  modelAudit,remainingSupabaseReadCandidates:remaining,directRouteMatrix:routeMatrix
};
fs.writeFileSync(OUT_JSON,JSON.stringify(report,null,2));

const lines=[];
lines.push("99's Guide — Stage 8A Remaining Supabase Read Audit V2");
lines.push("=======================================================");
lines.push(`Project root: ${ROOT}`);
lines.push(`Generated: ${report.generatedAt}`);
lines.push("Mode: READ-ONLY","");
lines.push("DATABASE");
lines.push(`Connected: ${db.connected?"YES":"NO"}`);
lines.push(`Driver: ${db.driver??"none"}`);
if(db.target) lines.push(`Target: ${db.target.hostname} / ${db.target.database}`);
if(!db.connected) lines.push(`Reason: ${db.reason}`);
lines.push("","WORKER SIGNALS");
for(const[k,v]of Object.entries(workerSignals)) lines.push(`${k}: ${v?"YES":"NO"}`);
lines.push("","MODEL SUMMARY");
lines.push("Model | Class | Reads | Writes | Rows | Size | Backend files | Direct routes");
for(const x of modelAudit) lines.push(
  `${x.model} | ${x.classification} | ${x.readCalls} | ${x.writeCalls} | ${x.exactRows??"n/a"} | ${fmt(x.totalBytes)} | ${x.backendFiles.length} | ${x.directRoutes.length}`
);
lines.push("","REMAINING SUPABASE READ CANDIDATES");
if(!remaining.length) lines.push("None detected.");
remaining.forEach((x,i)=>{
  lines.push(`${i+1}. ${x.model} — reads=${x.readCalls}, rows=${x.exactRows??"n/a"}, size=${fmt(x.totalBytes)}`);
  for(const f of x.backendFiles) lines.push(`   file: ${f.file} | reads=${[...new Set(f.reads)].join(",")||"-"} | writes=${[...new Set(f.writes)].join(",")||"-"}`);
  for(const r of x.directRoutes.slice(0,12)) lines.push(`   route: ${r}`);
});
lines.push("","TOP POSTGRES TABLES BY SIZE");
if(db.connected) for(const t of db.tables.slice(0,25)) lines.push(
  `${t.tableName} — rows=${t.exactRows}, total=${fmt(t.totalBytes)}, data=${fmt(t.tableBytes)}, indexes=${fmt(t.indexBytes)}`
);
else lines.push("Unavailable.");
lines.push("","AUDIT RESULT");
lines.push(`Prisma models detected: ${models.length}`);
lines.push(`Backend source files scanned: ${sourceFiles.length}`);
lines.push(`Express routes detected: ${routes.length}`);
lines.push(`Remaining models with Supabase reads: ${remaining.length}`);
lines.push("","No database was modified.");
lines.push("No source file was modified.");
lines.push("STAGE 8A V2 AUDIT SCRIPT COMPLETED");
fs.writeFileSync(OUT_TXT,lines.join("\n"));
console.log(lines.join("\n"));
console.log(`\nSaved: ${path.basename(OUT_TXT)}`);
console.log(`Saved: ${path.basename(OUT_JSON)}`);
