import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

const ROOT = process.cwd();
const D1_EXPORT = path.join(ROOT, "stage8d2b-d1-export.sql");
const META = {"User": {"sourceTable": "User", "targetEntity": "User", "primaryKey": ["id"], "columns": [{"name": "id", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "email", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "name", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "avatar", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "avatarUrl", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "role", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "isOnline", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}, {"name": "lastActive", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}, {"name": "lastSeen", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}, {"name": "accountStatus", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "createdAt", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}, {"name": "updatedAt", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}, {"name": "studentGroup", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "totalPoints", "sqliteType": "INTEGER", "postgresType": "integer", "nullable": false}, {"name": "level", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "levelBadge", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "streakDays", "sqliteType": "INTEGER", "postgresType": "integer", "nullable": false}, {"name": "totalTimeSpent", "sqliteType": "INTEGER", "postgresType": "integer", "nullable": false}, {"name": "preferences", "sqliteType": "TEXT", "postgresType": "jsonb", "nullable": true}, {"name": "sessionVersion", "sqliteType": "INTEGER", "postgresType": "integer", "nullable": false}, {"name": "isPrimaryOwner", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}, {"name": "emailVerified", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}, {"name": "profileEmail", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}]}, "FlashcardProgress": {"sourceTable": "FlashcardProgress", "targetEntity": "FlashcardProgress", "primaryKey": ["id"], "columns": [{"name": "id", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "userId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "flashcardId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "status", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "updatedAt", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}]}, "LectureProgress": {"sourceTable": "LectureProgress", "targetEntity": "LectureProgress", "primaryKey": ["userId", "lectureId"], "columns": [{"name": "userId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "lectureId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "pdfCompleted", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}, {"name": "notesCompleted", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}, {"name": "videoCompleted", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}, {"name": "flashcardsCompleted", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}, {"name": "quizCompleted", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}, {"name": "quizScore", "sqliteType": "INTEGER", "postgresType": "integer", "nullable": true}, {"name": "lastAccessed", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}]}, "ModerationHistory": {"sourceTable": "ModerationHistory", "targetEntity": "ModerationHistory", "primaryKey": ["id"], "columns": [{"name": "id", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "actionType", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "adminId", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "targetUserId", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "commentId", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "questionId", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "answerId", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "replyId", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "lectureId", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "reportId", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "reason", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "notes", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "oldStatus", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "newStatus", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "duration", "sqliteType": "INTEGER", "postgresType": "integer", "nullable": true}, {"name": "isPermanent", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}, {"name": "isSystemAction", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}, {"name": "createdAt", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}, {"name": "expiresAt", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": true}, {"name": "revokedAt", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": true}, {"name": "revokedBy", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "metadata", "sqliteType": "TEXT", "postgresType": "jsonb", "nullable": true}]}, "Notification": {"sourceTable": "Notification", "targetEntity": "Notification", "primaryKey": ["id"], "columns": [{"name": "id", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "title", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "message", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "isSystem", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}, {"name": "targetUserId", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "createdAt", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}, {"name": "targetGroup", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}]}, "PointsLog": {"sourceTable": "PointsLog", "targetEntity": "PointsLog", "primaryKey": ["id"], "columns": [{"name": "id", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "userId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "points", "sqliteType": "INTEGER", "postgresType": "integer", "nullable": false}, {"name": "reason", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "createdAt", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}]}, "QaAnswer": {"sourceTable": "QaAnswer", "targetEntity": "QaAnswer", "primaryKey": ["id"], "columns": [{"name": "id", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "questionId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "userId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "content", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "upvotes", "sqliteType": "INTEGER", "postgresType": "integer", "nullable": false}, {"name": "isBest", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}, {"name": "isDeleted", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}, {"name": "createdAt", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}, {"name": "updatedAt", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}]}, "QaQuestion": {"sourceTable": "QaQuestion", "targetEntity": "QaQuestion", "primaryKey": ["id"], "columns": [{"name": "id", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "lectureId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "userId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "content", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "upvotes", "sqliteType": "INTEGER", "postgresType": "integer", "nullable": false}, {"name": "isDeleted", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}, {"name": "createdAt", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}, {"name": "updatedAt", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}]}, "QaVote": {"sourceTable": "QaVote", "targetEntity": "QaVote", "primaryKey": ["id"], "columns": [{"name": "id", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "userId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "targetId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "targetType", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "value", "sqliteType": "INTEGER", "postgresType": "integer", "nullable": false}, {"name": "createdAt", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}]}, "Report": {"sourceTable": "Report", "targetEntity": "Report", "primaryKey": ["id"], "columns": [{"name": "id", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "reporterId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "reportedUserId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "lectureId", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "commentId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "commentType", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "commentContent", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "reason", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "description", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "status", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "createdAt", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}]}, "SmartNotification": {"sourceTable": "SmartNotification", "targetEntity": "SmartNotification", "primaryKey": ["id"], "columns": [{"name": "id", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "title", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "body", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "type", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "sentAt", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}, {"name": "read", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}]}, "UserBan": {"sourceTable": "UserBan", "targetEntity": "UserBan", "primaryKey": ["id"], "columns": [{"name": "id", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "userId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "reason", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "startTime", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}, {"name": "endTime", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": true}, {"name": "isPermanent", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}, {"name": "createdBy", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "createdAt", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}]}, "UserBlock": {"sourceTable": "UserBlock", "targetEntity": "UserBlock", "primaryKey": ["id"], "columns": [{"name": "id", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "blockerId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "blockedId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "createdAt", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}]}, "UserMute": {"sourceTable": "UserMute", "targetEntity": "UserMute", "primaryKey": ["id"], "columns": [{"name": "id", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "userId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "reason", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "startTime", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}, {"name": "endTime", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": true}, {"name": "isPermanent", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}, {"name": "createdBy", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "createdAt", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}]}, "UserProgress": {"sourceTable": "UserProgress", "targetEntity": "UserProgress", "primaryKey": ["id"], "columns": [{"name": "id", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "userId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "materialId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "hasViewed", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}, {"name": "isCompleted", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}, {"name": "createdAt", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}, {"name": "updatedAt", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}]}, "UserCalendarEvent": {"sourceTable": "CalendarEvent", "targetEntity": "UserCalendarEvent", "primaryKey": ["id"], "columns": [{"name": "id", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "userId", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "title", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "eventType", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "startDateTime", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}, {"name": "endDateTime", "sqliteType": "TEXT", "postgresType": "timestamp without time zone", "nullable": false}, {"name": "targetGroups", "sqliteType": "TEXT", "postgresType": "text", "nullable": false}, {"name": "description", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "subjectId", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "lectureId", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "room", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "doctor", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "notes", "sqliteType": "TEXT", "postgresType": "text", "nullable": true}, {"name": "isPinned", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}, {"name": "isCompleted", "sqliteType": "INTEGER", "postgresType": "boolean", "nullable": false}]}};

if (!fs.existsSync(D1_EXPORT)) {
  console.error("Missing stage8d2b-d1-export.sql. Run export-stage8d2b-d1-remote.cmd first.");
  process.exit(2);
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

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (error) {
  console.error("node:sqlite is unavailable. Node 24 is supported.");
  process.exit(2);
}

function q(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + stableJson(value[k])).join(",") + "}";
}

function normalizeDate(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(text);
  const d = new Date(hasZone ? text : `${text}Z`);
  return Number.isNaN(d.getTime()) ? text : d.toISOString();
}

function canonical(value, column) {
  if (value === null || value === undefined) return "NULL";
  if (column.postgresType.includes("timestamp") || column.postgresType === "date") {
    return "D:" + normalizeDate(value);
  }
  if (column.postgresType === "json" || column.postgresType === "jsonb") {
    let obj = value;
    if (typeof value === "string") {
      try { obj = JSON.parse(value); } catch { return "J:" + value; }
    }
    return "J:" + stableJson(obj);
  }
  if (column.sqliteType === "INTEGER") {
    if (typeof value === "boolean") return value ? "I:1" : "I:0";
    return "I:" + String(Number(value));
  }
  if (column.sqliteType === "REAL") return "R:" + String(Number(value));
  return "T:" + String(value);
}

function rowHash(rows, meta) {
  const values = rows.map(row =>
    meta.columns.map(col => `${col.name}=${canonical(row[col.name], col)}`).join("\u001f")
  ).sort().join("\u001e");
  return crypto.createHash("sha256").update(values, "utf8").digest("hex");
}

function prismaDelegate(model) {
  return prisma[model.charAt(0).toLowerCase() + model.slice(1)];
}

const d1 = new DatabaseSync(":memory:");
try {
  d1.exec("PRAGMA foreign_keys = OFF;");
  d1.exec(fs.readFileSync(D1_EXPORT, "utf8"));

  console.log("99's Guide — Stage 8D-2B Live Mirror Parity");
  console.log("-------------------------------------------");
  console.log("Mode: READ-ONLY verification");
  console.log("");

  let pass = true;

  for (const [entity, meta] of Object.entries(META)) {
    let sourceRows;
    if (entity === "UserCalendarEvent") {
      sourceRows = await prisma.calendarEvent.findMany({
        where: { userId: { not: null } },
        select: Object.fromEntries(meta.columns.map(c => [c.name, true])),
      });
    } else {
      const delegate = prismaDelegate(meta.sourceTable);
      sourceRows = await delegate.findMany({
        select: Object.fromEntries(meta.columns.map(c => [c.name, true])),
      });
    }

    const d1Rows = d1.prepare(
      `SELECT ${meta.columns.map(c => q(c.name)).join(", ")} FROM ${q(entity)}`
    ).all();

    const sourceHash = rowHash(sourceRows, meta);
    const d1Hash = rowHash(d1Rows, meta);
    const ok = sourceRows.length === d1Rows.length && sourceHash === d1Hash;

    console.log(
      `${ok ? "PASS" : "FAIL"}  ${entity} | ` +
      `rows ${d1Rows.length}/${sourceRows.length} | ` +
      `hash ${sourceHash === d1Hash ? "MATCH" : "MISMATCH"}`
    );

    if (!ok) pass = false;
  }

  console.log("");
  console.log("Sensitive auth/token tables are intentionally excluded from this parity set.");
  console.log("No Supabase row was modified.");
  console.log("No D1 row was modified.");
  console.log(pass ? "STAGE 8D-2B LIVE MIRROR PARITY PASS" : "STAGE 8D-2B LIVE MIRROR PARITY FAIL");
  process.exitCode = pass ? 0 : 1;
} finally {
  d1.close();
  await prisma.$disconnect().catch(() => {});
}
