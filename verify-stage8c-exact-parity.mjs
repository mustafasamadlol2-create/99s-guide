
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";

const ROOT = process.cwd();
const SNAPSHOT_FILE = path.join(ROOT, "stage8c-private-snapshot-manifest.json");
const D1_EXPORT = path.join(ROOT, "stage8c-d1-export.sql");

if (!fs.existsSync(SNAPSHOT_FILE)) {
  console.error("Missing stage8c-private-snapshot-manifest.json");
  process.exit(2);
}
if (!fs.existsSync(D1_EXPORT)) {
  console.error("Missing stage8c-d1-export.sql. Run export-stage8c-d1-remote.cmd first.");
  process.exit(2);
}

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (error) {
  console.error(`node:sqlite unavailable: ${error.message}`);
  console.error("Node 22.5+ / Node 24 is required for this verifier.");
  process.exit(2);
}

const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
const exportSql = fs.readFileSync(D1_EXPORT, "utf8");

function isBytes(v) {
  return Buffer.isBuffer(v) || v instanceof Uint8Array;
}

function bytesHex(v) {
  return Buffer.from(v).toString("hex");
}

function canonicalValue(value, sqliteType) {
  if (value === null || value === undefined) return "NULL";

  switch (sqliteType) {
    case "BLOB":
      return "B:" + bytesHex(value);
    case "INTEGER":
      return "I:" + String(value);
    case "REAL":
      return "R:" + String(value);
    case "TEXT":
    default:
      return "T:" + String(value);
  }
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

const db = new DatabaseSync(":memory:");

try {
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec(exportSql);

  console.log("99's Guide — Stage 8C Exact Snapshot Parity");
  console.log("============================================");
  console.log("");

  let allPass = true;
  let totalRows = 0;

  for (const table of snapshot.tables) {
    const rows = db.prepare(`SELECT * FROM "${table.table.replaceAll('"','""')}"`).all();
    const count = rows.length;
    const hash = hashRows(rows, table);

    const countPass = count === table.rowCount;
    const hashPass = hash === table.sha256;
    const pass = countPass && hashPass;

    console.log(
      `${pass ? "PASS" : "FAIL"}  ${table.table} | ` +
      `rows ${count}/${table.rowCount} | ` +
      `hash ${hashPass ? "MATCH" : "MISMATCH"}`
    );

    if (!pass) {
      console.log(`      expected: ${table.sha256}`);
      console.log(`      actual:   ${hash}`);
      allPass = false;
    }

    totalRows += count;
  }

  console.log("");
  console.log(`D1 snapshot rows verified: ${totalRows}`);
  console.log("Supabase snapshot was not modified.");
  console.log("Remote D1 was not modified by this verifier.");
  console.log(
    allPass
      ? "STAGE 8C EXACT PARITY PASS"
      : "STAGE 8C EXACT PARITY FAIL"
  );

  process.exitCode = allPass ? 0 : 1;
} finally {
  db.close();
}
