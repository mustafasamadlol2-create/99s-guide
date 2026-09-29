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
  asOf?: string;
}): MaintenanceAdapter<OutboxMaintenanceItem> {
  if (input.operation === "compact" && (!input.before || Number.isNaN(Date.parse(input.before)))) {
    throw new Error("MAINTENANCE_SAFE: Outbox compaction requires an explicit cutoff.");
  }
  const fixedAsOf = new Date(input.asOf ?? new Date().toISOString());
  if (!Number.isFinite(fixedAsOf.getTime())) {
    throw new Error("MAINTENANCE_SAFE: Outbox maintenance requires a valid fixed --as-of timestamp.");
  }
  const requestedCutoff = input.before ? new Date(input.before) : null;
  const successRetentionCutoff = requestedCutoff
    ? new Date(Math.min(requestedCutoff.getTime(), fixedAsOf.getTime() - 30 * 24 * 60 * 60 * 1000))
    : null;
  const poisonRetentionCutoff = requestedCutoff
    ? new Date(Math.min(requestedCutoff.getTime(), fixedAsOf.getTime() - 90 * 24 * 60 * 60 * 1000))
    : null;
  async function readRow(item: OutboxMaintenanceItem): Promise<{
    state: string;
    nextAttemptAt: Date;
    leaseUntil: Date | null;
    attempts: number;
    terminalAt: Date | null;
  } | null> {
    const rows = item.kind === "private"
      ? await input.database.$queryRaw<Array<{
          state: string; nextAttemptAt: Date; leaseUntil: Date | null; attempts: number; terminalAt: Date | null;
        }>>(Prisma.sql`
          SELECT "state", "nextAttemptAt", "leaseUntil", "attempts", "terminalAt"
          FROM "PrivateD1SyncOutbox"
          WHERE "id" = ${BigInt(item.rowId)}
          LIMIT 1
        `)
      : await input.database.$queryRaw<Array<{
          state: string; nextAttemptAt: Date; leaseUntil: Date | null; attempts: number; terminalAt: Date | null;
        }>>(Prisma.sql`
          SELECT "state", "nextAttemptAt", "leaseUntil", "attempts", "terminalAt"
          FROM "LeaderboardD1SyncOutbox"
          WHERE "id" = ${BigInt(item.rowId)}
          LIMIT 1
        `);
    return rows[0] ?? null;
  }
  return {
    async discoverBatch({ cursor, limit }) {
      const after = decodeCursor(cursor);
      const afterFilter = after
        ? Prisma.sql`AND (kind > ${after.kind} OR (kind = ${after.kind} AND id::numeric > ${after.id}::numeric))`
        : Prisma.empty;
      const operationFilter = input.operation === "compact"
        ? Prisma.sql`AND (
            (state = 'SUCCEEDED' AND "terminalAt" <= ${successRetentionCutoff!})
            OR (state = 'POISON' AND "terminalAt" <= ${poisonRetentionCutoff!})
          )`
        : Prisma.sql`AND "attempts" < 8
            AND ("leaseUntil" IS NULL OR "leaseUntil" <= ${fixedAsOf})
            AND (
              state = 'BLOCKED'
              OR (state IN ('PENDING', 'RETRY') AND "nextAttemptAt" > ${fixedAsOf})
            )`;
      const rows = await input.database.$queryRaw<Array<{ kind: OutboxKind; id: string }>>(Prisma.sql`
        SELECT kind, id FROM (
          SELECT 'leaderboard'::text AS kind, "id"::text AS id, state, "terminalAt"
          FROM "LeaderboardD1SyncOutbox"
          UNION ALL
          SELECT 'private'::text AS kind, "id"::text AS id, state, "terminalAt"
          FROM "PrivateD1SyncOutbox"
        ) pending
        WHERE TRUE ${afterFilter} ${operationFilter}
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
      const row = await readRow(item);
      if (!row) return { status: "MISSING", skipped: true, code: "OUTBOX_ROW_MISSING" };
      if (input.operation === "compact") {
        const cutoff = row.state === "SUCCEEDED"
          ? successRetentionCutoff
          : row.state === "POISON"
            ? poisonRetentionCutoff
            : null;
        if (!cutoff || !row.terminalAt) {
          return {
            status: "ACTIONABLE_OR_BLOCKED_RETAINED",
            skipped: true,
            code: "NON_TERMINAL_OUTBOX_RETAINED",
          };
        }
        const eligible = row.terminalAt <= cutoff;
        return {
          status: eligible ? "COMPACTION_ELIGIBLE" : "RETENTION_NOT_ELAPSED",
          wouldChange: eligible,
          skipped: !eligible,
        };
      }
      const now = new Date(asOf);
      const activeLease = Boolean(row.leaseUntil && row.leaseUntil > now);
      if (row.attempts >= 8) {
        return {
          status: "MAX_ATTEMPTS_REACHED",
          skipped: true,
          code: "MAX_ATTEMPTS_REACHED",
        };
      }
      const blocked = row.state === "BLOCKED";
      const delayed = (row.state === "PENDING" || row.state === "RETRY")
        && row.nextAttemptAt > now;
      const eligible = !activeLease && (blocked || delayed);
      return {
        status: blocked
          ? eligible ? "BLOCKED_REPLAY_ELIGIBLE" : "BLOCKED_REPLAY_NOT_NEEDED"
          : eligible ? "REPLAY_ELIGIBLE" : "REPLAY_NOT_NEEDED",
        wouldChange: eligible,
        skipped: !eligible,
      };
    },
    async apply(item, { asOf }) {
      if (input.operation === "compact") {
        const changed = item.kind === "private"
          ? await input.database.$executeRaw(Prisma.sql`
              DELETE FROM "PrivateD1SyncOutbox"
              WHERE "id" = ${BigInt(item.rowId)}
                AND (
                  ("state" = 'SUCCEEDED' AND "terminalAt" <= ${successRetentionCutoff!})
                  OR ("state" = 'POISON' AND "terminalAt" <= ${poisonRetentionCutoff!})
                )
            `)
          : await input.database.$executeRaw(Prisma.sql`
              DELETE FROM "LeaderboardD1SyncOutbox"
              WHERE "id" = ${BigInt(item.rowId)}
                AND (
                  ("state" = 'SUCCEEDED' AND "terminalAt" <= ${successRetentionCutoff!})
                  OR ("state" = 'POISON' AND "terminalAt" <= ${poisonRetentionCutoff!})
                )
            `);
        return {
          status: changed > 0 ? "OUTBOX_TERMINAL_COMPACTED" : "RETENTION_NOT_ELAPSED",
          changed: changed > 0,
          skipped: changed === 0,
        };
      }
      const changed = item.kind === "private"
        ? await input.database.$executeRaw(Prisma.sql`
            UPDATE "PrivateD1SyncOutbox"
            SET "state" = 'RETRY',
                "failureClass" = NULL,
                "failureCode" = NULL,
                "nextAttemptAt" = ${new Date(asOf)},
                "leaseUntil" = NULL,
                "updatedAt" = NOW()
            WHERE "id" = ${BigInt(item.rowId)}
              AND "attempts" < 8
              AND (
                "state" = 'BLOCKED'
                OR ("state" IN ('PENDING', 'RETRY') AND "nextAttemptAt" > ${new Date(asOf)})
              )
              AND ("leaseUntil" IS NULL OR "leaseUntil" <= ${new Date(asOf)})
          `)
        : await input.database.$executeRaw(Prisma.sql`
            UPDATE "LeaderboardD1SyncOutbox"
            SET "state" = 'RETRY',
                "failureClass" = NULL,
                "failureCode" = NULL,
                "nextAttemptAt" = ${new Date(asOf)},
                "leaseUntil" = NULL,
                "updatedAt" = NOW()
            WHERE "id" = ${BigInt(item.rowId)}
              AND "attempts" < 8
              AND (
                "state" = 'BLOCKED'
                OR ("state" IN ('PENDING', 'RETRY') AND "nextAttemptAt" > ${new Date(asOf)})
              )
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
  leased: number;
  blocked: number;
  poison: number;
  succeeded: number;
  oldestUpdatedAt: string | null;
  maxAttempts: number;
}>> {
  const rows = await database.$queryRaw<Array<{
    kind: OutboxKind;
    pending: bigint;
    delayed: bigint;
    leased: bigint;
    blocked: bigint;
    poison: bigint;
    succeeded: bigint;
    oldestUpdatedAt: Date | null;
    maxAttempts: number | null;
  }>>(Prisma.sql`
    SELECT 'private'::text AS kind,
      COUNT(*) FILTER (WHERE "state" IN ('PENDING', 'RETRY'))::bigint AS pending,
      COUNT(*) FILTER (
        WHERE "state" IN ('PENDING', 'RETRY')
          AND "nextAttemptAt" > NOW()
          AND ("leaseUntil" IS NULL OR "leaseUntil" <= NOW())
      )::bigint AS delayed,
      COUNT(*) FILTER (WHERE "leaseUntil" > NOW())::bigint AS leased,
      COUNT(*) FILTER (WHERE "state" = 'BLOCKED')::bigint AS blocked,
      COUNT(*) FILTER (WHERE "state" = 'POISON')::bigint AS poison,
      COUNT(*) FILTER (WHERE "state" = 'SUCCEEDED')::bigint AS succeeded,
      MIN("updatedAt") FILTER (WHERE "state" IN ('PENDING', 'RETRY')) AS "oldestUpdatedAt",
      COALESCE(MAX("attempts"), 0)::int AS "maxAttempts"
    FROM "PrivateD1SyncOutbox"
    UNION ALL
    SELECT 'leaderboard'::text AS kind,
      COUNT(*) FILTER (WHERE "state" IN ('PENDING', 'RETRY'))::bigint AS pending,
      COUNT(*) FILTER (
        WHERE "state" IN ('PENDING', 'RETRY')
          AND "nextAttemptAt" > NOW()
          AND ("leaseUntil" IS NULL OR "leaseUntil" <= NOW())
      )::bigint AS delayed,
      COUNT(*) FILTER (WHERE "leaseUntil" > NOW())::bigint AS leased,
      COUNT(*) FILTER (WHERE "state" = 'BLOCKED')::bigint AS blocked,
      COUNT(*) FILTER (WHERE "state" = 'POISON')::bigint AS poison,
      COUNT(*) FILTER (WHERE "state" = 'SUCCEEDED')::bigint AS succeeded,
      MIN("updatedAt") FILTER (WHERE "state" IN ('PENDING', 'RETRY')) AS "oldestUpdatedAt",
      COALESCE(MAX("attempts"), 0)::int AS "maxAttempts"
    FROM "LeaderboardD1SyncOutbox"
  `);
  return rows.map((row) => ({
    kind: row.kind,
    pending: Number(row.pending),
    delayed: Number(row.delayed),
    leased: Number(row.leased),
    blocked: Number(row.blocked),
    poison: Number(row.poison),
    succeeded: Number(row.succeeded),
    oldestUpdatedAt: row.oldestUpdatedAt?.toISOString() ?? null,
    maxAttempts: row.maxAttempts,
  }));
}