import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();

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

const SPECS = [
  {
    "source": "User",
    "entity": "User",
    "pk": [
      "id"
    ],
    "dataExpr": "to_jsonb(t) - 'passwordHash' - 'socketId' - 'deviceToken' - 'signature'",
    "where": null
  },
  {
    "source": "FlashcardProgress",
    "entity": "FlashcardProgress",
    "pk": [
      "id"
    ],
    "dataExpr": "to_jsonb(t)",
    "where": null
  },
  {
    "source": "LectureProgress",
    "entity": "LectureProgress",
    "pk": [
      "userId",
      "lectureId"
    ],
    "dataExpr": "to_jsonb(t)",
    "where": null
  },
  {
    "source": "ModerationHistory",
    "entity": "ModerationHistory",
    "pk": [
      "id"
    ],
    "dataExpr": "to_jsonb(t)",
    "where": null
  },
  {
    "source": "Notification",
    "entity": "Notification",
    "pk": [
      "id"
    ],
    "dataExpr": "to_jsonb(t)",
    "where": null
  },
  {
    "source": "PointsLog",
    "entity": "PointsLog",
    "pk": [
      "id"
    ],
    "dataExpr": "to_jsonb(t)",
    "where": null
  },
  {
    "source": "QaAnswer",
    "entity": "QaAnswer",
    "pk": [
      "id"
    ],
    "dataExpr": "to_jsonb(t)",
    "where": null
  },
  {
    "source": "QaQuestion",
    "entity": "QaQuestion",
    "pk": [
      "id"
    ],
    "dataExpr": "to_jsonb(t)",
    "where": null
  },
  {
    "source": "QaVote",
    "entity": "QaVote",
    "pk": [
      "id"
    ],
    "dataExpr": "to_jsonb(t)",
    "where": null
  },
  {
    "source": "Report",
    "entity": "Report",
    "pk": [
      "id"
    ],
    "dataExpr": "to_jsonb(t)",
    "where": null
  },
  {
    "source": "SmartNotification",
    "entity": "SmartNotification",
    "pk": [
      "id"
    ],
    "dataExpr": "to_jsonb(t)",
    "where": null
  },
  {
    "source": "UserBan",
    "entity": "UserBan",
    "pk": [
      "id"
    ],
    "dataExpr": "to_jsonb(t)",
    "where": null
  },
  {
    "source": "UserBlock",
    "entity": "UserBlock",
    "pk": [
      "id"
    ],
    "dataExpr": "to_jsonb(t)",
    "where": null
  },
  {
    "source": "UserMute",
    "entity": "UserMute",
    "pk": [
      "id"
    ],
    "dataExpr": "to_jsonb(t)",
    "where": null
  },
  {
    "source": "UserProgress",
    "entity": "UserProgress",
    "pk": [
      "id"
    ],
    "dataExpr": "to_jsonb(t)",
    "where": null
  },
  {
    "source": "CalendarEvent",
    "entity": "UserCalendarEvent",
    "pk": [
      "id"
    ],
    "dataExpr": "to_jsonb(t)",
    "where": "\"userId\" IS NOT NULL"
  }
];

function q(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function triggerName(source) {
  return `private_d1_sync_${source}`;
}

function keyExpression(alias, pk) {
  const parts = pk.flatMap((col) => [`'${col}'`, `${alias}.${q(col)}`]);
  return `jsonb_build_object(${parts.join(", ")})`;
}

const createTable = `
CREATE TABLE IF NOT EXISTS "PrivateD1SyncOutbox" (
  "id" BIGSERIAL PRIMARY KEY,
  "dedupeKey" TEXT NOT NULL UNIQUE,
  "entity" TEXT NOT NULL,
  "operation" TEXT NOT NULL CHECK ("operation" IN ('upsert', 'delete')),
  "key" JSONB NOT NULL,
  "data" JSONB,
  "revision" BIGINT NOT NULL DEFAULT 1,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
)`;

const createFunction = `
CREATE OR REPLACE FUNCTION private_d1_enqueue_mirror()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  row_json JSONB;
  old_json JSONB;
  key_json JSONB := '{}'::jsonb;
  pk_cols TEXT[];
  pk_col TEXT;
  entity_name TEXT := TG_ARGV[0];
  dedupe_key TEXT;
  op TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_json := to_jsonb(OLD);
  ELSE
    row_json := to_jsonb(NEW);
  END IF;

  -- Existing D1 CalendarEvent is GLOBAL-only. Personal rows use the dedicated
  -- UserCalendarEvent private mirror.
  IF TG_TABLE_NAME = 'CalendarEvent' AND COALESCE(row_json ->> 'userId', '') = '' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Never place credentials, live socket identity, APNs/device token, or the
  -- Base64 signature field into the D1 private mirror.
  IF TG_TABLE_NAME = 'User' THEN
    row_json := row_json
      - 'passwordHash'
      - 'socketId'
      - 'deviceToken'
      - 'signature';

    IF TG_OP = 'UPDATE' THEN
      old_json := to_jsonb(OLD)
        - 'passwordHash'
        - 'socketId'
        - 'deviceToken'
        - 'signature';

      IF old_json = row_json THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  pk_cols := string_to_array(TG_ARGV[1], ',');
  FOREACH pk_col IN ARRAY pk_cols LOOP
    key_json := key_json || jsonb_build_object(pk_col, row_json -> pk_col);
  END LOOP;

  dedupe_key := entity_name || ':' || key_json::text;
  op := CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END;

  INSERT INTO "PrivateD1SyncOutbox" (
    "dedupeKey", "entity", "operation", "key", "data",
    "revision", "attempts", "nextAttemptAt", "lastError", "createdAt", "updatedAt"
  )
  VALUES (
    dedupe_key,
    entity_name,
    op,
    key_json,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_json END,
    1,
    0,
    NOW(),
    NULL,
    NOW(),
    NOW()
  )
  ON CONFLICT ("dedupeKey") DO UPDATE SET
    "entity" = EXCLUDED."entity",
    "operation" = EXCLUDED."operation",
    "key" = EXCLUDED."key",
    "data" = EXCLUDED."data",
    "revision" = "PrivateD1SyncOutbox"."revision" + 1,
    "attempts" = 0,
    "nextAttemptAt" = NOW(),
    "lastError" = NULL,
    "updatedAt" = NOW();

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
$$`;

try {
  console.log("99's Guide — Stage 8D-2B Transaction-Safe Outbox Installer");
  console.log("-----------------------------------------------------------");
  console.log("Target: Supabase/PostgreSQL");
  console.log("");

  await prisma.$executeRawUnsafe(createTable);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "PrivateD1SyncOutbox_nextAttemptAt_idx"
     ON "PrivateD1SyncOutbox" ("nextAttemptAt", "id")`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "PrivateD1SyncOutbox_entity_idx"
     ON "PrivateD1SyncOutbox" ("entity")`
  );
  await prisma.$executeRawUnsafe(createFunction);

  for (const spec of SPECS) {
    const name = triggerName(spec.source);
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${q(name)} ON ${q(spec.source)}`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${q(name)}
       AFTER INSERT OR UPDATE OR DELETE ON ${q(spec.source)}
       FOR EACH ROW
       EXECUTE FUNCTION private_d1_enqueue_mirror('${spec.entity}', '${spec.pk.join(",")}')`
    );
  }

  // Reconcile all current canonical rows into the outbox AFTER triggers exist.
  // This closes the Stage 8C -> Stage 8D installation race window.
  for (const spec of SPECS) {
    const keyExpr = keyExpression("t", spec.pk);
    const where = spec.where ? `WHERE ${spec.where}` : "";
    const dataExpr =
      spec.source === "User"
        ? `to_jsonb(t) - 'passwordHash' - 'socketId' - 'deviceToken' - 'signature'`
        : `to_jsonb(t)`;

    await prisma.$executeRawUnsafe(`
      INSERT INTO "PrivateD1SyncOutbox" (
        "dedupeKey", "entity", "operation", "key", "data",
        "revision", "attempts", "nextAttemptAt", "lastError", "createdAt", "updatedAt"
      )
      SELECT
        '${spec.entity}:' || (${keyExpr})::text,
        '${spec.entity}',
        'upsert',
        ${keyExpr},
        ${dataExpr},
        1,
        0,
        NOW(),
        NULL,
        NOW(),
        NOW()
      FROM ${q(spec.source)} AS t
      ${where}
      ON CONFLICT ("dedupeKey") DO UPDATE SET
        "entity" = EXCLUDED."entity",
        "operation" = 'upsert',
        "key" = EXCLUDED."key",
        "data" = EXCLUDED."data",
        "revision" = "PrivateD1SyncOutbox"."revision" + 1,
        "attempts" = 0,
        "nextAttemptAt" = NOW(),
        "lastError" = NULL,
        "updatedAt" = NOW()
    `);
  }

  const triggerRows = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS count
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname LIKE 'private_d1_sync_%'
  `);

  const pendingRows = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS count
    FROM "PrivateD1SyncOutbox"
  `);

  const triggerCount = Number(triggerRows?.[0]?.count || 0);
  const pendingCount = Number(pendingRows?.[0]?.count || 0);

  console.log(`Installed private mirror triggers: ${triggerCount} / 16`);
  console.log(`Seeded/reconciled outbox rows: ${pendingCount}`);
  console.log("");
  console.log("No application read path was changed.");
  console.log("D1 was not modified by this installer.");
  console.log(
    triggerCount === 16
      ? "STAGE 8D-2B OUTBOX INSTALL PASS"
      : "STAGE 8D-2B OUTBOX INSTALL FAIL"
  );

  process.exitCode = triggerCount === 16 ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
