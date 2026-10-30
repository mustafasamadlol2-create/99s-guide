import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { getPrisma, disconnectPrisma } from "../server/services/prismaClient.js";
import {
  buildMaterialStoragePath,
  getR2Client,
  uploadPdfToSupabaseStorage,
} from "../server/services/supabaseStorage.js";

const verifyOnly = process.argv.includes("--verify-only");
const workerBaseUrl = String(process.env.CONTENT_WORKER_BASE_URL || "").trim().replace(/\/+$/, "");
const secret = String(process.env.CONTENT_SYNC_SECRET || "").trim();

if (!workerBaseUrl || !secret) {
  throw new Error("CONTENT_WORKER_BASE_URL and CONTENT_SYNC_SECRET are required.");
}

function assertR2Config(): void {
  const required = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
  const missing = required.filter((key) => !String(process.env[key] || "").trim());
  if (missing.length > 0) throw new Error(`Missing R2 environment variable(s): ${missing.join(", ")}`);
}

function isPdfBytes(value: Buffer): boolean {
  return value.length >= 5 && value.subarray(0, 5).toString("ascii") === "%PDF-";
}

async function r2ObjectExists(storagePath: string): Promise<boolean> {
  const { client, bucket } = getR2Client();
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: storagePath }));
    return true;
  } catch (error: any) {
    const status = Number(error?.$metadata?.httpStatusCode || 0);
    const name = String(error?.name || "");
    if (status === 404 || name === "NotFound" || name === "NoSuchKey") return false;
    throw error;
  }
}

async function syncMaterialToD1(row: {
  id: string;
  title: string;
  type: string;
  fileUrlOrLink: string;
  lectureId: string;
  createdAt: Date;
  storagePath: string | null;
}): Promise<void> {
  const payload = {
    version: 1,
    entity: "Material",
    operation: "upsert",
    id: row.id,
    data: {
      id: row.id,
      title: row.title,
      type: row.type,
      fileUrlOrLink: row.fileUrlOrLink,
      lectureId: row.lectureId,
      createdAt: row.createdAt.toISOString(),
      storagePath: row.storagePath,
    },
    occurredAt: new Date().toISOString(),
  };
  const response = await fetch(`${workerBaseUrl}/internal/content-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Content-Sync-Secret": secret,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`D1 material sync failed for ${row.id} with HTTP ${response.status}: ${body.slice(0, 240)}`);
  }
}

async function readLegacyLocalPdf(fileUrlOrLink: string | null): Promise<Buffer | null> {
  if (!fileUrlOrLink?.startsWith("/uploads/")) return null;
  const relative = fileUrlOrLink.replace(/^\/uploads\//, "");
  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  const absolute = path.resolve(uploadsRoot, relative);
  if (absolute !== uploadsRoot && !absolute.startsWith(uploadsRoot + path.sep)) return null;
  try {
    const bytes = await fs.readFile(absolute);
    return isPdfBytes(bytes) ? bytes : null;
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function main(): Promise<void> {
  assertR2Config();
  const prisma = getPrisma();
  console.log(`[Phase2] Mode: ${verifyOnly ? "verify-only" : "backfill + verify"}`);
  console.log(`[Phase2] Content Worker: ${workerBaseUrl}`);
  console.log("[Phase2] Reading PDF/NOTE metadata from canonical Supabase...");

  const rows = await prisma.material.findMany({
    where: { type: { in: ["PDF", "NOTE", "pdf", "note"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      title: true,
      type: true,
      fileUrlOrLink: true,
      lectureId: true,
      createdAt: true,
      storagePath: true,
    },
  });

  let alreadyReady = 0;
  let migrated = 0;
  let restored = 0;
  let copiedBytes = 0;
  const blockers: string[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    let storagePath = row.storagePath;
    if (storagePath && await r2ObjectExists(storagePath)) {
      alreadyReady += 1;
      if ((index + 1) % 50 === 0 || index + 1 === rows.length) {
        console.log(`[Phase2] verify R2: ${index + 1}/${rows.length}`);
      }
      continue;
    }

    if (verifyOnly) {
      blockers.push(`${row.id}: ${storagePath ? "R2 object missing" : "storagePath missing"}`);
      continue;
    }

    // Pull the large PostgreSQL bytea only for the exceptional legacy rows that
    // actually need an R2 copy. This is a one-time administrative migration.
    const legacy = await prisma.material.findUnique({
      where: { id: row.id },
      select: { fileData: true },
    });
    let bytes = legacy?.fileData ? Buffer.from(legacy.fileData) : null;
    if (!bytes) bytes = await readLegacyLocalPdf(row.fileUrlOrLink);

    if (!bytes || !isPdfBytes(bytes)) {
      blockers.push(`${row.id}: no valid legacy PDF bytes are available for R2 migration`);
      continue;
    }

    storagePath = storagePath || buildMaterialStoragePath(row.lectureId, row.id);
    await uploadPdfToSupabaseStorage(storagePath, bytes);
    copiedBytes += bytes.length;

    const updated = await prisma.material.update({
      where: { id: row.id },
      data: {
        storagePath,
        fileUrlOrLink: `/api/materials/pdf/${row.id}`,
      },
      select: {
        id: true,
        title: true,
        type: true,
        fileUrlOrLink: true,
        lectureId: true,
        createdAt: true,
        storagePath: true,
      },
    });

    // Intentionally keep Material.fileData untouched in Supabase. Supabase stays
    // the canonical/backup record; student runtime consumption is moved to R2.
    await syncMaterialToD1(updated);
    if (row.storagePath) restored += 1;
    else migrated += 1;

    if ((index + 1) % 25 === 0 || index + 1 === rows.length) {
      console.log(`[Phase2] migrate R2: ${index + 1}/${rows.length}`);
    }
  }

  const finalRows = await prisma.material.findMany({
    where: { type: { in: ["PDF", "NOTE", "pdf", "note"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, storagePath: true },
  });

  for (const row of finalRows) {
    if (!row.storagePath) {
      if (!blockers.some((item) => item.startsWith(`${row.id}:`))) blockers.push(`${row.id}: storagePath missing after migration`);
      continue;
    }
    if (!await r2ObjectExists(row.storagePath)) {
      if (!blockers.some((item) => item.startsWith(`${row.id}:`))) blockers.push(`${row.id}: R2 object missing after migration`);
    }
  }

  console.log(`[Phase2] PDF/NOTE rows: ${finalRows.length}`);
  console.log(`[Phase2] already R2-ready: ${alreadyReady}`);
  console.log(`[Phase2] migrated legacy rows: ${migrated}`);
  console.log(`[Phase2] restored missing R2 objects: ${restored}`);
  console.log(`[Phase2] one-time bytes copied from Supabase/local legacy storage: ${copiedBytes}`);

  if (blockers.length > 0) {
    console.error(`[Phase2] BLOCKED: ${blockers.length} PDF/NOTE row(s) are not R2-ready.`);
    for (const blocker of blockers.slice(0, 50)) console.error(`  - ${blocker}`);
    if (blockers.length > 50) console.error(`  ... ${blockers.length - 50} more`);
    process.exitCode = 1;
    return;
  }

  console.log("[Phase2] All PDF/NOTE files are present in Cloudflare R2. Phase 2 is ready for strict cutover.");
}

main()
  .catch((error) => {
    console.error(`[Phase2] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma().catch(() => {});
  });
