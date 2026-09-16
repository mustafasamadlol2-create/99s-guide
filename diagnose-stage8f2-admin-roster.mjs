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

function iso(v) {
  if (v === null || v === undefined) return v;
  if (v instanceof Date) return v.toISOString();
  return v;
}

function normalizedUser(u) {
  return {
    id: u.id,
    name: u.name || "",
    email: u.email,
    profileEmail: u.profileEmail ?? null,
    role: u.role,
    isAdmin: u.role === "admin",
    isPrimaryOwner: !!u.isPrimaryOwner,
    emailVerified: u.emailVerified !== false,
    avatar: u.avatar || "",
    avatarUrl: u.avatarUrl || u.avatar || "",
    totalPoints: Number(u.totalPoints || 0),
    level: u.level,
    levelBadge: u.levelBadge,
    streakDays: Number(u.streakDays || 0),
    totalTimeSpent: Number(u.totalTimeSpent || 0),
    lastActive: iso(u.lastActive),
    created_at: iso(u.createdAt ?? u.created_at),
    completedLectCount: Number(u.completedLectCount || 0),
    completedQuizzesCount: Number(u.completedQuizzesCount || 0),
    progress: (u.progress || []).map(p => ({
      userId: p.userId,
      lectureId: p.lectureId,
      pdfCompleted: !!p.pdfCompleted,
      notesCompleted: !!p.notesCompleted,
      videoCompleted: !!p.videoCompleted,
      flashcardsCompleted: !!p.flashcardsCompleted,
      quizCompleted: !!p.quizCompleted,
      quizScore: Number(p.quizScore || 0),
      lastAccessed: iso(p.lastAccessed),
    })),
  };
}

function samePrimitive(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
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
    console.error(`Worker request failed HTTP ${res.status}.`);
    process.exit(1);
  }
  return body;
}

console.log("99's Guide — Stage 8F-2 Admin Roster Diagnostic");
console.log("------------------------------------------------");
console.log("Mode: READ-ONLY / SAFE DIAGNOSTIC");
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
  console.log(`Outbox pending=${pending}, failed=${failed}`);
  if (pending !== 0 || failed !== 0) {
    console.log("DIAGNOSIS: mirror not clean. Stop here.");
    process.exit(1);
  }

  const allUsers = await prisma.user.findMany({
    take: 1000,
    include: { lectureProgresses: true },
  });

  const supabase = allUsers.map(u => {
    const progress = u.lectureProgresses || [];
    return normalizedUser({
      ...u,
      completedLectCount: progress.filter(p => p.pdfCompleted === true).length,
      completedQuizzesCount: progress.filter(p => p.quizCompleted === true).length,
      progress,
    });
  });

  const d1Raw = (await worker("/internal/private-read/admin-roster?limit=1000")).rows || [];
  const d1 = d1Raw.map(normalizedUser);

  console.log(`Supabase rows=${supabase.length}`);
  console.log(`D1 rows=${d1.length}`);

  const sIds = supabase.map(r => r.id);
  const dIds = d1.map(r => r.id);

  const sSet = new Set(sIds);
  const dSet = new Set(dIds);
  const onlyS = sIds.filter(id => !dSet.has(id));
  const onlyD = dIds.filter(id => !sSet.has(id));

  console.log(`Only in Supabase=${onlyS.length}`);
  console.log(`Only in D1=${onlyD.length}`);

  if (onlyS.length || onlyD.length) {
    console.log("DIAGNOSIS: ROW_SET_MISMATCH");
    console.log("Sample only-Supabase IDs:", onlyS.slice(0, 10));
    console.log("Sample only-D1 IDs:", onlyD.slice(0, 10));
    process.exit(1);
  }

  // Compare by ID, ignoring top-level ordering.
  const dById = new Map(d1.map(r => [r.id, r]));
  let fieldMismatch = null;
  let nestedOrderOnly = false;

  for (const s of supabase) {
    const d = dById.get(s.id);
    if (!d) continue;

    for (const key of Object.keys(s)) {
      if (key === "progress") continue;
      if (!samePrimitive(s[key], d[key])) {
        fieldMismatch = {
          userId: s.id,
          field: key,
          supabaseValue: s[key],
          d1Value: d[key],
        };
        break;
      }
    }
    if (fieldMismatch) break;

    const sProgressByLecture = new Map(s.progress.map(p => [p.lectureId, p]));
    const dProgressByLecture = new Map(d.progress.map(p => [p.lectureId, p]));

    if (sProgressByLecture.size !== dProgressByLecture.size) {
      fieldMismatch = {
        userId: s.id,
        field: "progress.length",
        supabaseValue: sProgressByLecture.size,
        d1Value: dProgressByLecture.size,
      };
      break;
    }

    for (const [lectureId, sp] of sProgressByLecture) {
      const dp = dProgressByLecture.get(lectureId);
      if (!dp) {
        fieldMismatch = {
          userId: s.id,
          field: `progress.missing.${lectureId}`,
          supabaseValue: "present",
          d1Value: "missing",
        };
        break;
      }
      for (const key of Object.keys(sp)) {
        if (!samePrimitive(sp[key], dp[key])) {
          fieldMismatch = {
            userId: s.id,
            field: `progress.${lectureId}.${key}`,
            supabaseValue: sp[key],
            d1Value: dp[key],
          };
          break;
        }
      }
      if (fieldMismatch) break;
    }
    if (fieldMismatch) break;

    const sOrder = s.progress.map(p => p.lectureId);
    const dOrder = d.progress.map(p => p.lectureId);
    if (!samePrimitive(sOrder, dOrder)) nestedOrderOnly = true;
  }

  if (fieldMismatch) {
    console.log("DIAGNOSIS: VALUE_MISMATCH");
    console.log(JSON.stringify(fieldMismatch, null, 2));
    process.exit(1);
  }

  const topLevelOrderOnly = !samePrimitive(sIds, dIds);

  if (topLevelOrderOnly || nestedOrderOnly) {
    console.log("DIAGNOSIS: ORDER_ONLY_MISMATCH");
    console.log(`Top-level user order differs: ${topLevelOrderOnly ? "YES" : "NO"}`);
    console.log(`Nested progress order differs: ${nestedOrderOnly ? "YES" : "NO"}`);
    console.log("All compared row values match by user ID and lecture ID.");
    console.log("STAGE 8F-2 DIAGNOSTIC PASS — ORDER ONLY");
    process.exit(0);
  }

  console.log("DIAGNOSIS: NO_DATA_MISMATCH");
  console.log("Rows, values, and ordering all match.");
  console.log("STAGE 8F-2 DIAGNOSTIC PASS — EXACT");
} finally {
  await prisma.$disconnect().catch(() => {});
}
