import dotenv from "dotenv";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";

dotenv.config({ override: false });

const args = new Set(process.argv.slice(2));
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));

const APPLY = args.has("--apply");
const ALL = args.has("--all");
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : null;

if (LIMIT !== null && (!Number.isInteger(LIMIT) || LIMIT < 1)) {
  throw new Error("--limit must be a positive integer.");
}

if (APPLY && !ALL && LIMIT === null) {
  console.error(
    'Safety stop: use "--apply --limit=1" for a test migration, or "--apply --all" for the full migration.',
  );
  process.exit(2);
}

const databaseUrl =
  process.env.DIRECT_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  process.env.SUPABASE_DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error(
    "No database URL found. DIRECT_URL, DATABASE_URL, or SUPABASE_DATABASE_URL is required.",
  );
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl,
    },
  },
});

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildStoragePath(lectureId: string, materialId: string): string {
  return `materials/${safePathPart(lectureId)}/${safePathPart(materialId)}.pdf`;
}

function isPdf(data: Buffer): boolean {
  return data.length >= 5 && data.subarray(0, 5).toString("ascii") === "%PDF-";
}

function formatBytes(bytes: bigint | number): string {
  const value = Number(bytes);
  if (!Number.isFinite(value)) return `${bytes} bytes`;
  const units = ["B", "KB", "MB", "GB"];
  let n = value;
  let index = 0;
  while (n >= 1024 && index < units.length - 1) {
    n /= 1024;
    index += 1;
  }
  return `${n.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function createR2Client(): { client: S3Client; bucket: string } {
  const endpoint = requireEnv("R2_ENDPOINT").replace(/\/+$/, "");
  const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");
  const bucket = (process.env.R2_BUCKET_NAME || "99s-guide-files").trim();
  const region = (process.env.R2_REGION || "auto").trim() || "auto";

  return {
    bucket,
    client: new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    }),
  };
}

async function printDryRun(): Promise<void> {
  const count = await prisma.material.count({
    where: {
      type: { in: ["PDF", "NOTE"] },
      fileData: { not: null },
    },
  });

  const result = await prisma.$queryRaw<Array<{ bytes: bigint }>>`
    SELECT COALESCE(SUM(octet_length("fileData")), 0)::bigint AS bytes
    FROM "Material"
    WHERE "fileData" IS NOT NULL
      AND "type" IN ('PDF', 'NOTE')
  `;

  const bytes = result[0]?.bytes ?? 0n;

  const sample = await prisma.material.findMany({
    where: {
      type: { in: ["PDF", "NOTE"] },
      fileData: { not: null },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 5,
    select: {
      id: true,
      title: true,
      type: true,
      lectureId: true,
      storagePath: true,
    },
  });

  let dbHost = "unknown";
  try {
    dbHost = new URL(databaseUrl).hostname;
  } catch {}

  console.log("");
  console.log("=== R2 PDF MIGRATION — DRY RUN ===");
  console.log(`Database host: ${dbHost}`);
  console.log(`Legacy PDF/NOTE rows with fileData: ${count}`);
  console.log(`Total legacy PDF bytes in PostgreSQL: ${formatBytes(bytes)}`);
  console.log("No database rows or R2 objects were changed.");
  console.log("");

  if (sample.length > 0) {
    console.log("First candidates:");
    for (const item of sample) {
      console.log(
        `- ${item.id} | ${item.type} | ${item.title} | ${buildStoragePath(item.lectureId, item.id)}`,
      );
    }
  }

  console.log("");
  console.log(
    count === 0
      ? "Nothing needs migration."
      : 'Next safe test: run with "--apply --limit=1" only after R2 credentials are available locally.',
  );
}

async function migrate(): Promise<void> {
  const { client, bucket } = createR2Client();
  const target = ALL ? Number.POSITIVE_INFINITY : (LIMIT ?? 0);

  let migrated = 0;
  let failed = 0;
  let skipped = 0;
  let cursorId: string | undefined;

  console.log("");
  console.log("=== R2 PDF MIGRATION — APPLY MODE ===");
  console.log(ALL ? "Scope: ALL remaining legacy PDFs/NOTEs" : `Scope: at most ${target} item(s)`);
  console.log(`R2 bucket: ${bucket}`);
  console.log("");

  while (migrated + failed + skipped < target) {
    const rows = await prisma.material.findMany({
      where: {
        type: { in: ["PDF", "NOTE"] },
        fileData: { not: null },
        ...(cursorId ? { id: { gt: cursorId } } : {}),
      },
      orderBy: { id: "asc" },
      take: 1,
      select: {
        id: true,
        title: true,
        type: true,
        lectureId: true,
        fileData: true,
      },
    });

    if (rows.length === 0) break;

    const material = rows[0];
    cursorId = material.id;

    const data = material.fileData;
    if (!data) {
      skipped += 1;
      continue;
    }

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

    if (!isPdf(buffer)) {
      console.error(`[SKIP] ${material.id} "${material.title}" is not a valid %PDF- file.`);
      skipped += 1;
      continue;
    }

    const storagePath = buildStoragePath(material.lectureId, material.id);

    try {
      console.log(
        `[UPLOAD] ${material.id} | ${formatBytes(buffer.length)} | ${storagePath}`,
      );

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: storagePath,
          Body: buffer,
          ContentType: "application/pdf",
          ContentDisposition: "inline",
          CacheControl: "private, max-age=3600",
        }),
      );

      const head = await client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: storagePath,
        }),
      );

      if (
        typeof head.ContentLength === "number" &&
        head.ContentLength !== buffer.length
      ) {
        throw new Error(
          `R2 verification failed: uploaded size ${head.ContentLength}, expected ${buffer.length}.`,
        );
      }

      const updated = await prisma.material.updateMany({
        where: {
          id: material.id,
          fileData: { not: null },
        },
        data: {
          storagePath,
          fileData: null,
        },
      });

      if (updated.count !== 1) {
        await client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: storagePath,
          }),
        );
        throw new Error(
          "Database row changed while migration was running; uploaded R2 object was removed and the original database data was left untouched.",
        );
      }

      migrated += 1;
      console.log(`[OK] ${material.id} migrated safely.`);
    } catch (error) {
      failed += 1;
      const message =
        error instanceof Error ? error.message : "Unknown migration error";
      console.error(`[FAILED] ${material.id}: ${message}`);
      console.error(
        "         The script did not intentionally clear fileData for this failed item.",
      );
    }
  }

  console.log("");
  console.log("=== MIGRATION RESULT ===");
  console.log(`Migrated: ${migrated}`);
  console.log(`Skipped:  ${skipped}`);
  console.log(`Failed:   ${failed}`);
  console.log("");
}

async function main(): Promise<void> {
  try {
    if (!APPLY) {
      await printDryRun();
    } else {
      await migrate();
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("");
  console.error("Migration script stopped:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
