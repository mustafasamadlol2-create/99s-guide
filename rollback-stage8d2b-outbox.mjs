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
if (!dbUrl) process.exit(2);
process.env.DATABASE_URL = dbUrl;
if (!process.env.DIRECT_URL) process.env.DIRECT_URL = dbUrl;

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const tables = [
  "User","FlashcardProgress","LectureProgress","ModerationHistory","Notification",
  "PointsLog","QaAnswer","QaQuestion","QaVote","Report","SmartNotification",
  "UserBan","UserBlock","UserMute","UserProgress","CalendarEvent"
];

try {
  for (const table of tables) {
    const trigger = `private_d1_sync_${table}`;
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "${table}"`);
  }
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS private_d1_enqueue_mirror()`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "PrivateD1SyncOutbox"`);
  console.log("Stage 8D-2B outbox/triggers removed from Supabase.");
} finally {
  await prisma.$disconnect().catch(() => {});
}
