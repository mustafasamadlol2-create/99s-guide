import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const CONFIRM_VALUE = "RESTORE_DAILY_MOTTO_FROM_D1";
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
    path.resolve("cloudflare-content-api/wrangler.jsonc"),
    path.resolve("cloudflare-private-data-api/wrangler.jsonc"),
  ]) {
    try {
      const text = await fs.readFile(candidate, "utf8");
      const match = text.match(/"database_id"\s*:\s*"([^"]+)"/);
      if (match?.[1]) return match[1];
    } catch {
      // Try next config.
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
  String(process.env.CLOUDFLARE_DAILY_MOTTO_RESTORE_CONFIRM || "").trim() !== CONFIRM_VALUE
) {
  throw new Error(
    `Refusing apply. Set CLOUDFLARE_DAILY_MOTTO_RESTORE_CONFIRM=${CONFIRM_VALUE} first.`,
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

async function readAllD1Mottos() {
  const rows = [];
  let offset = 0;

  while (true) {
    const page = await d1Query(
      `SELECT
        "id",
        "message",
        "isActive",
        "isFeatured",
        "createdBy",
        "createdAt",
        "updatedAt"
       FROM "DailyMotto"
       ORDER BY "createdAt" ASC, "id" ASC
       LIMIT ? OFFSET ?`,
      [PAGE_SIZE, offset],
    );

    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += page.length;
  }

  return rows;
}

function bool(value, fallback = false) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  return fallback;
}

function date(value, label) {
  const parsed = new Date(String(value || ""));
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid ${label}: ${String(value)}`);
  }
  return parsed;
}

function normalizeD1Row(row) {
  const id = String(row.id || "").trim();
  const message = String(row.message || "").trim();

  if (!id) throw new Error("D1 DailyMotto row is missing id.");
  if (!message) throw new Error(`D1 DailyMotto ${id} has an empty message.`);

  return {
    id,
    message,
    isActive: bool(row.isActive, true),
    isFeatured: bool(row.isFeatured, false),
    createdBy:
      row.createdBy === null || row.createdBy === undefined || row.createdBy === ""
        ? null
        : String(row.createdBy),
    createdAt: date(row.createdAt, `createdAt for ${id}`),
    updatedAt: date(row.updatedAt, `updatedAt for ${id}`),
  };
}

async function backupCurrentMottos(currentRows) {
  const dir = path.resolve("backups");
  await fs.mkdir(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `daily-motto-before-d1-restore-${stamp}.json`);

  await fs.writeFile(
    file,
    JSON.stringify(
      currentRows.map((row) => ({
        ...row,
        createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
        updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
      })),
      null,
      2,
    ),
    "utf8",
  );

  return file;
}

const rawD1Rows = await readAllD1Mottos();

if (rawD1Rows.length === 0) {
  throw new Error('Cloudflare D1 table "DailyMotto" is empty. Nothing to restore.');
}

const d1Rows = rawD1Rows.map(normalizeD1Row);

const ids = new Set();
for (const row of d1Rows) {
  if (ids.has(row.id)) {
    throw new Error(`Duplicate DailyMotto id found in D1: ${row.id}`);
  }
  ids.add(row.id);
}

const currentRows = await prisma.dailyMotto.findMany({
  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
});

const currentById = new Map(currentRows.map((row) => [row.id, row]));

let createCount = 0;
let updateCount = 0;

for (const row of d1Rows) {
  if (currentById.has(row.id)) updateCount += 1;
  else createCount += 1;
}

const d1Ids = new Set(d1Rows.map((row) => row.id));
const supabaseOnlyRows = currentRows.filter((row) => !d1Ids.has(row.id));

const report = {
  mode: APPLY ? "APPLY" : "DRY_RUN",
  source: "Cloudflare D1.DailyMotto",
  destination: "Supabase/PostgreSQL DailyMotto",
  d1DailyMottoRows: d1Rows.length,
  currentSupabaseDailyMottoRows: currentRows.length,
  plan: {
    createWithD1Id: createCount,
    updateMatchingId: updateCount,
    currentSupabaseOnlyRowsLeftUntouched: supabaseOnlyRows.length,
  },
  cloudflareRowsWillRemainUntouched: true,
  otherTablesWillRemainUntouched: true,
  sample: d1Rows.slice(0, 5).map((row) => ({
    id: row.id,
    message: row.message.length > 120 ? `${row.message.slice(0, 117)}...` : row.message,
    isActive: row.isActive,
    isFeatured: row.isFeatured,
  })),
};

console.log(JSON.stringify(report, null, 2));

if (!APPLY) {
  console.log(
    `\nDRY RUN ONLY — nothing changed in Supabase and nothing was removed from Cloudflare.\n` +
      `If the counts are correct, set CLOUDFLARE_DAILY_MOTTO_RESTORE_CONFIRM=${CONFIRM_VALUE} and run again with --apply.`,
  );
  await prisma.$disconnect();
  process.exit(0);
}

const backupFile = await backupCurrentMottos(currentRows);
console.log(`\nCurrent Supabase DailyMotto backup written to: ${backupFile}`);

let created = 0;
let updated = 0;

for (let index = 0; index < d1Rows.length; index += 1) {
  const row = d1Rows[index];
  const exists = currentById.has(row.id);

  await prisma.dailyMotto.upsert({
    where: { id: row.id },
    create: {
      id: row.id,
      message: row.message,
      isActive: row.isActive,
      isFeatured: row.isFeatured,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    update: {
      message: row.message,
      isActive: row.isActive,
      isFeatured: row.isFeatured,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  });

  if (exists) updated += 1;
  else created += 1;

  if ((index + 1) % 25 === 0 || index + 1 === d1Rows.length) {
    console.log(`Restored ${index + 1}/${d1Rows.length} DailyMotto rows...`);
  }
}

const finalCount = await prisma.dailyMotto.count();

console.log(
  JSON.stringify(
    {
      success: true,
      cloudflareRowsLeftUntouched: true,
      otherTablesLeftUntouched: true,
      d1RowsRead: d1Rows.length,
      created,
      updated,
      currentSupabaseOnlyRowsLeftUntouched: supabaseOnlyRows.length,
      finalSupabaseDailyMottoCount: finalCount,
      backupFile,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
