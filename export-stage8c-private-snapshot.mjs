
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

const ROOT = process.cwd();
const MANIFEST_FILE = path.join(ROOT, "stage8b-private-d1-manifest.json");
const OUT_SQL = path.join(ROOT, "stage8c-private-snapshot.sql");
const OUT_MANIFEST = path.join(ROOT, "stage8c-private-snapshot-manifest.json");
const OUT_REPORT = path.join(ROOT, "stage8c-private-snapshot-report.txt");

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
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnv(path.join(ROOT, ".env"));
loadEnv(path.join(ROOT, ".env.production"));

if (!fs.existsSync(MANIFEST_FILE)) {
  console.error("Missing stage8b-private-d1-manifest.json. Run Stage 8B generator first.");
  process.exit(2);
}

const stage8b = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));

const dbUrl =
  process.env.AUDIT_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.DIRECT_URL ||
  "";

if (!dbUrl) {
  console.error("No AUDIT_DATABASE_URL, DATABASE_URL, or DIRECT_URL found.");
  process.exit(2);
}

process.env.DATABASE_URL = dbUrl;

let PrismaClient;
try {
  ({ PrismaClient } = await import("@prisma/client"));
} catch (error) {
  console.error(`@prisma/client unavailable: ${error.message}`);
  process.exit(2);
}

const prisma = new PrismaClient();

function qi(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function isBytes(v) {
  return Buffer.isBuffer(v) || v instanceof Uint8Array;
}

function bytesHex(v) {
  return Buffer.from(v).toString("hex");
}

function normalizeText(v) {
  if (v instanceof Date) return v.toISOString();
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    if (v?.constructor?.name === "Decimal" && typeof v.toString === "function") {
      return v.toString();
    }
    return JSON.stringify(v);
  }
  return String(v);
}

function canonicalValue(value, sqliteType) {
  if (value === null || value === undefined) return "NULL";

  switch (sqliteType) {
    case "BLOB":
      return "B:" + bytesHex(value);
    case "INTEGER":
      if (typeof value === "boolean") return value ? "I:1" : "I:0";
      return "I:" + String(value);
    case "REAL":
      return "R:" + String(value);
    case "TEXT":
    default:
      return "T:" + normalizeText(value);
  }
}

function sqlLiteral(value, sqliteType) {
  if (value === null || value === undefined) return "NULL";

  if (sqliteType === "BLOB") {
    return `X'${bytesHex(value)}'`;
  }

  if (sqliteType === "INTEGER") {
    if (typeof value === "boolean") return value ? "1" : "0";
    return String(value);
  }

  if (sqliteType === "REAL") {
    return String(value);
  }

  const text = normalizeText(value);
  return `'${String(text).replaceAll("'", "''")}'`;
}

function canonicalRow(row, tableMeta) {
  return tableMeta.columns
    .map((col) => `${col.name}=${canonicalValue(row[col.name], col.sqliteType)}`)
    .join("\u001f");
}

function hashRows(rows, tableMeta) {
  const canonical = rows
    .map((row) => canonicalRow(row, tableMeta))
    .sort()
    .join("\u001e");
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

function topoSort(tables) {
  const names = new Set(tables.map((t) => t.table));
  const deps = new Map();

  for (const t of tables) {
    deps.set(
      t.table,
      new Set(
        (t.foreignKeys || [])
          .map((fk) => fk.foreignTable)
          .filter((name) => names.has(name) && name !== t.table)
      )
    );
  }

  const ordered = [];
  const remaining = new Set(names);

  while (remaining.size) {
    const ready = [...remaining].filter((name) =>
      [...(deps.get(name) || [])].every((dep) => !remaining.has(dep))
    );

    if (!ready.length) {
      // Cycles between private mirror tables are unlikely, but D1 can create all
      // tables before data import. Fall back to deterministic alphabetical order.
      ordered.push(...[...remaining].sort());
      break;
    }

    for (const name of ready.sort()) {
      ordered.push(name);
      remaining.delete(name);
    }
  }

  return ordered;
}

function pkColumns(tableMeta) {
  const pk = (tableMeta.constraints || []).find((c) => c.type === "PRIMARY KEY");
  return pk?.columns || [];
}

function orderSql(tableMeta) {
  const pk = pkColumns(tableMeta);
  if (!pk.length) return "";
  return " ORDER BY " + pk.map(qi).join(", ");
}

const targetByName = new Map(stage8b.targetTables.map((t) => [t.table, t]));
const importOrder = topoSort(stage8b.targetTables);

const sql = [];
sql.push("-- 99's Guide — Stage 8C Private Snapshot Import");
sql.push("-- Source: current Supabase/PostgreSQL snapshot.");
sql.push("-- Target: existing EMPTY Stage 8B D1 mirror tables.");
sql.push("-- No BEGIN/COMMIT wrappers: Wrangler manages file import semantics.");
sql.push("-- Application runtime reads are NOT switched in Stage 8C.");
sql.push("");
sql.push("PRAGMA foreign_keys = ON;");
sql.push("");

const snapshot = {
  generatedAt: new Date().toISOString(),
  mode: "SNAPSHOT_COPY",
  importOrder,
  tables: [],
};

const report = [];
report.push("99's Guide — Stage 8C Private Snapshot Export");
report.push("=============================================");
report.push(`Generated: ${snapshot.generatedAt}`);
report.push(`Tables: ${importOrder.length}`);
report.push("");

let totalRows = 0;
let totalSqlBytes = 0;
let maxStatementBytes = 0;
let maxStatementLabel = "";

try {
  for (const tableName of importOrder) {
    const meta = targetByName.get(tableName);
    const rows = await prisma.$queryRawUnsafe(
      `SELECT * FROM ${qi(tableName)}${orderSql(meta)}`
    );

    const rowArray = Array.from(rows);
    const hash = hashRows(rowArray, meta);

    snapshot.tables.push({
      table: tableName,
      rowCount: rowArray.length,
      sha256: hash,
      columns: meta.columns,
    });

    report.push(`${tableName}: ${rowArray.length} rows | SHA256 ${hash}`);

    if (!rowArray.length) {
      sql.push(`-- ${tableName}: 0 rows`);
      sql.push("");
      continue;
    }

    const columnSql = meta.columns.map((c) => qi(c.name)).join(", ");

    for (const row of rowArray) {
      const values = meta.columns
        .map((col) => sqlLiteral(row[col.name], col.sqliteType))
        .join(", ");

      const stmt =
        `INSERT INTO ${qi(tableName)} (${columnSql}) VALUES (${values});`;

      const bytes = Buffer.byteLength(stmt, "utf8");
      if (bytes > maxStatementBytes) {
        maxStatementBytes = bytes;
        const pk = pkColumns(meta);
        const id =
          pk.length > 0
            ? pk.map((k) => `${k}=${normalizeText(row[k])}`).join(",")
            : "(no primary key)";
        maxStatementLabel = `${tableName} ${id}`;
      }

      // Cloudflare D1 maximum SQL statement length is 100,000 bytes.
      // Keep a safety margin so the generated import cannot hit that limit.
      if (bytes >= 95000) {
        throw new Error(
          `Generated SQL statement is ${bytes} bytes (>= 95,000 safety limit) ` +
          `for ${maxStatementLabel}. This row must be handled separately before D1 import.`
        );
      }

      sql.push(stmt);
      totalSqlBytes += bytes + 1;
      totalRows++;
    }

    sql.push("");
  }

  snapshot.totalRows = totalRows;
  snapshot.generatedSqlBytes = totalSqlBytes;
  snapshot.maxStatementBytes = maxStatementBytes;
  snapshot.maxStatementLabel = maxStatementLabel;

  fs.writeFileSync(OUT_SQL, sql.join("\n"));
  fs.writeFileSync(OUT_MANIFEST, JSON.stringify(snapshot, null, 2));

  report.push("");
  report.push(`Total snapshot rows: ${totalRows}`);
  report.push(`Generated SQL size: ${totalSqlBytes} bytes`);
  report.push(`Largest SQL statement: ${maxStatementBytes} bytes`);
  report.push(`Largest statement row: ${maxStatementLabel}`);
  report.push("");
  report.push("No Supabase row was modified.");
  report.push("No D1 row was modified by this generator.");
  report.push("STAGE 8C SNAPSHOT EXPORT PASS");

  fs.writeFileSync(OUT_REPORT, report.join("\n"));

  console.log(report.join("\n"));
  console.log("");
  console.log(`Saved: ${path.basename(OUT_SQL)}`);
  console.log(`Saved: ${path.basename(OUT_MANIFEST)}`);
  console.log(`Saved: ${path.basename(OUT_REPORT)}`);
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
