import { Prisma, type PrismaClient } from "@prisma/client";
import type { InspectionResult, MaintenanceAdapter } from "../core/types.js";

type OutboxKind = "leaderboard" | "private";
export type OutboxMaintenanceItem = {
  id: string;
  kind: OutboxKind;
  rowId: string;
};

function decodeCursor(cursor: string | null): { kind: OutboxKind; id: string } | null {
  if (!cursor) return null;
  const match = /^(leaderboard|private):([1-9]\d*)$/u.exec(cursor);
  if (!match) throw new Error("MAINTENANCE_SAFE: Invalid outbox cursor.");
  return { kind: match[1] as OutboxKind, id: match[2]! };
}

export function createOutboxAdapter(input: {
  database: PrismaClient;
  operation: "replay" | "compact";
  before?: string;
}): MaintenanceAdapter<OutboxMaintenanceItem> {
  if (input.operation === "compact" && (!input.before || Number.isNaN(Date.parse(input.before)))) {
    throw new Error("MAINTENANCE_SAFE: Outbox compaction inspection requires --before <ISO timestamp>.");
  }
  return {
    async discoverBatch({ cursor, limit }) {
      const after = decodeCursor(cursor);
      const afterFilter = after
        ? Prisma.sql`AND (kind > ${after.kind} OR (kind = ${after.kind} AND id::numeric > ${after.id}::numeric))`
        : Prisma.empty;
      const beforeFilter = input.operation === "compact"
        ? Prisma.sql`AND "updatedAt" < ${new Date(input.before!)}`
        : Prisma.empty;
      const rows = await input.database.$queryRaw<Array<{ kind: OutboxKind; id: string }>>(Prisma.sql`
        SELECT kind, id FROM (
          SELECT 'leaderboard'::text AS kind, "id"::text AS id, "updatedAt" FROM "LeaderboardD1SyncOutbox"
          UNION ALL
          SELECT 'private'::text AS kind, "id"::text AS id, "updatedAt" FROM "PrivateD1SyncOutbox"
        ) pending
        WHERE TRUE ${afterFilter} ${beforeFilter}
        ORDER BY kind ASC, id::numeric ASC
        LIMIT ${limit}
      `);
      const items = rows.map((row) => ({
        id: `${row.kind}:${row.id}`,
        kind: row.kind,
        rowId: row.id,
      }));
      return {
        items,
        nextCursor: items.length === limit ? items.at(-1)?.id ?? null : null,
      };
    },
    async inspect(item, { asOf }) {
      if (input.operation === "compact") {
        return {
          status: "NO_TERMINAL_RETENTION_STATE",
          skipped: true,
          code: "SAFE_COMPACTION_UNAVAILABLE",
        };
      }
      if (item.kind === "private") {
        return {
          status: "PRIVATE_D1_LEASE_AMBIGUOUS",
          skipped: true,
          code: "PRIVATE_D1_REPLAY_UNSAFE",
        };
      }
      const rows = await input.database.$queryRaw<Array<{
        nextAttemptAt: Date;
        leaseUntil: Date | null;
      }>>(Prisma.sql`
        SELECT "nextAttemptAt", "leaseUntil"
        FROM "LeaderboardD1SyncOutbox"
        WHERE "id" = ${BigInt(item.rowId)}
        LIMIT 1
      `);
      const row = rows[0];
      if (!row) return { status: "MISSING", skipped: true, code: "OUTBOX_ROW_MISSING" };
      const eligible = row.nextAttemptAt > new Date(asOf)
        && (!row.leaseUntil || row.leaseUntil <= new Date(asOf));
      return {
        status: eligible ? "REPLAY_ELIGIBLE" : "REPLAY_NOT_NEEDED",
        wouldChange: eligible,
        skipped: !eligible,
      };
    },
    async apply(item, { asOf }) {
      if (input.operation === "compact") {
        return {
          status: "NO_TERMINAL_RETENTION_STATE",
          skipped: true,
          code: "SAFE_COMPACTION_UNAVAILABLE",
        };
      }
      if (item.kind === "private") {
        return {
          status: "PRIVATE_D1_LEASE_AMBIGUOUS",
          skipped: true,
          code: "PRIVATE_D1_REPLAY_UNSAFE",
        };
      }
      const changed = await input.database.$executeRaw(Prisma.sql`
        UPDATE "LeaderboardD1SyncOutbox"
        SET "nextAttemptAt" = ${new Date(asOf)}, "updatedAt" = NOW()
        WHERE "id" = ${BigInt(item.rowId)}
          AND "nextAttemptAt" > ${new Date(asOf)}
          AND ("leaseUntil" IS NULL OR "leaseUntil" <= ${new Date(asOf)})
      `);
      return {
        status: changed > 0 ? "REPLAY_SCHEDULED" : "REPLAY_NOT_NEEDED",
        changed: changed > 0,
        skipped: changed === 0,
      };
    },
  };
}

export async function readOutboxStatus(database: PrismaClient): Promise<Array<{
  kind: OutboxKind;
  pending: number;
  delayed: number;
  oldestUpdatedAt: string | null;
  maxAttempts: number;
}>> {
  const rows = await database.$queryRaw<Array<{
    kind: OutboxKind;
    pending: bigint;
    delayed: bigint;
    oldestUpdatedAt: Date | null;
    maxAttempts: number | null;
  }>>(Prisma.sql`
    SELECT 'private'::text AS kind,
      COUNT(*)::bigint AS pending,
      COUNT(*) FILTER (WHERE "nextAttemptAt" > NOW())::bigint AS delayed,
      MIN("updatedAt") AS "oldestUpdatedAt",
      COALESCE(MAX("attempts"), 0)::int AS "maxAttempts"
    FROM "PrivateD1SyncOutbox"
    UNION ALL
    SELECT 'leaderboard'::text AS kind,
      COUNT(*)::bigint AS pending,
      COUNT(*) FILTER (
        WHERE "nextAttemptAt" > NOW()
          AND ("leaseUntil" IS NULL OR "leaseUntil" <= NOW())
      )::bigint AS delayed,
      MIN("updatedAt") AS "oldestUpdatedAt",
      COALESCE(MAX("attempts"), 0)::int AS "maxAttempts"
    FROM "LeaderboardD1SyncOutbox"
  `);
  return rows.map((row) => ({
    kind: row.kind,
    pending: Number(row.pending),
    delayed: Number(row.delayed),
    oldestUpdatedAt: row.oldestUpdatedAt?.toISOString() ?? null,
    maxAttempts: row.maxAttempts,
  }));
}