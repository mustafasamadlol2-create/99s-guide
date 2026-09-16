import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const BASE = (process.env.PRIVATE_DATA_WORKER_BASE_URL ||
  "https://99s-private-data-api.mustafasamadlol2.workers.dev").replace(/\/+$/, "");

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

const SECRET = String(process.env.PRIVATE_DATA_SYNC_SECRET || "");
const DB_URL =
  process.env.AUDIT_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.DIRECT_URL ||
  process.env.SUPABASE_DATABASE_URL ||
  "";

if (!SECRET) {
  console.error("PRIVATE_DATA_SYNC_SECRET is not set locally.");
  process.exit(2);
}
if (!DB_URL) {
  console.error("No PostgreSQL URL found.");
  process.exit(2);
}
process.env.DATABASE_URL = DB_URL;
if (!process.env.DIRECT_URL) process.env.DIRECT_URL = DB_URL;

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

function stable(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  }
  return value;
}
function canon(v) { return JSON.stringify(stable(v)); }

function assertSame(label, a, b) {
  if (canon(a) !== canon(b)) {
    console.error(`FAIL: ${label}`);
    console.error("SUPABASE:", canon(a).slice(0, 1600));
    console.error("D1:", canon(b).slice(0, 1600));
    process.exit(1);
  }
  console.log(`${label}: PASS`);
}

async function worker(pathname) {
  const res = await fetch(`${BASE}${pathname}`, {
    headers: {
      Accept: "application/json",
      "X-Private-Data-Sync-Secret": SECRET,
      "Cache-Control": "no-cache",
    },
    cache: "no-store",
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    console.error(`Worker ${pathname} HTTP ${res.status}`, body);
    process.exit(1);
  }
  return body;
}

console.log("99's Guide — Stage 8F-2 Remaining Safe Read Parity");
console.log("--------------------------------------------------");
console.log("Mode: READ-ONLY");
console.log("");

try {
  const queue = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int AS "pending",
      COUNT(*) FILTER (WHERE "lastError" IS NOT NULL)::int AS "failed"
    FROM "PrivateD1SyncOutbox"
  `);
  const pending = Number(queue?.[0]?.pending || 0);
  const failed = Number(queue?.[0]?.failed || 0);
  if (pending !== 0 || failed !== 0) {
    console.error(`FAIL: outbox pending=${pending}, failed=${failed}`);
    process.exit(1);
  }
  console.log("Write mirror outbox clean: PASS");

  const blocks = await prisma.userBlock.findMany({
    select: { blockerId: true },
    distinct: ["blockerId"],
    take: 20,
  });
  for (const sample of blocks) {
    const db = await prisma.userBlock.findMany({
      where: { blockerId: sample.blockerId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { blocked: { select: { id: true, name: true, avatar: true, avatarUrl: true } } },
    });
    const mapped = db.map(b => ({
      id: b.blocked.id,
      blockId: b.id,
      name: b.blocked.name || "Unknown",
      avatar: b.blocked.avatar || "",
      avatarUrl: b.blocked.avatarUrl || "",
      blockedAt: b.createdAt,
    }));
    const d1 = (await worker(
      `/internal/private-read/blocked-users?userId=${encodeURIComponent(sample.blockerId)}`
    )).rows;
    assertSame(`Blocked users ${sample.blockerId}`, mapped, d1);
  }

  const allUsers = await prisma.user.findMany({
    take: 1000,
    orderBy: { id: "asc" },
    include: {
      lectureProgresses: {
        orderBy: { lectureId: "asc" },
      },
    },
  });
  const roster = [];
  for (const u of allUsers) {
    const progressList = u.lectureProgresses || [];
    roster.push({
      id: u.id,
      name: u.name || "",
      email: u.email,
      profileEmail: u.profileEmail ?? null,
      role: u.role,
      isAdmin: u.role === "admin",
      isPrimaryOwner: u.isPrimaryOwner === true,
      emailVerified: u.emailVerified !== false,
      avatar: u.avatar || "",
      avatarUrl: u.avatarUrl || u.avatar || "",
      totalPoints: u.totalPoints,
      level: u.level,
      levelBadge: u.levelBadge,
      streakDays: u.streakDays,
      totalTimeSpent: u.totalTimeSpent,
      lastActive: u.lastActive,
      created_at: u.createdAt,
      completedLectCount: progressList.filter(p => p.pdfCompleted === true).length,
      completedQuizzesCount: progressList.filter(p => p.quizCompleted === true).length,
      progress: progressList.map(p => ({
        userId: p.userId,
        lectureId: p.lectureId,
        pdfCompleted: p.pdfCompleted,
        notesCompleted: p.notesCompleted,
        videoCompleted: p.videoCompleted,
        flashcardsCompleted: p.flashcardsCompleted,
        quizCompleted: p.quizCompleted,
        quizScore: p.quizScore || 0,
        lastAccessed: p.lastAccessed,
      })),
    });
  }
  roster.sort((a, b) =>
    ((b.totalPoints || 0) - (a.totalPoints || 0)) ||
    String(a.id).localeCompare(String(b.id))
  );

  const d1Roster = (await worker("/internal/private-read/admin-roster?limit=1000")).rows;
  assertSame("Admin roster contract", roster, d1Roster);

  console.log("");
  console.log("Existing Stage 8E progress/points/calendar shadow endpoints remain unchanged.");
  console.log("No Supabase row was modified.");
  console.log("No D1 row was modified.");
  console.log("STAGE 8F-2 SHADOW PARITY PASS");
} finally {
  await prisma.$disconnect().catch(() => {});
}
