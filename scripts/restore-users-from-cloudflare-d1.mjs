import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const CONFIRM_VALUE = "RESTORE_USERS_FROM_D1";
const PAGE_SIZE = 500;

function env(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function resolveD1DatabaseId() {
  const direct = String(process.env.CLOUDFLARE_D1_DATABASE_ID || "").trim();
  if (direct) return direct;

  for (const candidate of [
    path.resolve("cloudflare-private-data-api/wrangler.jsonc"),
    path.resolve("cloudflare-content-api/wrangler.jsonc"),
  ]) {
    try {
      const text = await fs.readFile(candidate, "utf8");
      const match = text.match(/"database_id"\s*:\s*"([^"]+)"/);
      if (match?.[1]) return match[1];
    } catch {
      // Try the next config.
    }
  }

  throw new Error(
    "CLOUDFLARE_D1_DATABASE_ID is required (or database_id must exist in a Worker wrangler config).",
  );
}

const accountId = env("CLOUDFLARE_ACCOUNT_ID");
const apiToken = env("CLOUDFLARE_API_TOKEN");
const databaseId = await resolveD1DatabaseId();

if (
  APPLY &&
  String(process.env.CLOUDFLARE_USER_RESTORE_CONFIRM || "").trim() !== CONFIRM_VALUE
) {
  throw new Error(
    `Refusing apply. Set CLOUDFLARE_USER_RESTORE_CONFIRM=${CONFIRM_VALUE} first.`,
  );
}

async function d1Query(sql, params = []) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    },
  );

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.success) {
    const message = Array.isArray(payload?.errors)
      ? payload.errors.map((entry) => entry?.message).filter(Boolean).join("; ")
      : `HTTP ${response.status}`;
    throw new Error(`Cloudflare D1 query failed: ${message || "unknown error"}`);
  }

  const first = Array.isArray(payload.result) ? payload.result[0] : null;
  if (first?.success === false) {
    throw new Error(`Cloudflare D1 query failed: ${first?.error || "unknown error"}`);
  }

  return Array.isArray(first?.results) ? first.results : [];
}

async function readAllD1Users() {
  const users = [];
  let offset = 0;

  while (true) {
    const rows = await d1Query(
      `SELECT
        "id",
        "email",
        "profileEmail",
        "name",
        "avatar",
        "avatarUrl",
        "role",
        "isOnline",
        "lastActive",
        "lastSeen",
        "accountStatus",
        "createdAt",
        "updatedAt",
        "studentGroup",
        "totalPoints",
        "level",
        "levelBadge",
        "streakDays",
        "totalTimeSpent",
        "preferences",
        "sessionVersion",
        "isPrimaryOwner",
        "emailVerified"
       FROM "User"
       ORDER BY "createdAt" ASC, "id" ASC
       LIMIT ? OFFSET ?`,
      [PAGE_SIZE, offset],
    );

    users.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += rows.length;
  }

  return users;
}

function bool(value, fallback = false) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes"].includes(text)) return true;
  if (["0", "false", "no"].includes(text)) return false;
  return fallback;
}

function int(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function date(value, fallback = new Date()) {
  if (!value) return fallback;
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

function json(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRole(value) {
  const role = String(value || "user").trim().toLowerCase();
  if (role === "owner" || role === "admin") return role;
  return "user";
}

function normalizeAccountStatus(value) {
  const status = String(value || "ACTIVE").trim().toUpperCase();
  if (["ACTIVE", "BANNED", "PENDING", "PENDING_PROFILE"].includes(status)) {
    return status;
  }
  return "ACTIVE";
}

function restoredData(row, existingUser = null) {
  const d1Version = int(row.sessionVersion, 0);
  const currentVersion =
    existingUser?.sessionVersion === null || existingUser?.sessionVersion === undefined
      ? 0
      : int(existingUser.sessionVersion, 0);

  // Force every restored account to obtain a fresh OAuth session.
  const sessionVersion = Math.max(d1Version, currentVersion) + 1;

  return {
    email: normalizeEmail(row.email),
    profileEmail: row.profileEmail ? normalizeEmail(row.profileEmail) : null,
    passwordHash: null,
    name: row.name == null ? null : String(row.name),
    avatar: row.avatar == null ? "" : String(row.avatar),
    avatarUrl: row.avatarUrl == null ? "" : String(row.avatarUrl),
    signature: "",
    role: existingUser?.isPrimaryOwner ? "owner" : normalizeRole(row.role),

    // Never restore stale presence/session transport state.
    isOnline: false,
    lastActive: date(row.lastActive),
    lastSeen: date(row.lastSeen),
    socketId: null,
    deviceToken: null,

    accountStatus: normalizeAccountStatus(row.accountStatus),
    emailVerified: bool(row.emailVerified, true),
    sessionVersion,

    createdAt: date(row.createdAt),
    updatedAt: date(row.updatedAt),

    studentGroup: String(row.studentGroup || "A"),
    totalPoints: int(row.totalPoints, 0),
    level: String(row.level || "Rising (Resident)"),
    levelBadge: String(row.levelBadge || "👶"),
    streakDays: int(row.streakDays, 0),
    totalTimeSpent: int(row.totalTimeSpent, 0),
    preferences:
      json(row.preferences, {
        theme: "system",
        language: "en",
        pushAlerts: true,
      }),
  };
}

function publicSummary(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isPrimaryOwner: user.isPrimaryOwner,
    accountStatus: user.accountStatus,
  };
}

async function backupCurrentUsers(currentUsers) {
  const dir = path.resolve("backups");
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `users-before-d1-restore-${stamp}.json`);
  await fs.writeFile(file, JSON.stringify(currentUsers, null, 2), "utf8");
  return file;
}

const d1Users = await readAllD1Users();

if (d1Users.length === 0) {
  throw new Error('Cloudflare D1 table "User" is empty. Nothing to restore.');
}

const malformed = d1Users.filter(
  (row) => !String(row.id || "").trim() || !normalizeEmail(row.email),
);
if (malformed.length > 0) {
  throw new Error(
    `D1 contains ${malformed.length} User rows without a valid id/email. Restore aborted.`,
  );
}

const duplicateEmails = new Map();
for (const row of d1Users) {
  const email = normalizeEmail(row.email);
  duplicateEmails.set(email, (duplicateEmails.get(email) || 0) + 1);
}
const duplicateD1Emails = [...duplicateEmails.entries()].filter(([, count]) => count > 1);
if (duplicateD1Emails.length > 0) {
  throw new Error(
    `D1 User table contains duplicate emails: ${duplicateD1Emails
      .map(([email]) => email)
      .join(", ")}`,
  );
}

const currentUsers = await prisma.user.findMany({
  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
});

const byId = new Map(currentUsers.map((user) => [user.id, user]));
const byEmail = new Map(currentUsers.map((user) => [normalizeEmail(user.email), user]));

const plan = [];
const claimedCurrentIds = new Set();

for (const d1User of d1Users) {
  const d1Id = String(d1User.id);
  const email = normalizeEmail(d1User.email);
  const sameId = byId.get(d1Id);
  const sameEmail = byEmail.get(email);

  if (sameId) {
    claimedCurrentIds.add(sameId.id);
    plan.push({
      action: "UPDATE_BY_ID",
      d1Id,
      targetId: sameId.id,
      email,
      existingUser: sameId,
    });
    continue;
  }

  if (sameEmail) {
    // This is the typical post-reset case: the same person logged in again and
    // received a new PostgreSQL id. Keep that current id to avoid cascading
    // deletions of any fresh data created after the reset, but restore the old
    // D1 profile/role/group/points onto it.
    claimedCurrentIds.add(sameEmail.id);
    plan.push({
      action: "MERGE_BY_EMAIL_KEEP_CURRENT_ID",
      d1Id,
      targetId: sameEmail.id,
      email,
      existingUser: sameEmail,
    });
    continue;
  }

  plan.push({
    action: "CREATE_WITH_D1_ID",
    d1Id,
    targetId: d1Id,
    email,
    existingUser: null,
  });
}

const currentOnlyUsers = currentUsers.filter((user) => !claimedCurrentIds.has(user.id));
const report = {
  mode: APPLY ? "APPLY" : "DRY_RUN",
  source: "Cloudflare D1.User",
  destination: "Supabase/PostgreSQL User",
  ownerHandling: "SKIPPED — isPrimaryOwner is not copied or updated by this tool",
  d1Users: d1Users.length,
  currentSupabaseUsers: currentUsers.length,
  plan: {
    updateById: plan.filter((item) => item.action === "UPDATE_BY_ID").length,
    mergeByEmailKeepCurrentId: plan.filter(
      (item) => item.action === "MERGE_BY_EMAIL_KEEP_CURRENT_ID",
    ).length,
    createWithD1Id: plan.filter((item) => item.action === "CREATE_WITH_D1_ID").length,
    currentSupabaseOnlyUsersLeftUntouched: currentOnlyUsers.length,
  },
  currentSupabaseOnlyUsers: currentOnlyUsers.map(publicSummary),
  emailMergeMappings: plan
    .filter((item) => item.action === "MERGE_BY_EMAIL_KEEP_CURRENT_ID")
    .map((item) => ({
      oldD1UserId: item.d1Id,
      retainedSupabaseUserId: item.targetId,
      email: item.email,
    })),
};

console.log(JSON.stringify(report, null, 2));


if (!APPLY) {
  console.log(
    `\nDRY RUN ONLY — no Supabase data changed and nothing was removed from Cloudflare.\n` +
      `If this report is correct, set CLOUDFLARE_USER_RESTORE_CONFIRM=${CONFIRM_VALUE} and run again with --apply.`,
  );
  await prisma.$disconnect();
  process.exit(0);
}

const backupFile = await backupCurrentUsers(currentUsers);
console.log(`\nCurrent Supabase User backup written to: ${backupFile}`);

let created = 0;
let updated = 0;
let merged = 0;

for (let index = 0; index < plan.length; index += 1) {
  const item = plan[index];
  const row = d1Users.find((candidate) => String(candidate.id) === item.d1Id);
  if (!row) throw new Error(`Internal restore error: missing D1 user ${item.d1Id}`);

  const data = restoredData(row, item.existingUser);

  if (item.action === "CREATE_WITH_D1_ID") {
    await prisma.user.create({
      data: {
        id: item.targetId,
        ...data,
      },
    });
    created += 1;
  } else {
    await prisma.user.update({
      where: { id: item.targetId },
      data,
    });
    if (item.action === "MERGE_BY_EMAIL_KEEP_CURRENT_ID") merged += 1;
    else updated += 1;
  }

  if ((index + 1) % 25 === 0 || index + 1 === plan.length) {
    console.log(`Restored ${index + 1}/${plan.length} users...`);
  }
}

const finalUsers = await prisma.user.findMany({
  select: {
    id: true,
    email: true,
    name: true,
    role: true,
    isPrimaryOwner: true,
    accountStatus: true,
  },
  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
});

console.log(
  JSON.stringify(
    {
      success: true,
      cloudflareUserRowsLeftUntouched: true,
      d1UsersRead: d1Users.length,
      created,
      updated,
      mergedByEmailKeepingCurrentSupabaseId: merged,
      finalSupabaseUserCount: finalUsers.length,
      currentSupabaseOnlyUsersLeftUntouched: currentOnlyUsers.length,
      backupFile,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
