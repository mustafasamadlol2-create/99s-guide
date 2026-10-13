import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const CONFIRM_VALUE = "DELETE_D1_ROWS_NOT_IN_POSTGRES";
const READ_PAGE_SIZE = 1000;
const DELETE_BATCH_SIZE = 50;

function requiredEnv(name) {
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

const accountId = requiredEnv("CLOUDFLARE_ACCOUNT_ID");
const apiToken = requiredEnv("CLOUDFLARE_API_TOKEN");
const databaseId = await resolveD1DatabaseId();

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

  return {
    rows: Array.isArray(first?.results) ? first.results : [],
    changes: Number(first?.meta?.changes ?? first?.changes ?? 0),
  };
}

async function readAllD1(table, selectSql, orderSql) {
  const rows = [];
  let offset = 0;

  while (true) {
    const { rows: page } = await d1Query(
      `SELECT ${selectSql}
       FROM "${table}"
       ORDER BY ${orderSql}
       LIMIT ? OFFSET ?`,
      [READ_PAGE_SIZE, offset],
    );

    rows.push(...page);

    if (page.length < READ_PAGE_SIZE) break;
    offset += page.length;
  }

  return rows;
}

function key1(id) {
  return String(id);
}

function lectureProgressKey(row) {
  return `${String(row.userId)}\u0000${String(row.lectureId)}`;
}

function splitIntoBatches(items, size) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function sampleRows(rows, max = 10) {
  return rows.slice(0, max);
}

async function loadCanonical() {
  const [
    lectures,
    materials,
    mcqs,
    flashcards,
    flashcardProgress,
    lectureProgress,
  ] = await Promise.all([
    prisma.lecture.findMany({ select: { id: true } }),
    prisma.material.findMany({ select: { id: true } }),
    prisma.mcq.findMany({ select: { id: true } }),
    prisma.flashcard.findMany({ select: { id: true } }),
    prisma.flashcardProgress.findMany({
      select: { id: true, userId: true, flashcardId: true },
    }),
    prisma.lectureProgress.findMany({
      select: { userId: true, lectureId: true },
    }),
  ]);

  return {
    Lecture: lectures,
    Material: materials,
    Mcq: mcqs,
    Flashcard: flashcards,
    FlashcardProgress: flashcardProgress,
    LectureProgress: lectureProgress,
  };
}

async function loadD1() {
  const [
    lectures,
    materials,
    mcqs,
    flashcards,
    flashcardProgress,
    lectureProgress,
  ] = await Promise.all([
    readAllD1("Lecture", `"id"`, `"id" ASC`),
    readAllD1("Material", `"id","lectureId"`, `"id" ASC`),
    readAllD1("Mcq", `"id","lectureId"`, `"id" ASC`),
    readAllD1("Flashcard", `"id","lectureId"`, `"id" ASC`),
    readAllD1(
      "FlashcardProgress",
      `"id","userId","flashcardId"`,
      `"id" ASC`,
    ),
    readAllD1(
      "LectureProgress",
      `"userId","lectureId"`,
      `"userId" ASC, "lectureId" ASC`,
    ),
  ]);

  return {
    Lecture: lectures,
    Material: materials,
    Mcq: mcqs,
    Flashcard: flashcards,
    FlashcardProgress: flashcardProgress,
    LectureProgress: lectureProgress,
  };
}

function compareSimple(canonicalRows, d1Rows) {
  const canonicalKeys = new Set(canonicalRows.map((row) => key1(row.id)));
  const d1Keys = new Set(d1Rows.map((row) => key1(row.id)));

  const staleD1Rows = d1Rows.filter((row) => !canonicalKeys.has(key1(row.id)));
  const canonicalOnlyRows = canonicalRows.filter(
    (row) => !d1Keys.has(key1(row.id)),
  );

  return {
    canonicalRows: canonicalRows.length,
    d1Rows: d1Rows.length,
    keepInD1: d1Rows.length - staleD1Rows.length,
    deleteFromD1Only: staleD1Rows.length,
    supabaseOnlyMissingFromD1: canonicalOnlyRows.length,
    staleD1Rows,
    canonicalOnlyRows,
  };
}

function compareLectureProgress(canonicalRows, d1Rows) {
  const canonicalKeys = new Set(canonicalRows.map(lectureProgressKey));
  const d1Keys = new Set(d1Rows.map(lectureProgressKey));

  const staleD1Rows = d1Rows.filter(
    (row) => !canonicalKeys.has(lectureProgressKey(row)),
  );
  const canonicalOnlyRows = canonicalRows.filter(
    (row) => !d1Keys.has(lectureProgressKey(row)),
  );

  return {
    canonicalRows: canonicalRows.length,
    d1Rows: d1Rows.length,
    keepInD1: d1Rows.length - staleD1Rows.length,
    deleteFromD1Only: staleD1Rows.length,
    supabaseOnlyMissingFromD1: canonicalOnlyRows.length,
    staleD1Rows,
    canonicalOnlyRows,
  };
}

function buildPlan(canonical, d1) {
  return {
    FlashcardProgress: compareSimple(
      canonical.FlashcardProgress,
      d1.FlashcardProgress,
    ),
    LectureProgress: compareLectureProgress(
      canonical.LectureProgress,
      d1.LectureProgress,
    ),
    Mcq: compareSimple(canonical.Mcq, d1.Mcq),
    Material: compareSimple(canonical.Material, d1.Material),
    Flashcard: compareSimple(canonical.Flashcard, d1.Flashcard),
    Lecture: compareSimple(canonical.Lecture, d1.Lecture),
  };
}

function publicTableReport(result) {
  return {
    supabaseRows: result.canonicalRows,
    d1Rows: result.d1Rows,
    keepInD1: result.keepInD1,
    deleteFromD1Only: result.deleteFromD1Only,
    supabaseOnlyMissingFromD1: result.supabaseOnlyMissingFromD1,
    sampleD1RowsToDelete: sampleRows(result.staleD1Rows),
  };
}

async function backupStaleRows(plan) {
  const dir = path.resolve("backups");
  await fs.mkdir(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(
    dir,
    `cloudflare-d1-stale-six-tables-before-delete-${stamp}.json`,
  );

  const payload = {};
  for (const [table, result] of Object.entries(plan)) {
    payload[table] = result.staleD1Rows;
  }

  await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}

async function deleteSimpleById(table, rows) {
  let deleted = 0;

  for (const batch of splitIntoBatches(rows, DELETE_BATCH_SIZE)) {
    if (batch.length === 0) continue;

    const placeholders = batch.map(() => "?").join(",");
    const params = batch.map((row) => String(row.id));

    const result = await d1Query(
      `DELETE FROM "${table}" WHERE "id" IN (${placeholders})`,
      params,
    );

    deleted += result.changes;
  }

  return deleted;
}

async function deleteLectureProgress(rows) {
  let deleted = 0;

  // Two parameters per row, so keep batches deliberately small.
  for (const batch of splitIntoBatches(rows, 40)) {
    if (batch.length === 0) continue;

    const clauses = [];
    const params = [];

    for (const row of batch) {
      clauses.push(`("userId" = ? AND "lectureId" = ?)`);
      params.push(String(row.userId), String(row.lectureId));
    }

    const result = await d1Query(
      `DELETE FROM "LectureProgress" WHERE ${clauses.join(" OR ")}`,
      params,
    );

    deleted += result.changes;
  }

  return deleted;
}

async function verifyAfterApply() {
  const canonical = await loadCanonical();
  const d1 = await loadD1();
  return buildPlan(canonical, d1);
}

async function main() {
  if (
    APPLY &&
    String(process.env.CLOUDFLARE_D1_CLEAN_CONFIRM || "").trim() !==
      CONFIRM_VALUE
  ) {
    throw new Error(
      `Refusing apply. Set CLOUDFLARE_D1_CLEAN_CONFIRM=${CONFIRM_VALUE} first.`,
    );
  }

  const canonical = await loadCanonical();
  const d1 = await loadD1();
  const plan = buildPlan(canonical, d1);

  // User explicitly requested progress reset to zero in Cloudflare D1.
  // Therefore every D1 row in both progress tables is scheduled for deletion,
  // even if a canonical row exists in Supabase/PostgreSQL.
  plan.FlashcardProgress.staleD1Rows = d1.FlashcardProgress;
  plan.FlashcardProgress.keepInD1 = 0;
  plan.FlashcardProgress.deleteFromD1Only = d1.FlashcardProgress.length;

  plan.LectureProgress.staleD1Rows = d1.LectureProgress;
  plan.LectureProgress.keepInD1 = 0;
  plan.LectureProgress.deleteFromD1Only = d1.LectureProgress.length;

  const report = {
    mode: APPLY ? "APPLY" : "DRY_RUN",
    canonicalSource: "Supabase/PostgreSQL",
    d1Target: "Cloudflare D1",
    rule:
      "CONTENT TABLES: delete only D1-only rows. PROGRESS TABLES: delete ALL D1 rows so progress is reset to zero. Supabase/PostgreSQL remains untouched.",
    guarantees: {
      supabaseWillNotBeModified: true,
      matchingContentRowsWillRemainUntouched: true,
      allD1ProgressRowsWillBeDeleted: true,
      supabaseWillRemainUntouchedIncludingProgress: true,
      noRowsWillBeCopiedFromD1ToSupabase: true,
      noRowsWillBeInsertedIntoD1: true,
      tablesOutsideThisListWillRemainUntouched: true,
    },
    tables: Object.fromEntries(
      Object.entries(plan).map(([table, result]) => [
        table,
        publicTableReport(result),
      ]),
    ),
    totalD1RowsToDelete: Object.values(plan).reduce(
      (sum, result) => sum + result.deleteFromD1Only,
      0,
    ),
    progressReset: {
      FlashcardProgress: {
        d1RowsToDelete: d1.FlashcardProgress.length,
        finalD1RowsExpected: 0,
        supabaseRowsLeftUntouched: canonical.FlashcardProgress.length,
      },
      LectureProgress: {
        d1RowsToDelete: d1.LectureProgress.length,
        finalD1RowsExpected: 0,
        supabaseRowsLeftUntouched: canonical.LectureProgress.length,
      },
    },
    totalSupabaseOnlyRowsMissingFromD1: Object.values(plan).reduce(
      (sum, result) => sum + result.supabaseOnlyMissingFromD1,
      0,
    ),
  };

  console.log(JSON.stringify(report, null, 2));

  if (!APPLY) {
    console.log(
      `\nDRY RUN ONLY — nothing changed in Supabase or Cloudflare.\n` +
        `Review "deleteFromD1Only" for every table.\n` +
        `If correct, set CLOUDFLARE_D1_CLEAN_CONFIRM=${CONFIRM_VALUE} and run with --apply.`,
    );
    return;
  }

  const backupFile = await backupStaleRows(plan);
  console.log(`\nBackup of all D1 rows scheduled for deletion: ${backupFile}`);

  // Dependency-safe order:
  // progress/children first, Lecture last.
  const deleted = {};

  deleted.FlashcardProgress = await deleteSimpleById(
    "FlashcardProgress",
    plan.FlashcardProgress.staleD1Rows,
  );
  console.log(
    `Deleted ${deleted.FlashcardProgress}/${plan.FlashcardProgress.deleteFromD1Only} stale FlashcardProgress rows from D1.`,
  );

  deleted.LectureProgress = await deleteLectureProgress(
    plan.LectureProgress.staleD1Rows,
  );
  console.log(
    `Deleted ${deleted.LectureProgress}/${plan.LectureProgress.deleteFromD1Only} stale LectureProgress rows from D1.`,
  );

  deleted.Mcq = await deleteSimpleById("Mcq", plan.Mcq.staleD1Rows);
  console.log(
    `Deleted ${deleted.Mcq}/${plan.Mcq.deleteFromD1Only} stale Mcq rows from D1.`,
  );

  deleted.Material = await deleteSimpleById(
    "Material",
    plan.Material.staleD1Rows,
  );
  console.log(
    `Deleted ${deleted.Material}/${plan.Material.deleteFromD1Only} stale Material rows from D1.`,
  );

  deleted.Flashcard = await deleteSimpleById(
    "Flashcard",
    plan.Flashcard.staleD1Rows,
  );
  console.log(
    `Deleted ${deleted.Flashcard}/${plan.Flashcard.deleteFromD1Only} stale Flashcard rows from D1.`,
  );

  deleted.Lecture = await deleteSimpleById(
    "Lecture",
    plan.Lecture.staleD1Rows,
  );
  console.log(
    `Deleted ${deleted.Lecture}/${plan.Lecture.deleteFromD1Only} stale Lecture rows from D1.`,
  );

  const verification = await verifyAfterApply();

  const contentTables = ["Mcq", "Material", "Flashcard", "Lecture"];
  const contentStaleRemaining = contentTables.reduce(
    (sum, table) => sum + verification[table].deleteFromD1Only,
    0,
  );

  // Re-read D1 progress directly; success requires both to be empty.
  const d1After = await loadD1();
  const flashcardProgressRemaining = d1After.FlashcardProgress.length;
  const lectureProgressRemaining = d1After.LectureProgress.length;

  const finalReport = {
    success:
      contentStaleRemaining === 0 &&
      flashcardProgressRemaining === 0 &&
      lectureProgressRemaining === 0,
    supabaseWasReadOnly: true,
    backupFile,
    deletedFromD1: deleted,
    totalDeletedFromD1: Object.values(deleted).reduce(
      (sum, count) => sum + count,
      0,
    ),
    staleContentRowsRemainingAfterVerification: contentStaleRemaining,
    progressResetVerification: {
      FlashcardProgressD1RowsRemaining: flashcardProgressRemaining,
      LectureProgressD1RowsRemaining: lectureProgressRemaining,
    },
    finalTables: Object.fromEntries(
      Object.entries(verification).map(([table, result]) => [
        table,
        {
          supabaseRows: result.canonicalRows,
          d1Rows: result.d1Rows,
          matchingRowsKeptInD1: result.keepInD1,
          staleD1RowsRemaining: result.deleteFromD1Only,
          supabaseOnlyRowsMissingFromD1: result.supabaseOnlyMissingFromD1,
        },
      ]),
    ),
  };

  console.log("\nFINAL VERIFICATION");
  console.log(JSON.stringify(finalReport, null, 2));

  if (!finalReport.success) {
    throw new Error(
      `Cleanup verification failed. Content stale remaining=${contentStaleRemaining}, ` +
        `FlashcardProgress remaining=${flashcardProgressRemaining}, ` +
        `LectureProgress remaining=${lectureProgressRemaining}. Inspect the final report.`,
    );
  }
}

try {
  await main();
} finally {
  await prisma.$disconnect().catch(() => {});
}
