import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();

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

const dbUrl =
  process.env.AUDIT_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.DIRECT_URL ||
  process.env.SUPABASE_DATABASE_URL ||
  "";
if (!dbUrl) {
  console.error("No PostgreSQL URL found.");
  process.exit(2);
}
process.env.DATABASE_URL = dbUrl;
if (!process.env.DIRECT_URL) process.env.DIRECT_URL = dbUrl;

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

try {
  console.log("99's Guide — Stage 8D-2B Outbox Verification");
  console.log("-------------------------------------------");
  console.log("Mode: READ-ONLY");
  console.log("");

  const triggerRows = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS count
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname LIKE 'private_d1_sync_%'
  `);
  const pendingRows = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS count
    FROM "PrivateD1SyncOutbox"
  `);
  const failedRows = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS count
    FROM "PrivateD1SyncOutbox"
    WHERE "lastError" IS NOT NULL
  `);

  const triggers = Number(triggerRows?.[0]?.count || 0);
  const pending = Number(pendingRows?.[0]?.count || 0);
  const failed = Number(failedRows?.[0]?.count || 0);

  console.log(`Private mirror triggers: ${triggers} (expected 16)`);
  console.log(`Pending outbox rows: ${pending} (expected 0 after drain)`);
  console.log(`Rows with lastError: ${failed} (expected 0)`);

  const pass = triggers === 16 && pending === 0 && failed === 0;
  console.log("");
  console.log("No Supabase row was modified.");
  console.log("No D1 row was modified.");
  console.log(pass ? "STAGE 8D-2B OUTBOX DRAIN PASS" : "STAGE 8D-2B OUTBOX DRAIN NOT READY");
  process.exitCode = pass ? 0 : 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
