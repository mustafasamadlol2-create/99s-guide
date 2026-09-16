import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

const ROOT = process.cwd();
const BASE = (process.env.PRIVATE_DATA_WORKER_BASE_URL ||
  "https://99s-private-data-api.mustafasamadlol2.workers.dev").replace(/\/+$/, "");
const SECRET = String(process.env.PRIVATE_DATA_SYNC_SECRET || "");

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

const DB_URL =
  process.env.AUDIT_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.DIRECT_URL ||
  process.env.SUPABASE_DATABASE_URL ||
  "";

if (!SECRET) {
  console.error("PRIVATE_DATA_SYNC_SECRET is not set in this CMD session.");
  console.error("Set it locally only. Do NOT send it to ChatGPT.");
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

function canon(value) {
  return JSON.stringify(stable(value));
}

function assertSame(label, a, b) {
  if (canon(a) !== canon(b)) {
    console.error(`FAIL: ${label}`);
    console.error("SUPABASE:", canon(a).slice(0, 1500));
    console.error("D1:", canon(b).slice(0, 1500));
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
    console.error(`Worker ${pathname} failed HTTP ${res.status}`, body);
    process.exit(1);
  }
  return body;
}

function mapUserSafe(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    profileEmail: u.profileEmail ?? null,
    role: u.role,
    sessionVersion: u.sessionVersion,
    name: u.name,
    avatar: u.avatar,
    avatarUrl: u.avatarUrl,
    totalPoints: u.totalPoints,
    level: u.level,
    levelBadge: u.levelBadge,
    streakDays: u.streakDays,
    totalTimeSpent: u.totalTimeSpent,
    lastActive: u.lastActive,
    createdAt: u.createdAt,
    accountStatus: u.accountStatus,
    isOnline: u.isOnline,
    studentGroup: u.studentGroup,
    isPrimaryOwner: u.isPrimaryOwner,
    emailVerified: u.emailVerified,
  };
}

function sortByKey(rows, key) {
  return [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
}

console.log("99's Guide — Stage 8E Private Shadow Read Verification");
console.log("-------------------------------------------------------");
console.log(`Worker: ${BASE}`);
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
    console.error(`FAIL: outbox is not clean (pending=${pending}, failed=${failed}).`);
    process.exit(1);
  }
  console.log("Write mirror outbox clean: PASS");

  const unauth = await fetch(`${BASE}/internal/private-read/users`);
  if (unauth.status !== 401) {
    console.error(`FAIL: private read gate returned ${unauth.status}, expected 401.`);
    process.exit(1);
  }
  console.log("Unauthorized private read gate: PASS (401)");

  const dbUsers = await prisma.user.findMany({
    take: 2000,
    orderBy: [{ isOnline: "desc" }, { name: "asc" }, { id: "asc" }],
    select: {
      id: true, email: true, name: true, avatar: true, avatarUrl: true,
      role: true, isPrimaryOwner: true, isOnline: true, lastSeen: true,
      createdAt: true, updatedAt: true, studentGroup: true, accountStatus: true,
    },
  });
  const d1Users = (await worker("/internal/private-read/users?limit=2000")).rows;
  assertSame("Users list contract", dbUsers, d1Users);

  const activityIdsRaw = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT "userId" FROM (
      SELECT "userId" FROM "LectureProgress"
      UNION ALL SELECT "userId" FROM "FlashcardProgress"
      UNION ALL SELECT "userId" FROM "PointsLog"
      UNION ALL SELECT "userId" FROM "UserProgress"
      UNION ALL SELECT "userId" FROM "CalendarEvent" WHERE "userId" IS NOT NULL
    ) x
    WHERE "userId" IS NOT NULL
    LIMIT 20
  `);
  const samples = [...new Set([
    ...activityIdsRaw.map(r => String(r.userId)),
    ...dbUsers.slice(0, 5).map(u => u.id),
  ])].slice(0, 20);

  for (const userId of samples) {
    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, profileEmail: true, role: true, sessionVersion: true,
        name: true, avatar: true, avatarUrl: true, totalPoints: true, level: true,
        levelBadge: true, streakDays: true, totalTimeSpent: true, lastActive: true,
        createdAt: true, accountStatus: true, isOnline: true, studentGroup: true,
        isPrimaryOwner: true, emailVerified: true,
      },
    });
    const d1User = (await worker(`/internal/private-read/auth-user?id=${encodeURIComponent(userId)}`)).row;
    assertSame(`Auth user ${userId}`, mapUserSafe(dbUser), d1User);

    const dbLecture = await prisma.lectureProgress.findMany({ where: { userId }, take: 2000 });
    const d1Lecture = (await worker(`/internal/private-read/lecture-progress?userId=${encodeURIComponent(userId)}`)).rows;
    assertSame(`LectureProgress ${userId}`, sortByKey(dbLecture, "lectureId"), sortByKey(d1Lecture, "lectureId"));

    const dbFlash = await prisma.flashcardProgress.findMany({ where: { userId } });
    const d1Flash = (await worker(`/internal/private-read/flashcard-progress?userId=${encodeURIComponent(userId)}`)).rows;
    assertSame(`FlashcardProgress ${userId}`, sortByKey(dbFlash, "id"), sortByKey(d1Flash, "id"));

    const dbPoints = await prisma.pointsLog.findMany({
      where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50,
    });
    const d1Points = (await worker(`/internal/private-read/points-logs?userId=${encodeURIComponent(userId)}&limit=50`)).rows;
    assertSame(`PointsLog ${userId}`, dbPoints, d1Points);

    const dbCalendar = await prisma.calendarEvent.findMany({ where: { userId }, take: 2000 });
    const d1Calendar = (await worker(`/internal/private-read/personal-calendar?userId=${encodeURIComponent(userId)}`)).rows;
    assertSame(`Personal calendar ${userId}`, sortByKey(dbCalendar, "id"), sortByKey(d1Calendar, "id"));

    const group = dbUser?.studentGroup || "";
    const dbNotifications = await prisma.notification.findMany({
      take: 50,
      where: {
        AND: [
          { OR: [{ targetUserId: null }, { targetUserId: userId }] },
          { OR: [{ targetGroup: null }, ...(group ? [{ targetGroup: group }] : [])] },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const d1Notifications = (await worker(
      `/internal/private-read/notifications?userId=${encodeURIComponent(userId)}${group ? `&group=${encodeURIComponent(group)}` : ""}`
    )).rows;
    assertSame(`Notifications ${userId}`, dbNotifications, d1Notifications);

    const dbBan = await prisma.userBan.findUnique({ where: { userId } });
    const d1Ban = (await worker(`/internal/private-read/ban?userId=${encodeURIComponent(userId)}`)).row;
    assertSame(`UserBan ${userId}`, dbBan, d1Ban);

    const dbMute = await prisma.userMute.findUnique({ where: { userId } });
    const d1Mute = (await worker(`/internal/private-read/mute?userId=${encodeURIComponent(userId)}`)).row;
    assertSame(`UserMute ${userId}`, dbMute, d1Mute);
  }

  const userProgressRows = await prisma.userProgress.findMany({ take: 20 });
  for (const row of userProgressRows) {
    const d1 = (await worker(
      `/internal/private-read/material-progress?userId=${encodeURIComponent(row.userId)}&materialId=${encodeURIComponent(row.materialId)}`
    )).row;
    assertSame(`UserProgress ${row.id}`, row, d1);
  }

  const lectureRows = await prisma.qaQuestion.findMany({
    where: { isDeleted: false },
    select: { lectureId: true },
    distinct: ["lectureId"],
    take: 20,
  });
  const callerId = samples[0] || dbUsers[0]?.id;
  if (callerId) {
    for (const { lectureId } of lectureRows) {
      const blocks = await prisma.userBlock.findMany({
        where: { blockerId: callerId },
        select: { blockedId: true },
      });
      const blocked = new Set(blocks.map(b => b.blockedId));
      const questions = await prisma.qaQuestion.findMany({
        where: { lectureId, isDeleted: false },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          user: { select: { id: true, name: true, avatar: true, avatarUrl: true } },
          answers: {
            where: { isDeleted: false },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 200,
            include: {
              user: { select: { id: true, name: true, avatar: true, avatarUrl: true } },
            },
          },
        },
      });
      const mapped = questions.map(q => ({
        id: q.id,
        lectureId: q.lectureId,
        user_id: q.userId,
        userName: q.user?.name || "Unknown",
        userAvatar: q.user?.avatarUrl || q.user?.avatar || "",
        content: q.content,
        createdAt: q.createdAt,
        upvotes: q.upvotes,
        isBlocked: blocked.has(q.userId),
        answers: q.answers.map(a => ({
          id: a.id,
          questionId: a.questionId,
          userId: a.userId,
          userName: a.user?.name || "Unknown",
          userAvatar: a.user?.avatarUrl || a.user?.avatar || "",
          content: a.content,
          createdAt: a.createdAt,
          upvotes: a.upvotes,
          isBest: a.isBest,
          isBlocked: blocked.has(a.userId),
        })),
      }));
      const d1 = (await worker(
        `/internal/private-read/qa?lectureId=${encodeURIComponent(lectureId)}&callerId=${encodeURIComponent(callerId)}`
      )).rows;
      assertSame(`Q&A lecture ${lectureId}`, mapped, d1);
    }
  }

  if (dbUsers[0]?.email) {
    const byEmail = (await worker(
      `/internal/private-read/auth-user?email=${encodeURIComponent(dbUsers[0].email)}`
    )).row;
    const dbByEmail = await prisma.user.findUnique({
      where: { email: dbUsers[0].email },
      select: {
        id: true, email: true, profileEmail: true, role: true, sessionVersion: true,
        name: true, avatar: true, avatarUrl: true, totalPoints: true, level: true,
        levelBadge: true, streakDays: true, totalTimeSpent: true, lastActive: true,
        createdAt: true, accountStatus: true, isOnline: true, studentGroup: true,
        isPrimaryOwner: true, emailVerified: true,
      },
    });
    assertSame("Auth user lookup by email", mapUserSafe(dbByEmail), byEmail);
  }

  console.log("");
  console.log("No production Render read path was changed.");
  console.log("No Supabase row was modified.");
  console.log("No D1 row was modified.");
  console.log("STAGE 8E SHADOW READS PASS");
} finally {
  await prisma.$disconnect().catch(() => {});
}
