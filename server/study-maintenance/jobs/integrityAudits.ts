import { Prisma, type PrismaClient } from "@prisma/client";

type AuditReport = {
  jobType: "focus:audit" | "group-focus:audit";
  mode: "read-only";
  asOf: string;
  sampleLimit: number;
  status: "PASS" | "WARN";
  writeOperationsPerformed: 0;
  checks: Array<{ name: string; status: "PASS" | "WARN"; count: number }>;
};

function count(value: bigint | number | null | undefined): number {
  return Number(value ?? 0);
}

function statusFor(checks: AuditReport["checks"]): AuditReport["status"] {
  return checks.some((item) => item.status === "WARN") ? "WARN" : "PASS";
}

export async function runFocusAudit(input: {
  database: PrismaClient;
  asOf: string;
  limit: number;
}): Promise<AuditReport> {
  const limit = Math.max(1, Math.min(Math.trunc(input.limit), 500));
  const rows = await input.database.$queryRaw<Array<{
    sampled: bigint;
    invalid_terminal_state: bigint;
    missing_completion_event: bigint;
    mismatched_event_identity: bigint;
  }>>(Prisma.sql`
    WITH sample AS (
      SELECT "id", "userId", "lectureId", "actualEndedAt", "activeSeconds", "pauseSeconds"
      FROM "FocusSession"
      WHERE "status" = 'COMPLETED'
      ORDER BY "id" ASC
      LIMIT ${limit}
    )
    SELECT
      COUNT(*)::bigint AS sampled,
      COUNT(*) FILTER (
        WHERE "actualEndedAt" IS NULL OR "activeSeconds" < 0 OR "pauseSeconds" < 0
      )::bigint AS invalid_terminal_state,
      COUNT(*) FILTER (
        WHERE NOT EXISTS (
          SELECT 1 FROM "StudyEvent" event
          WHERE event."focusSessionId" = sample."id"
            AND event."userId" = sample."userId"
            AND event."eventType" = 'focus_session_completed'
            AND event."evidenceClass" = 'SERVER_VALIDATED'
        )
      )::bigint AS missing_completion_event,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM "StudyEvent" event
          WHERE event."focusSessionId" = sample."id"
            AND (event."userId" <> sample."userId" OR
                 (event."lectureId" IS NOT NULL AND event."lectureId" <> sample."lectureId"))
        )
      )::bigint AS mismatched_event_identity
    FROM sample
  `);
  const row = rows[0]!;
  const checks = [
    { name: "completed_session_state", count: count(row.invalid_terminal_state) },
    { name: "server_validated_completion_evidence", count: count(row.missing_completion_event) },
    { name: "completion_event_identity", count: count(row.mismatched_event_identity) },
  ].map((item) => ({ ...item, status: item.count ? "WARN" as const : "PASS" as const }));
  return {
    jobType: "focus:audit",
    mode: "read-only",
    asOf: input.asOf,
    sampleLimit: limit,
    status: statusFor(checks),
    writeOperationsPerformed: 0,
    checks: [{ name: "sampled_completed_sessions", status: "PASS", count: count(row.sampled) }, ...checks],
  };
}

export async function runGroupFocusAudit(input: {
  database: PrismaClient;
  asOf: string;
  limit: number;
}): Promise<AuditReport> {
  const limit = Math.max(1, Math.min(Math.trunc(input.limit), 500));
  const [runs, participants] = await Promise.all([
    input.database.$queryRaw<Array<{
      sampled: bigint;
      invalid_runtime: bigint;
      invalid_round_count: bigint;
      missing_summary_event: bigint;
      runs_without_participants: bigint;
    }>>(Prisma.sql`
      WITH sample AS (
        SELECT run."id", run."roomId", run."runtimeStartedAt", run."runtimeEndedAt",
          run."completedRounds", run."roundCount"
        FROM "GroupFocusRun" run
        ORDER BY run."id" ASC
        LIMIT ${limit}
      )
      SELECT
        COUNT(*)::bigint AS sampled,
        COUNT(*) FILTER (WHERE "runtimeEndedAt" < "runtimeStartedAt")::bigint AS invalid_runtime,
        COUNT(*) FILTER (
          WHERE "roundCount" < 0 OR "completedRounds" < 0 OR "completedRounds" > "roundCount"
        )::bigint AS invalid_round_count,
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM "StudyEvent" event
            WHERE event."groupFocusRoomId" = sample."roomId"
              AND event."eventType" = 'group_focus_summary_completed'
              AND event."evidenceClass" = 'SERVER_VALIDATED'
          )
        )::bigint AS missing_summary_event,
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM "GroupFocusParticipantSummary" participant
            WHERE participant."runId" = sample."id"
          )
        )::bigint AS runs_without_participants
      FROM sample
    `),
    input.database.$queryRaw<Array<{ invalid_participation: bigint }>>(Prisma.sql`
      WITH sample AS (
        SELECT "verifiedFocusSeconds", "reconnectCount"
        FROM "GroupFocusParticipantSummary"
        ORDER BY "id" ASC
        LIMIT ${limit}
      )
      SELECT COUNT(*) FILTER (
        WHERE "verifiedFocusSeconds" < 0 OR "reconnectCount" < 0
      )::bigint AS invalid_participation
      FROM sample
    `),
  ]);
  const run = runs[0]!;
  const checks = [
    { name: "sampled_runs", status: "PASS" as const, count: count(run.sampled) },
    { name: "runtime_order", count: count(run.invalid_runtime) },
    { name: "round_count_bounds", count: count(run.invalid_round_count) },
    { name: "server_validated_summary_event", count: count(run.missing_summary_event) },
    { name: "runs_without_participants", count: count(run.runs_without_participants) },
    { name: "participant_measurements", count: count(participants[0]?.invalid_participation) },
  ].map((item) => ({
    ...item,
    status: item.name === "sampled_runs" || item.count === 0 ? "PASS" as const : "WARN" as const,
  }));
  return {
    jobType: "group-focus:audit",
    mode: "read-only",
    asOf: input.asOf,
    sampleLimit: limit,
    status: statusFor(checks),
    writeOperationsPerformed: 0,
    checks,
  };
}