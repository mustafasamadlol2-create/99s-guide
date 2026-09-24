import { getPrisma } from "./prismaClient.js";
import { logger } from "./logger.js";

type PrivateMirrorEntity =
  | "User"
  | "FlashcardProgress"
  | "LectureProgress"
  | "ModerationHistory"
  | "Notification"
  | "PointsLog"
  | "QaAnswer"
  | "QaQuestion"
  | "QaVote"
  | "Report"
  | "SmartNotification"
  | "UserBan"
  | "UserBlock"
  | "UserMute"
  | "UserProgress"
  | "UserCalendarEvent"
  | "FocusPlan"
  | "FocusSession"
  | "StudyDailyMetric";

const PROJECTION_ENTITIES = new Set<PrivateMirrorEntity>([
  "FocusPlan",
  "FocusSession",
  "StudyDailyMetric",
]);

export type PrivateD1SyncOutboxRow = {
  id: string;
  revision: string;
  entity: PrivateMirrorEntity;
  operation: "upsert" | "delete";
  key: Record<string, unknown>;
  data: Record<string, unknown> | null;
  attempts: number;
};

type OutboxExecutor = {
  $queryRawUnsafe<T = unknown>(query: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...args: unknown[]): Promise<number>;
};

/**
 * Enqueues an already-built projection through the caller's transaction-capable
 * Prisma executor. One outbox identity-sequence value is explicitly written to
 * both id and revision; gaps on rollback are intentional and harmless.
 *
 * This does not coalesce pending rows. The existing drainer remains responsible
 * for delivery/retry, and the Worker rejects stale revisions.
 */
export async function enqueuePrivateD1Projection(
  executor: Pick<OutboxExecutor, "$queryRawUnsafe">,
  input: {
    entity: "FocusPlan" | "FocusSession" | "StudyDailyMetric";
    key: { id: string };
    data: Record<string, unknown>;
  },
): Promise<string> {
  if (!PROJECTION_ENTITIES.has(input.entity)) {
    throw new Error("Unsupported private D1 projection entity.");
  }

  const rows = await executor.$queryRawUnsafe<Array<{ id: string; revision: string }>>(
    `WITH allocated_revision AS (
       SELECT nextval(
         pg_get_serial_sequence('"PrivateD1SyncOutbox"', 'id')
       )::bigint AS value
     )
     INSERT INTO "PrivateD1SyncOutbox"
       ("id", "entity", "operation", "key", "revision", "data", "attempts", "lastError", "nextAttemptAt", "updatedAt")
     SELECT
       allocated_revision.value,
       $1,
       'upsert',
       $2::jsonb,
       allocated_revision.value,
       jsonb_set($3::jsonb, '{revision}', to_jsonb(allocated_revision.value::text), true),
       0,
       NULL,
       NOW(),
       NOW()
     FROM allocated_revision
      RETURNING "id"::text AS "id", "revision"::text AS "revision"`,
    input.entity,
    JSON.stringify(input.key),
    JSON.stringify(input.data),
  );
  const row = Array.isArray(rows) ? rows[0] : undefined;
  const revision = row?.revision;
  if (
    typeof row?.id !== "string" ||
    typeof revision !== "string" ||
    !/^\d+$/.test(revision) ||
    row.id !== revision
  ) {
    throw new Error("Private D1 projection outbox did not return a valid revision.");
  }
  return revision;
}

const DATE_FIELDS: Record<PrivateMirrorEntity, string[]> = {
  "User": [
    "lastActive",
    "lastSeen",
    "createdAt",
    "updatedAt"
  ],
  "FlashcardProgress": [
    "updatedAt"
  ],
  "LectureProgress": [
    "lastAccessed"
  ],
  "ModerationHistory": [
    "createdAt",
    "expiresAt",
    "revokedAt"
  ],
  "Notification": [
    "createdAt"
  ],
  "PointsLog": [
    "createdAt"
  ],
  "QaAnswer": [
    "createdAt",
    "updatedAt"
  ],
  "QaQuestion": [
    "createdAt",
    "updatedAt"
  ],
  "QaVote": [
    "createdAt"
  ],
  "Report": [
    "createdAt"
  ],
  "SmartNotification": [
    "sentAt"
  ],
  "UserBan": [
    "startTime",
    "endTime",
    "createdAt"
  ],
  "UserBlock": [
    "createdAt"
  ],
  "UserMute": [
    "startTime",
    "endTime",
    "createdAt"
  ],
  "UserProgress": [
    "createdAt",
    "updatedAt"
  ],
  "UserCalendarEvent": [
    "startDateTime",
    "endDateTime"
  ],
  "FocusPlan": [
    "createdAt",
    "updatedAt",
    "archivedAt",
    "deletedAt"
  ],
  "FocusSession": [
    "startedAt",
    "plannedEndAt",
    "actualEndedAt",
    "lastCheckpointAt",
    "updatedAt",
    "deletedAt"
  ],
  "StudyDailyMetric": [
    "updatedAt",
    "deletedAt"
  ]
} as Record<PrivateMirrorEntity, string[]>;

const DEFAULT_POLL_MS = 15_000;
const MIN_POLL_MS = 5_000;
const MAX_POLL_MS = 300_000;
const BATCH_SIZE = 25;
const LEASE_MS = 60_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let stopping = false;
let enabledLogEmitted = false;

function boolEnv(name: string): boolean {
  const value = String(process.env[name] || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function getPollMs(): number {
  const raw = Number(process.env.PRIVATE_D1_SYNC_POLL_MS || DEFAULT_POLL_MS);
  if (!Number.isFinite(raw)) return DEFAULT_POLL_MS;
  return Math.max(MIN_POLL_MS, Math.min(MAX_POLL_MS, Math.trunc(raw)));
}

function getConfig(): { baseUrl: string; secret: string } | null {
  const baseUrl = String(process.env.PRIVATE_DATA_WORKER_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  const secret = String(process.env.PRIVATE_DATA_SYNC_SECRET || "").trim();
  if (!baseUrl || !secret) return null;
  return { baseUrl, secret };
}

function normalizeDateText(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed) return value;

  // PostgreSQL timestamp without time zone JSON is emitted without a timezone.
  // Prisma treats these application timestamps as UTC, so mirror the Stage 8C
  // representation by converting them to ISO-8601 UTC.
  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(trimmed);
  const candidate = hasZone ? trimmed : `${trimmed}Z`;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

function canonicalizeData(
  entity: PrivateMirrorEntity,
  data: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!data) return null;
  const copy: Record<string, unknown> = { ...data };
  for (const field of DATE_FIELDS[entity] || []) {
    if (Object.prototype.hasOwnProperty.call(copy, field)) {
      copy[field] = normalizeDateText(copy[field]);
    }
  }
  return copy;
}

export async function postPrivateD1SyncMutation(
  row: PrivateD1SyncOutboxRow,
): Promise<void> {
  const config = getConfig();
  if (!config) throw new Error("Private D1 Worker configuration is missing.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const data = canonicalizeData(row.entity, row.data);
    const isProjection = PROJECTION_ENTITIES.has(row.entity);
    const projectionMetadata = isProjection
      ? {
          projectionVersion: Number(data?.projectionVersion ?? 1),
          userScope: data?.userScope ?? data?.userId ?? row.key.userId,
          ...(data?.updatedAt ? { updatedAt: data.updatedAt } : {}),
          ...(data?.deletedAt ? { deletedAt: data.deletedAt } : {}),
        }
      : {};
    const response = await fetch(`${config.baseUrl}/internal/private-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Private-Data-Sync-Secret": config.secret,
      },
      body: JSON.stringify({
        version: 1,
        entity: row.entity,
        operation: row.operation,
        key: row.key,
        revision: row.revision,
        ...projectionMetadata,
        ...(data ? { data } : {}),
        occurredAt: new Date().toISOString(),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Private D1 Worker HTTP ${response.status}: ${text.slice(0, 180)}`,
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function leasePrivateD1SyncOutboxBatch(
  executor: OutboxExecutor = getPrisma(),
): Promise<PrivateD1SyncOutboxRow[]> {
  const rows = await executor.$queryRawUnsafe(`
    WITH picked AS (
      SELECT "id"
      FROM "PrivateD1SyncOutbox"
      WHERE "nextAttemptAt" <= NOW()
      ORDER BY "id" ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "PrivateD1SyncOutbox" AS o
    SET
      "attempts" = o."attempts" + 1,
      "nextAttemptAt" = NOW() + INTERVAL '${Math.trunc(LEASE_MS / 1000)} seconds',
      "updatedAt" = NOW()
    FROM picked
    WHERE o."id" = picked."id"
    RETURNING
      o."id"::text AS "id",
      o."revision"::text AS "revision",
      o."entity",
      o."operation",
      o."key",
      o."data",
      o."attempts"
  `);

  return Array.isArray(rows) ? rows as PrivateD1SyncOutboxRow[] : [];
}

export async function acknowledgePrivateD1SyncOutboxRow(
  row: PrivateD1SyncOutboxRow,
  executor: OutboxExecutor = getPrisma(),
): Promise<number> {
  return executor.$executeRawUnsafe(
    `DELETE FROM "PrivateD1SyncOutbox"
     WHERE "id" = $1::bigint
       AND "revision" = $2::bigint
       AND "attempts" = $3`,
    row.id,
    row.revision,
    row.attempts,
  );
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [REDACTED]")
    .replace(
      /"(?:authorization|x-private-data-sync-secret|access[_-]?token|refresh[_-]?token|token|password|secret)"\s*:\s*"[^"]*"/giu,
      '"[REDACTED_FIELD]":"[REDACTED]"',
    )
    .replace(
      /\b(?:authorization|x-private-data-sync-secret|access[_-]?token|refresh[_-]?token|token|password|secret)\b\s*[:=]\s*[^\s,;]+/giu,
      "[REDACTED_FIELD]=[REDACTED]",
    )
    .slice(0, 500);
}

export async function markPrivateD1SyncOutboxRowFailure(
  row: PrivateD1SyncOutboxRow,
  error: unknown,
  executor: OutboxExecutor = getPrisma(),
): Promise<number> {
  const message = safeErrorMessage(error);
  const attempts = Math.max(1, Number(row.attempts) || 1);
  const retrySeconds = Math.min(300, 15 * Math.pow(2, Math.min(attempts - 1, 5)));

  return executor.$executeRawUnsafe(
    `UPDATE "PrivateD1SyncOutbox"
     SET
       "lastError" = $4,
       "nextAttemptAt" = NOW() + ($5::text || ' seconds')::interval,
       "updatedAt" = NOW()
     WHERE "id" = $1::bigint
       AND "revision" = $2::bigint
       AND "attempts" = $3`,
    row.id,
    row.revision,
    row.attempts,
    message,
    String(retrySeconds),
  ).catch(() => 0);
}

function schedule(delayMs: number): void {
  if (stopping || timer) return;
  timer = setTimeout(() => {
    timer = null;
    void drainPrivateD1SyncOutbox();
  }, delayMs);
  if (typeof timer.unref === "function") timer.unref();
}

export async function drainPrivateD1SyncOutbox(): Promise<void> {
  if (running || stopping) return;
  if (!boolEnv("PRIVATE_D1_WRITE_MIRROR_ENABLED")) return;
  if (!getConfig()) return;

  running = true;
  let batchWasFull = false;

  try {
    const rows = await leasePrivateD1SyncOutboxBatch();
    batchWasFull = rows.length === BATCH_SIZE;

    for (const row of rows) {
      try {
        await postPrivateD1SyncMutation(row);
        await acknowledgePrivateD1SyncOutboxRow(row);
      } catch (error) {
        await markPrivateD1SyncOutboxRowFailure(row, error);
        logger.warn(
          "[PrivateD1Sync]",
          `Pending mutation ${row.entity}/${row.operation} remains queued: ` +
          safeErrorMessage(error),
        );
      }
    }
  } catch (error) {
    logger.warn(
      "[PrivateD1Sync]",
      `Outbox drain failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    running = false;
  }

  schedule(batchWasFull ? 250 : getPollMs());
}

export function startPrivateD1SyncDrainer(): void {
  stopping = false;

  if (!boolEnv("PRIVATE_D1_WRITE_MIRROR_ENABLED")) {
    logger.info(
      "[PrivateD1Sync]",
      "Private D1 write mirror is installed but DISABLED. Supabase remains authoritative and outbox rows will queue safely.",
    );
    return;
  }

  if (!getConfig()) {
    logger.warn(
      "[PrivateD1Sync]",
      "PRIVATE_D1_WRITE_MIRROR_ENABLED is on but PRIVATE_DATA_WORKER_BASE_URL or PRIVATE_DATA_SYNC_SECRET is missing. Outbox rows will remain queued.",
    );
    return;
  }

  if (!enabledLogEmitted) {
    enabledLogEmitted = true;
    logger.info(
      "[PrivateD1Sync]",
      `Private D1 write mirror ENABLED; poll=${getPollMs()}ms, batch=${BATCH_SIZE}.`,
    );
  }

  schedule(0);
}

export function stopPrivateD1SyncDrainer(): void {
  stopping = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
