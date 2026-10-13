import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const APPLY = process.argv.includes("--apply");
const CONFIRM_VALUE = "RECONCILE_CLOUDFLARE_FROM_POSTGRES";
const PAGE_SIZE = 500;
const DELETE_BATCH = 50;
const SAMPLE_LIMIT = 20;

const prisma = new PrismaClient();

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function readD1DatabaseId() {
  const explicit = String(process.env.CLOUDFLARE_D1_DATABASE_ID || "").trim();
  if (explicit) return explicit;

  const candidates = [
    path.resolve("cloudflare-content-api/wrangler.jsonc"),
    path.resolve("cloudflare-private-data-api/wrangler.jsonc"),
  ];

  for (const file of candidates) {
    try {
      const text = await fs.readFile(file, "utf8");
      const match = text.match(/"database_id"\s*:\s*"([^"]+)"/);
      if (match?.[1]) return match[1];
    } catch {
      // Try the next config.
    }
  }
  throw new Error(
    "CLOUDFLARE_D1_DATABASE_ID is not configured and no database_id was found in the Worker wrangler config.",
  );
}

const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
const apiToken = requireEnv("CLOUDFLARE_API_TOKEN");
const databaseId = await readD1DatabaseId();

if (APPLY && String(process.env.CLOUDFLARE_RECONCILE_CONFIRM || "").trim() !== CONFIRM_VALUE) {
  throw new Error(
    `Refusing destructive apply. Set CLOUDFLARE_RECONCILE_CONFIRM=${CONFIRM_VALUE} and run again with --apply.`,
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

function q(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function keyOf(row, columns) {
  return columns.map((column) => String(row?.[column] ?? "")).join("\u0000");
}

async function listD1Tables() {
  const rows = await d1Query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  );
  return new Set(rows.map((row) => String(row.name)));
}

async function readAllD1Keys(table, keyColumns) {
  const result = [];
  let offset = 0;
  const select = keyColumns.map(q).join(", ");
  while (true) {
    const rows = await d1Query(
      `SELECT ${select} FROM ${q(table)} LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    );
    result.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += rows.length;
  }
  return result;
}

async function deleteD1Rows(table, keyColumns, rows) {
  if (!APPLY || rows.length === 0) return 0;
  let deleted = 0;

  for (let i = 0; i < rows.length; i += DELETE_BATCH) {
    const batch = rows.slice(i, i + DELETE_BATCH);
    const params = [];
    let where;

    if (keyColumns.length === 1) {
      const column = keyColumns[0];
      where = `${q(column)} IN (${batch.map(() => "?").join(",")})`;
      for (const row of batch) params.push(row[column]);
    } else {
      where = batch
        .map((row) => {
          for (const column of keyColumns) params.push(row[column]);
          return `(${keyColumns.map((column) => `${q(column)} = ?`).join(" AND ")})`;
        })
        .join(" OR ");
    }

    await d1Query(`DELETE FROM ${q(table)} WHERE ${where}`, params);
    deleted += batch.length;
  }
  return deleted;
}

async function canonicalKeys(loader, columns) {
  const rows = await loader();
  return new Set(rows.map((row) => keyOf(row, columns)));
}

const tableSpecs = [
  // Shared academic content D1.
  ["Lecture", ["id"], () => prisma.lecture.findMany({ select: { id: true } })],
  ["Material", ["id"], () => prisma.material.findMany({ select: { id: true } })],
  ["ModuleResource", ["id"], () => prisma.moduleResource.findMany({
    where: { status: "READY" },
    select: { id: true },
  })],
  ["Mcq", ["id"], () => prisma.mcq.findMany({ select: { id: true } })],
  ["Flashcard", ["id"], () => prisma.flashcard.findMany({ select: { id: true } })],
  ["DailyMotto", ["id"], () => prisma.dailyMotto.findMany({ select: { id: true } })],
  ["CalendarEvent", ["id"], () => prisma.calendarEvent.findMany({
    where: { userId: null },
    select: { id: true },
  })],

  // Private/read-optimized mirrors.
  ["User", ["id"], () => prisma.user.findMany({ select: { id: true } })],
  ["FlashcardProgress", ["id"], () => prisma.flashcardProgress.findMany({ select: { id: true } })],
  ["LectureProgress", ["userId", "lectureId"], () => prisma.lectureProgress.findMany({
    select: { userId: true, lectureId: true },
  })],
  ["ModerationHistory", ["id"], () => prisma.moderationHistory.findMany({ select: { id: true } })],
  ["Notification", ["id"], () => prisma.notification.findMany({ select: { id: true } })],
  ["PointsLog", ["id"], () => prisma.pointsLog.findMany({ select: { id: true } })],
  ["QaAnswer", ["id"], () => prisma.qaAnswer.findMany({ select: { id: true } })],
  ["QaQuestion", ["id"], () => prisma.qaQuestion.findMany({ select: { id: true } })],
  ["QaVote", ["id"], () => prisma.qaVote.findMany({ select: { id: true } })],
  ["Report", ["id"], () => prisma.report.findMany({ select: { id: true } })],
  ["SmartNotification", ["id"], () => prisma.smartNotification.findMany({ select: { id: true } })],
  ["UserBan", ["id"], () => prisma.userBan.findMany({ select: { id: true } })],
  ["UserBlock", ["id"], () => prisma.userBlock.findMany({ select: { id: true } })],
  ["UserMute", ["id"], () => prisma.userMute.findMany({ select: { id: true } })],
  ["UserProgress", ["id"], () => prisma.userProgress.findMany({ select: { id: true } })],
  ["UserCalendarEvent", ["id"], () => prisma.calendarEvent.findMany({
    where: { userId: { not: null } },
    select: { id: true },
  })],
  ["FocusPlan", ["id"], () => prisma.focusPlan.findMany({ select: { id: true } })],
  ["FocusSession", ["id"], () => prisma.focusSession.findMany({ select: { id: true } })],
  ["StudyDailyMetric", ["id"], () => prisma.studyDailyMetric.findMany({ select: { id: true } })],

  // Mastery/retention private projections.
  ["private_mastery", ["user_id", "lecture_id"], () => prisma.lectureMastery.findMany({
    select: { userId: true, lectureId: true },
  }).then((rows) => rows.map((row) => ({ user_id: row.userId, lecture_id: row.lectureId })))],
  ["private_retention", ["user_id", "lecture_id"], () => prisma.lectureRetention.findMany({
    select: { userId: true, lectureId: true },
  }).then((rows) => rows.map((row) => ({ user_id: row.userId, lecture_id: row.lectureId })))],
  ["private_mastery_projection_state", ["user_id"], () => prisma.masteryD1ProjectionState.findMany({
    select: { userId: true },
  }).then((rows) => rows.map((row) => ({ user_id: row.userId })))],
];

const derivedLeaderboardTables = [
  "leaderboard_cache_entries",
  "leaderboard_cache_chunks",
  "leaderboard_cache_current",
  "leaderboard_cache_snapshots",
  "leaderboard_cache_nonces",
];

async function ensureNoPendingOutbox() {
  const [privatePending, leaderboardPending] = await Promise.all([
    prisma.privateD1SyncOutbox.count({
      where: { state: { in: ["PENDING", "RETRY", "LEASED"] } },
    }),
    prisma.leaderboardD1SyncOutbox.count({
      where: { state: { in: ["PENDING", "RETRY", "LEASED"] } },
    }),
  ]);

  if (APPLY && (privatePending > 0 || leaderboardPending > 0)) {
    throw new Error(
      `Refusing apply while D1 outboxes are active (private=${privatePending}, leaderboard=${leaderboardPending}). Drain/replay them first.`,
    );
  }

  return { privatePending, leaderboardPending };
}

function r2Config() {
  const endpoint = String(process.env.R2_ENDPOINT || "").trim().replace(/\/+$/, "");
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || "").trim();
  const bucket = String(process.env.R2_BUCKET_NAME || "99s-guide-files").trim();
  const region = String(process.env.R2_REGION || "auto").trim() || "auto";

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return null;

  return {
    client: new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
  };
}

function avatarStorageKey(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();

  if (text.startsWith("avatars/")) return text;
  try {
    const url = new URL(text);
    const key = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    return key.startsWith("avatars/") ? key : null;
  } catch {
    return null;
  }
}

async function canonicalR2Keys() {
  const [materials, resources, multipartRows, users] = await Promise.all([
    prisma.material.findMany({
      where: { storagePath: { not: null } },
      select: { storagePath: true },
    }),
    prisma.moduleResource.findMany({
      where: { storagePath: { not: "" } },
      select: { storagePath: true, multipartUploadId: true },
    }),
    prisma.resourceMultipartUpload.findMany({
      select: { storagePath: true, multipartUploadId: true },
    }),
    prisma.user.findMany({
      select: { avatarUrl: true, avatar: true },
    }),
  ]);

  const keys = new Set();
  for (const row of materials) if (row.storagePath) keys.add(row.storagePath);
  for (const row of resources) if (row.storagePath) keys.add(row.storagePath);
  for (const row of multipartRows) if (row.storagePath) keys.add(row.storagePath);
  for (const user of users) {
    const avatarUrlKey = avatarStorageKey(user.avatarUrl);
    const avatarKey = avatarStorageKey(user.avatar);
    if (avatarUrlKey) keys.add(avatarUrlKey);
    if (avatarKey) keys.add(avatarKey);
  }

  const activeMultipart = new Set();
  for (const row of resources) {
    if (row.storagePath && row.multipartUploadId) {
      activeMultipart.add(`${row.storagePath}\u0000${row.multipartUploadId}`);
    }
  }
  for (const row of multipartRows) {
    if (row.storagePath && row.multipartUploadId) {
      activeMultipart.add(`${row.storagePath}\u0000${row.multipartUploadId}`);
    }
  }

  return { keys, activeMultipart };
}

async function listAllR2Objects(client, bucket) {
  const objects = [];
  let continuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }));
    for (const item of page.Contents || []) {
      if (item.Key) objects.push(item.Key);
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

async function listAllMultipartUploads(client, bucket) {
  const uploads = [];
  let keyMarker;
  let uploadIdMarker;

  do {
    const page = await client.send(new ListMultipartUploadsCommand({
      Bucket: bucket,
      KeyMarker: keyMarker,
      UploadIdMarker: uploadIdMarker,
      MaxUploads: 1000,
    }));

    for (const upload of page.Uploads || []) {
      if (upload.Key && upload.UploadId) {
        uploads.push({ key: upload.Key, uploadId: upload.UploadId });
      }
    }

    if (!page.IsTruncated) break;
    keyMarker = page.NextKeyMarker;
    uploadIdMarker = page.NextUploadIdMarker;
  } while (true);

  return uploads;
}

async function deleteR2Objects(client, bucket, keys) {
  if (!APPLY || keys.length === 0) return 0;
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Quiet: true,
        Objects: batch.map((Key) => ({ Key })),
      },
    }));
    deleted += batch.length;
  }
  return deleted;
}

async function abortMultipartUploads(client, bucket, uploads) {
  if (!APPLY || uploads.length === 0) return 0;
  let aborted = 0;
  for (const upload of uploads) {
    await client.send(new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: upload.key,
      UploadId: upload.uploadId,
    }));
    aborted += 1;
  }
  return aborted;
}

const report = {
  mode: APPLY ? "APPLY" : "DRY_RUN",
  canonicalSource: "PostgreSQL / Supabase via Prisma",
  cloudflare: {
    d1DatabaseId: databaseId,
    tables: [],
    derivedCaches: [],
    r2: null,
  },
  outboxes: null,
  safety: {
    postgresMutated: false,
    validR2ObjectsAreDeleted: false,
    note: "Only Cloudflare rows/objects absent from the canonical PostgreSQL/Supabase dataset are eligible for deletion.",
  },
};

try {
  report.outboxes = await ensureNoPendingOutbox();
  const d1Tables = await listD1Tables();

  for (const [table, keyColumns, loader] of tableSpecs) {
    if (!d1Tables.has(table)) {
      report.cloudflare.tables.push({
        table,
        status: "TABLE_NOT_PRESENT",
        canonical: null,
        cloudflare: null,
        orphaned: 0,
        deleted: 0,
      });
      continue;
    }

    const [canonical, d1Rows] = await Promise.all([
      canonicalKeys(loader, keyColumns),
      readAllD1Keys(table, keyColumns),
    ]);

    const orphanRows = d1Rows.filter((row) => !canonical.has(keyOf(row, keyColumns)));
    const deleted = await deleteD1Rows(table, keyColumns, orphanRows);

    report.cloudflare.tables.push({
      table,
      status: "CHECKED",
      canonical: canonical.size,
      cloudflare: d1Rows.length,
      orphaned: orphanRows.length,
      deleted,
      sampleOrphans: orphanRows.slice(0, SAMPLE_LIMIT),
    });
  }

  // Leaderboard D1 is entirely derived from canonical PostgreSQL snapshots.
  // Clearing it is safe during this controlled reconciliation; normal fallback
  // and snapshot projection rebuild it from PostgreSQL afterward.
  for (const table of derivedLeaderboardTables) {
    if (!d1Tables.has(table)) {
      report.cloudflare.derivedCaches.push({ table, status: "TABLE_NOT_PRESENT", rows: 0, deleted: 0 });
      continue;
    }
    const countRows = await d1Query(`SELECT COUNT(*) AS count FROM ${q(table)}`);
    const count = Number(countRows?.[0]?.count || 0);
    if (APPLY && count > 0) await d1Query(`DELETE FROM ${q(table)}`);
    report.cloudflare.derivedCaches.push({
      table,
      status: "DERIVED_CACHE",
      rows: count,
      deleted: APPLY ? count : 0,
    });
  }

  const r2 = r2Config();
  if (!r2) {
    report.cloudflare.r2 = {
      status: "SKIPPED_R2_NOT_CONFIGURED",
      orphanObjects: 0,
      deletedObjects: 0,
      orphanMultipartUploads: 0,
      abortedMultipartUploads: 0,
    };
  } else {
    const [{ keys: canonicalKeysSet, activeMultipart }, allObjects, allUploads] = await Promise.all([
      canonicalR2Keys(),
      listAllR2Objects(r2.client, r2.bucket),
      listAllMultipartUploads(r2.client, r2.bucket),
    ]);

    const orphanObjects = allObjects.filter((key) => !canonicalKeysSet.has(key));
    const orphanUploads = allUploads.filter(
      (upload) => !activeMultipart.has(`${upload.key}\u0000${upload.uploadId}`),
    );

    const deletedObjects = await deleteR2Objects(r2.client, r2.bucket, orphanObjects);
    const abortedMultipartUploads = await abortMultipartUploads(r2.client, r2.bucket, orphanUploads);

    report.cloudflare.r2 = {
      status: "CHECKED",
      bucket: r2.bucket,
      canonicalReferencedObjects: canonicalKeysSet.size,
      cloudflareObjects: allObjects.length,
      orphanObjects: orphanObjects.length,
      deletedObjects,
      sampleOrphanObjects: orphanObjects.slice(0, SAMPLE_LIMIT),
      cloudflareMultipartUploads: allUploads.length,
      orphanMultipartUploads: orphanUploads.length,
      abortedMultipartUploads,
      sampleOrphanMultipartUploads: orphanUploads.slice(0, SAMPLE_LIMIT),
    };
  }

  console.log(JSON.stringify(report, null, 2));
  if (!APPLY) {
    console.log(
      `\nDRY RUN ONLY. Nothing was deleted.\nTo apply exactly this reconciliation, set CLOUDFLARE_RECONCILE_CONFIRM=${CONFIRM_VALUE} and run with --apply.`,
    );
  }
} finally {
  await prisma.$disconnect();
}
