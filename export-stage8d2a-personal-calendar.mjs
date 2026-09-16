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
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnv(path.join(ROOT, ".env"));
loadEnv(path.join(ROOT, ".env.production"));

const dbUrl =
  process.env.AUDIT_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.DIRECT_URL ||
  "";

if (!dbUrl) {
  console.error("No database URL found.");
  process.exit(2);
}
process.env.DATABASE_URL = dbUrl;

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

function text(v) {
  if (v === null || v === undefined) return "NULL";
  const value = v instanceof Date ? v.toISOString() : String(v);
  return `'${value.replaceAll("'", "''")}'`;
}
function bool(v) { return v ? "1" : "0"; }

try {
  const rows = await prisma.calendarEvent.findMany({
    where: { userId: { not: null } },
    orderBy: { id: "asc" },
  });

  const sql = [
    "-- Stage 8D-2A personal calendar backfill",
    "PRAGMA foreign_keys = ON;",
    'DELETE FROM "UserCalendarEvent";',
    "",
  ];

  for (const r of rows) {
    sql.push(
      `INSERT INTO "UserCalendarEvent" (` +
      `"id","userId","title","eventType","startDateTime","endDateTime","targetGroups",` +
      `"description","subjectId","lectureId","room","doctor","notes","isPinned","isCompleted"` +
      `) VALUES (` +
      [
        text(r.id), text(r.userId), text(r.title), text(r.eventType),
        text(r.startDateTime), text(r.endDateTime), text(r.targetGroups),
        text(r.description), text(r.subjectId), text(r.lectureId), text(r.room),
        text(r.doctor), text(r.notes), bool(r.isPinned), bool(r.isCompleted),
      ].join(",") +
      `);`
    );
  }

  fs.writeFileSync("stage8d2a-personal-calendar-backfill.sql", sql.join("\n"));

  const verify = [
    "-- Stage 8D-2A verification",
    `SELECT COUNT(*) AS personalCalendarRows, CASE WHEN COUNT(*)=${rows.length} THEN 'PASS' ELSE 'FAIL' END AS status FROM "UserCalendarEvent";`,
    `SELECT COUNT(*) AS passwordResetRows FROM "PasswordResetToken";`,
    `SELECT COUNT(*) AS emailVerificationRows FROM "EmailVerificationToken";`,
    `SELECT COUNT(*) AS oauthIdentityRows FROM "OAuthIdentity";`,
    `SELECT COUNT(*) AS sensitiveUserRows FROM "User" WHERE "passwordHash" IS NOT NULL OR "socketId" IS NOT NULL OR "deviceToken" IS NOT NULL OR "signature" IS NOT NULL;`,
  ];
  fs.writeFileSync("stage8d2a-d1-verify.sql", verify.join("\n"));

  console.log("99's Guide — Stage 8D-2A Personal Calendar Snapshot");
  console.log("---------------------------------------------------");
  console.log(`Personal CalendarEvent rows in Supabase: ${rows.length}`);
  console.log("Saved: stage8d2a-personal-calendar-backfill.sql");
  console.log("Saved: stage8d2a-d1-verify.sql");
  console.log("No Supabase row was modified.");
  console.log("STAGE 8D-2A PERSONAL CALENDAR EXPORT PASS");
} finally {
  await prisma.$disconnect().catch(() => {});
}
