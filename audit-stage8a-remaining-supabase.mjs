
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const serverPath = path.join(ROOT, "server.ts");
const schemaPath = path.join(ROOT, "prisma", "schema.prisma");
const workerPath = path.join(ROOT, "cloudflare-content-api", "src", "index.ts");
const outTxt = path.join(ROOT, "stage8a-audit-report.txt");
const outJson = path.join(ROOT, "stage8a-audit-report.json");

for (const f of [serverPath, schemaPath]) {
  if (!fs.existsSync(f)) {
    console.error(`Missing required file: ${f}`);
    process.exit(2);
  }
}

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
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}
loadEnv(path.join(ROOT, ".env"));
loadEnv(path.join(ROOT, ".env.production"));

const server = fs.readFileSync(serverPath, "utf8");
const schema = fs.readFileSync(schemaPath, "utf8");
const worker = fs.existsSync(workerPath) ? fs.readFileSync(workerPath, "utf8") : "";

const sharedD1 = new Set(["Lecture","Material","Mcq","Flashcard","DailyMotto"]);
const partialD1 = new Set(["CalendarEvent"]);
const readMethods = new Set(["findMany","findUnique","findUniqueOrThrow","findFirst","findFirstOrThrow","count","aggregate","groupBy"]);
const writeMethods = new Set(["create","createMany","update","updateMany","upsert","delete","deleteMany"]);

function clientName(model) {
  return model[0].toLowerCase() + model.slice(1);
}

function parseModels(text) {
  const models = [];
  const re = /model\s+([A-Za-z0-9_]+)\s*\{[\s\S]*?\n\}/g;
  let m;
  while ((m = re.exec(text))) models.push(m[1]);
  return models;
}

function parseRoutes(text) {
  const re = /\bapp\.(get|post|put|patch|delete)\s*\(\s*([`'"])(.*?)\2/g;
  const starts = [];
  let m;
  while ((m = re.exec(text))) starts.push({ method:m[1].toUpperCase(), path:m[3], index:m.index });
  return starts.map((r,i)=>({
    ...r,
    source:text.slice(r.index, i+1 < starts.length ? starts[i+1].index : text.length)
  }));
}

function modelCalls(text, model) {
  const re = new RegExp(String.raw`\bprisma\.${clientName(model)}\.([A-Za-z0-9_]+)\s*\(`, "g");
  const calls = [];
  let m;
  while ((m = re.exec(text))) calls.push(m[1]);
  return calls;
}

function fmt(n) {
  if (n == null) return "n/a";
  const units=["B","KB","MB","GB"];
  let v=Number(n), i=0;
  while (v>=1024 && i<3){v/=1024;i++;}
  return `${v.toFixed(i?2:0)} ${units[i]}`;
}

const models = parseModels(schema);
const routes = parseRoutes(server);
const usage = {};
for (const model of models) {
  const calls = modelCalls(server, model);
  usage[model] = {
    reads:calls.filter(x=>readMethods.has(x)),
    writes:calls.filter(x=>writeMethods.has(x))
  };
}

const routeMatrix = [];
for (const route of routes) {
  const hits=[];
  for (const model of models) {
    const calls=modelCalls(route.source,model);
    if (!calls.length) continue;
    hits.push({
      model,
      reads:[...new Set(calls.filter(x=>readMethods.has(x)))],
      writes:[...new Set(calls.filter(x=>writeMethods.has(x)))]
    });
  }
  if (hits.length) routeMatrix.push({method:route.method,path:route.path,models:hits});
}

async function dbAudit() {
  const dbUrl = process.env.AUDIT_DATABASE_URL || process.env.DATABASE_URL || process.env.DIRECT_URL || "";
  if (!dbUrl) return {connected:false,reason:"No database URL available",target:null,tables:[]};

  let target=null;
  try {
    const u=new URL(dbUrl);
    target={hostname:u.hostname,database:u.pathname.replace(/^\//,"")};
  } catch {}

  process.env.DATABASE_URL=dbUrl;
  let PrismaClient;
  try {
    ({PrismaClient}=await import("@prisma/client"));
  } catch(e) {
    return {connected:false,reason:`@prisma/client unavailable: ${e.message}`,target,tables:[]};
  }

  const prisma=new PrismaClient();
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
      let exactRows=null;
      try {
        const c=await prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS "count" FROM ${quoted}`);
        exactRows=Number(c?.[0]?.count ?? 0);
      } catch {}
      tables.push({
        tableName:name,
        exactRows,
        totalBytes:Number(row.totalBytes),
        tableBytes:Number(row.tableBytes),
        indexBytes:Number(row.indexBytes)
      });
    }
    return {connected:true,reason:null,target,tables};
  } catch(e) {
    return {connected:false,reason:e instanceof Error?e.message:String(e),target,tables:[]};
  } finally {
    await prisma.$disconnect().catch(()=>{});
  }
}

const db=await dbAudit();
const dbByName=new Map(db.tables.map(x=>[x.tableName.toLowerCase(),x]));

const modelAudit=models.map(model=>{
  const u=usage[model];
  const dbRow=dbByName.get(model.toLowerCase()) || dbByName.get(clientName(model).toLowerCase()) || null;
  const routesUsing=routeMatrix.filter(r=>r.models.some(x=>x.model===model)).map(r=>`${r.method} ${r.path}`);
  let classification="not-seen-in-server";
  if (sharedD1.has(model)) classification="already-shared-d1";
  else if (partialD1.has(model)) classification="partial-d1";
  else if (u.reads.length) classification="remaining-supabase-read";
  else if (u.writes.length) classification="write-only-or-server-side";
  return {
    model,classification,
    readCalls:u.reads.length,writeCalls:u.writes.length,
    readMethods:[...new Set(u.reads)],writeMethods:[...new Set(u.writes)],
    routesUsing,
    exactRows:dbRow?.exactRows ?? null,
    totalBytes:dbRow?.totalBytes ?? null
  };
});

const remaining=modelAudit
  .filter(x=>x.classification==="remaining-supabase-read" || x.classification==="partial-d1")
  .sort((a,b)=>(b.readCalls-a.readCalls)||((b.totalBytes??0)-(a.totalBytes??0)));

const workerSignals={
  contentSync:worker.includes("/internal/content-sync"),
  lectures:worker.includes("/internal/content-read/lectures"),
  materials:worker.includes("/internal/content-read/materials-data"),
  mottos:worker.includes("/internal/content-read/mottos/active"),
  calendar:worker.includes("/internal/content-read/calendar/global"),
  search:worker.includes("/internal/content-read/search"),
  cacheFlag:worker.includes("CONTENT_SHARED_CACHE_ENABLED")
};

const report={
  generatedAt:new Date().toISOString(),
  mode:"READ_ONLY",
  db,
  workerSignals,
  totals:{
    prismaModels:models.length,
    expressRoutes:routes.length,
    routesWithPrisma:routeMatrix.length,
    remainingModelsWithSupabaseReads:remaining.length
  },
  modelAudit,
  remainingSupabaseReadCandidates:remaining,
  routeModelMatrix:routeMatrix
};

fs.writeFileSync(outJson, JSON.stringify(report,null,2));

const lines=[];
lines.push("99's Guide — Stage 8A Remaining Supabase Read Audit");
lines.push("====================================================");
lines.push(`Generated: ${report.generatedAt}`);
lines.push("Mode: READ-ONLY","");
lines.push("DATABASE");
lines.push(`Connected: ${db.connected?"YES":"NO"}`);
if (db.target) lines.push(`Target: ${db.target.hostname} / ${db.target.database}`);
if (!db.connected) lines.push(`Reason: ${db.reason}`);
lines.push("","WORKER SIGNALS");
for (const [k,v] of Object.entries(workerSignals)) lines.push(`${k}: ${v?"YES":"NO"}`);
lines.push("","MODEL SUMMARY");
lines.push("Model | Class | Reads | Writes | Rows | Size | Routes");
for (const x of modelAudit) {
  lines.push(`${x.model} | ${x.classification} | ${x.readCalls} | ${x.writeCalls} | ${x.exactRows??"n/a"} | ${fmt(x.totalBytes)} | ${x.routesUsing.length}`);
}
lines.push("","REMAINING SUPABASE READ CANDIDATES");
if (!remaining.length) lines.push("None detected.");
remaining.forEach((x,i)=>{
  lines.push(`${i+1}. ${x.model} — reads=${x.readCalls}, rows=${x.exactRows??"n/a"}, size=${fmt(x.totalBytes)}, routes=${x.routesUsing.length}`);
  for (const r of x.routesUsing.slice(0,10)) lines.push(`   - ${r}`);
});
lines.push("","TOP POSTGRES TABLES BY SIZE");
if (db.connected) for (const t of db.tables.slice(0,20)) {
  lines.push(`${t.tableName} — rows=${t.exactRows??"n/a"}, total=${fmt(t.totalBytes)}, data=${fmt(t.tableBytes)}, indexes=${fmt(t.indexBytes)}`);
}
else lines.push("Unavailable.");
lines.push("","AUDIT RESULT");
lines.push(`Prisma models detected: ${models.length}`);
lines.push(`Express routes detected: ${routes.length}`);
lines.push(`Routes with Prisma usage: ${routeMatrix.length}`);
lines.push(`Remaining models with Supabase reads: ${remaining.length}`);
lines.push("","No database was modified.");
lines.push("No source file was modified.");
lines.push("STAGE 8A AUDIT SCRIPT COMPLETED");

fs.writeFileSync(outTxt, lines.join("\n"));
console.log(lines.join("\n"));
console.log(`\nSaved: ${path.basename(outTxt)}`);
console.log(`Saved: ${path.basename(outJson)}`);
