import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

function getDatabaseUrl() {
  const raw =
    process.env.CONTENT_EXPORT_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    process.env.SUPABASE_DATABASE_URL?.trim();

  if (!raw) {
    throw new Error(
      "No database URL found. Expected CONTENT_EXPORT_DATABASE_URL, DATABASE_URL, or SUPABASE_DATABASE_URL.",
    );
  }

  const url = new URL(raw);

  // Stage 4C is a read-only snapshot export. Keep the local export process to a
  // single PostgreSQL connection so it cannot compete aggressively with the live app.
  url.searchParams.set("connection_limit", "1");
  url.searchParams.set("pool_timeout", "60");

  return url.toString();
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: getDatabaseUrl(),
    },
  },
});

const DEFAULT_OUTPUT = path.join(
  process.cwd(),
  "cloudflare-content-api",
  "content-import.sql",
);

const outArg = process.argv.find((arg) => arg.startsWith("--out="));
const OUTPUT_PATH = path.resolve(
  outArg ? outArg.slice("--out=".length) : DEFAULT_OUTPUT,
);
const MANIFEST_PATH = OUTPUT_PATH.replace(/\.sql$/i, "") + "-manifest.json";

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Date) return `'${value.toISOString().replaceAll("'", "''")}'`;
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Cannot serialize a non-finite number to SQLite.");
    }
    return String(value);
  }

  const text = String(value)
    .replace(/\u0000/g, "")
    .replaceAll("'", "''");

  return `'${text}'`;
}

function q(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function buildUpsert(table, columns, row) {
  const columnSql = columns.map(q).join(", ");
  const valuesSql = columns.map((column) => sqlLiteral(row[column])).join(", ");
  const updateColumns = columns.filter((column) => column !== "id");

  const updateSql = updateColumns
    .map((column) => `${q(column)} = excluded.${q(column)}`)
    .join(", ");

  return (
    `INSERT INTO ${q(table)} (${columnSql}) VALUES (${valuesSql}) ` +
    `ON CONFLICT(${q("id")}) DO UPDATE SET ${updateSql};`
  );
}

function canonicalHash(rows, columns) {
  const hash = crypto.createHash("sha256");

  for (const row of rows) {
    const canonical = {};
    for (const column of columns) {
      const value = row[column];
      canonical[column] =
        value instanceof Date ? value.toISOString() : value ?? null;
    }
    hash.update(JSON.stringify(canonical));
    hash.update("\n");
  }

  return hash.digest("hex");
}

async function withRetry(label, fn) {
  const attempts = 6;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      const retryable =
        /EMAXCONNSESSION|max clients reached|connection|pool timeout|P1001|P2024/i.test(
          message,
        );

      if (!retryable || attempt === attempts) {
        throw error;
      }

      const waitMs = attempt * 5000;
      console.log(
        `${label}: database is busy; retrying in ${waitMs / 1000}s (${attempt}/${attempts})...`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  throw new Error(`${label}: retry loop exhausted.`);
}

async function main() {
  console.log("");
  console.log("99's Guide — Stage 4C Export");
  console.log("----------------------------");
  console.log("Mode: READ-ONLY SOURCE EXPORT");
  console.log("Database concurrency: 1 connection");
  console.log("");

  // IMPORTANT: these are deliberately sequential, not Promise.all().
  // The live Supabase project uses a small session-mode pool; parallel reads from
  // a local migration process can otherwise consume multiple client slots.
  const lectures = await withRetry("Lecture", () =>
    prisma.lecture.findMany({
      select: {
        id: true,
        name: true,
        mainSubject: true,
        subSubject: true,
        trackMode: true,
        department: true,
        createdAt: true,
      },
      orderBy: { id: "asc" },
    }),
  );

  const materials = await withRetry("Material", () =>
    prisma.material.findMany({
      select: {
        id: true,
        title: true,
        type: true,
        fileUrlOrLink: true,
        lectureId: true,
        createdAt: true,
        storagePath: true,
      },
      orderBy: { id: "asc" },
    }),
  );

  const mcqs = await withRetry("Mcq", () =>
    prisma.mcq.findMany({
      select: {
        id: true,
        question: true,
        optionA: true,
        optionB: true,
        optionC: true,
        optionD: true,
        correctAnswer: true,
        hint: true,
        explanation: true,
        sourceType: true,
        sourceRef: true,
        difficulty: true,
        lectureId: true,
        createdAt: true,
      },
      orderBy: { id: "asc" },
    }),
  );

  const flashcards = await withRetry("Flashcard", () =>
    prisma.flashcard.findMany({
      select: {
        id: true,
        clinicalConcept: true,
        explanation: true,
        lectureId: true,
        createdAt: true,
      },
      orderBy: { id: "asc" },
    }),
  );

  const mottos = await withRetry("DailyMotto", () =>
    prisma.dailyMotto.findMany({
      select: {
        id: true,
        message: true,
        isActive: true,
        isFeatured: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { id: "asc" },
    }),
  );

  const globalCalendarEvents = await withRetry("CalendarEvent", () =>
    prisma.calendarEvent.findMany({
      where: { userId: null },
      select: {
        id: true,
        userId: true,
        title: true,
        eventType: true,
        startDateTime: true,
        endDateTime: true,
        targetGroups: true,
        description: true,
        subjectId: true,
        lectureId: true,
        room: true,
        doctor: true,
        notes: true,
        isPinned: true,
        isCompleted: true,
      },
      orderBy: { id: "asc" },
    }),
  );

  const materialsWithFileData = await withRetry("Material.fileData audit", () =>
    prisma.material.count({
      where: { fileData: { not: null } },
    }),
  );

  if (materialsWithFileData !== 0) {
    throw new Error(
      `Safety check failed: ${materialsWithFileData} Material row(s) still contain fileData. ` +
      "Stage 4 expects binaries to remain in R2 and not be exported to D1.",
    );
  }

  const lectureIds = new Set(lectures.map((row) => row.id));

  const orphanMaterials = materials.filter((row) => !lectureIds.has(row.lectureId));
  const orphanMcqs = mcqs.filter((row) => !lectureIds.has(row.lectureId));
  const orphanFlashcards = flashcards.filter((row) => !lectureIds.has(row.lectureId));

  if (orphanMaterials.length || orphanMcqs.length || orphanFlashcards.length) {
    throw new Error(
      `Safety check failed: orphan rows detected ` +
      `(Material=${orphanMaterials.length}, Mcq=${orphanMcqs.length}, Flashcard=${orphanFlashcards.length}).`,
    );
  }

  const tableSpecs = [
    {
      table: "Lecture",
      rows: lectures,
      columns: [
        "id",
        "name",
        "mainSubject",
        "subSubject",
        "trackMode",
        "department",
        "createdAt",
      ],
    },
    {
      table: "Material",
      rows: materials,
      columns: [
        "id",
        "title",
        "type",
        "fileUrlOrLink",
        "lectureId",
        "createdAt",
        "storagePath",
      ],
    },
    {
      table: "Mcq",
      rows: mcqs,
      columns: [
        "id",
        "question",
        "optionA",
        "optionB",
        "optionC",
        "optionD",
        "correctAnswer",
        "hint",
        "explanation",
        "sourceType",
        "sourceRef",
        "difficulty",
        "lectureId",
        "createdAt",
      ],
    },
    {
      table: "Flashcard",
      rows: flashcards,
      columns: [
        "id",
        "clinicalConcept",
        "explanation",
        "lectureId",
        "createdAt",
      ],
    },
    {
      table: "DailyMotto",
      rows: mottos,
      columns: [
        "id",
        "message",
        "isActive",
        "isFeatured",
        "createdBy",
        "createdAt",
        "updatedAt",
      ],
    },
    {
      table: "CalendarEvent",
      rows: globalCalendarEvents,
      columns: [
        "id",
        "userId",
        "title",
        "eventType",
        "startDateTime",
        "endDateTime",
        "targetGroups",
        "description",
        "subjectId",
        "lectureId",
        "room",
        "doctor",
        "notes",
        "isPinned",
        "isCompleted",
      ],
    },
  ];

  const sql = [];

  sql.push("-- 99's Guide — Stage 4C Supabase -> D1 snapshot");
  sql.push("-- Generated automatically. Exact source IDs are preserved.");
  sql.push("-- This file does NOT delete Supabase data.");
  sql.push("PRAGMA foreign_keys = ON;");
  sql.push("BEGIN TRANSACTION;");
  sql.push("");

  for (const spec of tableSpecs) {
    sql.push(`-- ${spec.table}: ${spec.rows.length} rows`);
    for (const row of spec.rows) {
      sql.push(buildUpsert(spec.table, spec.columns, row));
    }
    sql.push("");
  }

  sql.push("COMMIT;");
  sql.push("");

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, sql.join("\n"), "utf8");

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: "Supabase PostgreSQL",
    target: "Cloudflare D1",
    outputFile: OUTPUT_PATH,
    safety: {
      materialFileDataRows: materialsWithFileData,
      orphanMaterials: orphanMaterials.length,
      orphanMcqs: orphanMcqs.length,
      orphanFlashcards: orphanFlashcards.length,
      onlyGlobalCalendarEventsExported: true,
    },
    tables: Object.fromEntries(
      tableSpecs.map((spec) => [
        spec.table,
        {
          rows: spec.rows.length,
          sha256: canonicalHash(spec.rows, spec.columns),
        },
      ]),
    ),
  };

  fs.writeFileSync(
    MANIFEST_PATH,
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );

  console.log("");
  for (const spec of tableSpecs) {
    console.log(`${spec.table.padEnd(14)} ${String(spec.rows.length).padStart(4)} rows`);
  }
  console.log("");
  console.log("Safety checks:");
  console.log(`  Material.fileData rows: ${materialsWithFileData}`);
  console.log(`  Orphan Material rows:   ${orphanMaterials.length}`);
  console.log(`  Orphan Mcq rows:        ${orphanMcqs.length}`);
  console.log(`  Orphan Flashcard rows:  ${orphanFlashcards.length}`);
  console.log("");
  console.log(`SQL written to:      ${OUTPUT_PATH}`);
  console.log(`Manifest written to: ${MANIFEST_PATH}`);
  console.log("");
  console.log("EXPORT COMPLETE — Supabase was not modified.");
}

main()
  .catch((error) => {
    console.error("");
    console.error(
      "Export aborted:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
