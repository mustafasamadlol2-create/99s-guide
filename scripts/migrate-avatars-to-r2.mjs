import "dotenv/config";
import crypto from "node:crypto";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const LIMIT = limitArg
  ? Math.max(1, Math.min(Number.parseInt(limitArg.split("=")[1] || "0", 10) || 0, 1000))
  : 1000;

const DEFAULT_BUCKET = "99s-guide-files";
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const MIME_TO_EXTENSION = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function getR2Config() {
  return {
    endpoint: requireEnv("R2_ENDPOINT").replace(/\/+$/, ""),
    accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    bucket: (process.env.R2_BUCKET_NAME || DEFAULT_BUCKET).trim(),
    region: (process.env.R2_REGION || "auto").trim() || "auto",
    publicBaseUrl: requireEnv("CONTENT_WORKER_BASE_URL").replace(/\/+$/, ""),
  };
}

function parseAvatarDataUrl(value) {
  if (typeof value !== "string") return null;

  const match = value.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i,
  );

  if (!match) return null;

  const mimeType = match[1].toLowerCase();
  const extension = MIME_TO_EXTENSION[mimeType];
  if (!extension) return null;

  const buffer = Buffer.from(match[2], "base64");

  if (buffer.length === 0 || buffer.length > MAX_AVATAR_BYTES) {
    return {
      supported: false,
      reason: `invalid size (${buffer.length} bytes)`,
      mimeType,
    };
  }

  let validMagic = false;

  if (mimeType === "image/jpeg") {
    validMagic =
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff;
  } else if (mimeType === "image/png") {
    validMagic =
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47;
  } else if (mimeType === "image/webp") {
    validMagic =
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }

  if (!validMagic) {
    return {
      supported: false,
      reason: "file signature does not match MIME type",
      mimeType,
    };
  }

  return {
    supported: true,
    mimeType,
    extension,
    buffer,
  };
}

function safeUserId(userId) {
  const safe = String(userId).replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!safe) throw new Error("Invalid user ID.");
  return safe;
}

function formatMb(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

async function main() {
  // DRY RUN intentionally requires only the database connection.
  // R2 credentials and CONTENT_WORKER_BASE_URL are loaded only when --apply is used.
  const config = APPLY ? getR2Config() : null;

  const r2 = APPLY && config
    ? new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      })
    : null;

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { avatar: { startsWith: "data:image/" } },
        { avatarUrl: { startsWith: "data:image/" } },
      ],
    },
    select: {
      id: true,
      avatar: true,
      avatarUrl: true,
    },
    orderBy: {
      id: "asc",
    },
    take: LIMIT,
  });

  console.log("");
  console.log("99's Guide — Avatar R2 Migration");
  console.log("--------------------------------");
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN (no changes)"}`);
  console.log(`Rows selected: ${users.length}`);
  console.log("");

  if (users.length === 0) {
    console.log("No Base64 avatars remain. Nothing to migrate.");
    return;
  }

  const mimeCounts = {};
  let supportedCount = 0;
  let unsupportedCount = 0;
  let duplicatedCount = 0;
  let totalDecodedBytes = 0;

  const prepared = [];

  for (const user of users) {
    const avatar = user.avatar || "";
    const avatarUrl = user.avatarUrl || "";

    if (avatar.startsWith("data:image/") && avatarUrl === avatar) {
      duplicatedCount += 1;
    }

    // Stage-1 audit confirmed the legacy rows are duplicated in both fields.
    // Fail closed if a row has diverged instead of guessing which value wins.
    if (
      !avatar.startsWith("data:image/") ||
      !avatarUrl.startsWith("data:image/") ||
      avatar !== avatarUrl
    ) {
      unsupportedCount += 1;
      prepared.push({
        user,
        ok: false,
        reason: "avatar/avatarUrl are not the same Base64 value",
      });
      continue;
    }

    const parsed = parseAvatarDataUrl(avatar);

    if (!parsed || parsed.supported !== true) {
      unsupportedCount += 1;
      prepared.push({
        user,
        ok: false,
        reason: parsed?.reason || "unsupported image format",
      });
      continue;
    }

    mimeCounts[parsed.mimeType] = (mimeCounts[parsed.mimeType] || 0) + 1;
    supportedCount += 1;
    totalDecodedBytes += parsed.buffer.length;

    const contentHash = crypto
      .createHash("sha256")
      .update(parsed.buffer)
      .digest("hex")
      .slice(0, 32);

    const storagePath =
      `avatars/${safeUserId(user.id)}/${contentHash}.${parsed.extension}`;

    const publicUrl = config
      ? `${config.publicBaseUrl}/${storagePath}`
      : `(dry-run)/${storagePath}`;

    prepared.push({
      user,
      ok: true,
      parsed,
      storagePath,
      publicUrl,
    });
  }

  console.log("Audit:");
  console.log(`  Supported rows: ${supportedCount}`);
  console.log(`  Unsupported/unsafe rows: ${unsupportedCount}`);
  console.log(`  Exact duplicated Base64 rows: ${duplicatedCount}`);
  console.log(`  Decoded image bytes: ${formatMb(totalDecodedBytes)} MB`);
  console.log(
    `  MIME types: ${
      Object.entries(mimeCounts)
        .map(([mime, count]) => `${mime}=${count}`)
        .join(", ") || "none"
    }`,
  );
  console.log("");

  for (const item of prepared) {
    const shortId =
      item.user.id.length > 18
        ? `${item.user.id.slice(0, 14)}...`
        : item.user.id;

    if (!item.ok) {
      console.log(`SKIP ${shortId}: ${item.reason}`);
      continue;
    }

    if (!APPLY) {
      console.log(`READY ${shortId} -> ${item.storagePath}`);
      continue;
    }

    let uploaded = false;

    try {
      if (!r2 || !config) {
        throw new Error("R2 configuration is unavailable in apply mode.");
      }

      await r2.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: item.storagePath,
          Body: item.parsed.buffer,
          ContentType: item.parsed.mimeType,
          ContentDisposition: "inline",
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );

      uploaded = true;

      // Optimistic concurrency guard:
      // only replace the DB row if BOTH legacy fields are still exactly the
      // Base64 value we audited. If the user changed their photo during this
      // migration, count=0 and we leave their newer photo untouched.
      const updated = await prisma.user.updateMany({
        where: {
          id: item.user.id,
          avatar: item.user.avatar,
          avatarUrl: item.user.avatarUrl,
        },
        data: {
          avatar: item.publicUrl,
          avatarUrl: item.publicUrl,
        },
      });

      if (updated.count !== 1) {
        if (!r2 || !config) {
          throw new Error("R2 configuration is unavailable during rollback.");
        }
        await r2.send(
          new DeleteObjectCommand({
            Bucket: config.bucket,
            Key: item.storagePath,
          }),
        );

        console.log(
          `SKIP ${shortId}: row changed during migration; uploaded object removed`,
        );
        continue;
      }

      console.log(`OK   ${shortId} -> ${item.publicUrl}`);
    } catch (error) {
      if (uploaded) {
        try {
          if (!r2 || !config) {
            throw new Error("R2 configuration is unavailable during rollback.");
          }
          await r2.send(
            new DeleteObjectCommand({
              Bucket: config.bucket,
              Key: item.storagePath,
            }),
          );
        } catch {
          // Best-effort rollback only.
        }
      }

      console.log(
        `FAIL ${shortId}: ${
          error instanceof Error ? error.message.slice(0, 180) : "unknown error"
        }`,
      );
    }
  }

  if (!APPLY) {
    console.log("");
    console.log(
      "DRY RUN COMPLETE — no R2 objects were uploaded and no database rows were changed.",
    );
    console.log(
      "Do not use --apply until the dry-run output has been reviewed.",
    );
    return;
  }

  const remaining = await prisma.user.count({
    where: {
      OR: [
        { avatar: { startsWith: "data:image/" } },
        { avatarUrl: { startsWith: "data:image/" } },
      ],
    },
  });

  console.log("");
  console.log(`APPLY COMPLETE — Base64 avatar rows remaining: ${remaining}`);
}

main()
  .catch((error) => {
    console.error("");
    console.error(
      "Migration aborted:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
