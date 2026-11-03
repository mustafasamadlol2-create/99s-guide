import "dotenv/config";
import { getPrisma, disconnectPrisma } from "../server/services/prismaClient.js";
import {
  buildFocusPlanProjection,
  buildFocusSessionProjection,
  buildStudyDailyMetricProjection,
} from "../server/features/study-core/projection.js";
import { PROJECTION_CONTRACT_VERSION } from "../server/features/study-core/constants.js";

type Entity = "FocusPlan" | "FocusSession" | "StudyDailyMetric";
type ProjectionMutation = {
  version: 1;
  entity: Entity;
  operation: "upsert";
  key: { id: string };
  revision: string;
  projectionVersion: number;
  userScope: string;
  updatedAt: string;
  data: Record<string, unknown>;
  occurredAt: string;
};

const workerBaseUrl = String(process.env.PRIVATE_DATA_WORKER_BASE_URL || "").trim().replace(/\/+$/, "");
const secret = String(process.env.PRIVATE_DATA_SYNC_SECRET || "").trim();
const verifyOnly = process.argv.includes("--verify-only");

if (!workerBaseUrl || !secret) {
  throw new Error("PRIVATE_DATA_WORKER_BASE_URL and PRIVATE_DATA_SYNC_SECRET are required.");
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, current) =>
    typeof current === "bigint" ? current.toString() : current,
  )) as T;
}

async function workerJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${workerBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "X-Private-Data-Sync-Secret": secret,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Private Data Worker ${path} failed with HTTP ${response.status}: ${body.slice(0, 400)}`);
  }
  return (body ? JSON.parse(body) : {}) as T;
}

async function send(entity: Entity, projection: Record<string, unknown>): Promise<void> {
  const id = String(projection.id || "");
  const revision = String(projection.revision ?? "0");
  const userScope = String(projection.userScope ?? projection.userId ?? "");
  const updatedAt = String(projection.updatedAt || new Date().toISOString());
  if (!id || !/^\d+$/.test(revision) || !userScope) {
    throw new Error(`Invalid ${entity} projection envelope.`);
  }
  const mutation: ProjectionMutation = {
    version: 1,
    entity,
    operation: "upsert",
    key: { id },
    revision,
    projectionVersion: Number(projection.projectionVersion || PROJECTION_CONTRACT_VERSION),
    userScope,
    updatedAt,
    data: projection,
    occurredAt: new Date().toISOString(),
  };
  await workerJson("/internal/private-sync", {
    method: "POST",
    body: JSON.stringify(jsonSafe(mutation)),
  });
}

async function canonical() {
  const prisma = getPrisma();
  const [plans, sessions, metrics] = await Promise.all([
    prisma.focusPlan.findMany({
      orderBy: [{ userId: "asc" }, { updatedAt: "asc" }, { id: "asc" }],
      include: {
        items: {
          orderBy: [{ sequence: "asc" }, { id: "asc" }],
          select: {
            id: true,
            lectureId: true,
            sequence: true,
            sessionCount: true,
            focusDurationSeconds: true,
            breakDurationSeconds: true,
            includeMcq: true,
            includeFlashcards: true,
            includeVideo: true,
            resourceSelections: true,
          },
        },
      },
    }),
    prisma.focusSession.findMany({
      orderBy: [{ userId: "asc" }, { updatedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        userId: true,
        planId: true,
        planItemId: true,
        lectureId: true,
        projectionRevision: true,
        status: true,
        startedAt: true,
        plannedEndAt: true,
        actualEndedAt: true,
        lastCheckpointAt: true,
        activeSeconds: true,
        pauseSeconds: true,
        completionReason: true,
        updatedAt: true,
      },
    }),
    prisma.studyDailyMetric.findMany({
      orderBy: [{ userId: "asc" }, { metricDate: "asc" }, { id: "asc" }],
    }),
  ]);

  const planProjections = plans.map((plan) => buildFocusPlanProjection({
    plan: {
      id: plan.id,
      userId: plan.userId,
      title: plan.title,
      status: plan.status,
      timezone: plan.timezone,
      planVersion: plan.planVersion,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      archivedAt: plan.archivedAt,
    },
    items: plan.items.map((item) => ({
      id: item.id,
      lectureId: item.lectureId,
      sequence: item.sequence,
      sessionCount: item.sessionCount,
      focusDurationSeconds: item.focusDurationSeconds,
      breakDurationSeconds: item.breakDurationSeconds,
      includeMcq: item.includeMcq,
      includeFlashcards: item.includeFlashcards,
      includeVideo: item.includeVideo,
      resources: Array.isArray(item.resourceSelections)
        ? (item.resourceSelections as any[]).map((resource, index) => ({
            resourceType: String(resource?.resourceType || "PDF") as any,
            resourceId: String(resource?.resourceId || ""),
            sequence: Number.isInteger(resource?.sequence) ? Number(resource.sequence) : index + 1,
          })).filter((resource) => resource.resourceId)
        : [],
    })),
    // FocusPlan has no canonical projection watermark. Start rebuilt rows at 0 so
    // any future outbox sequence revision can safely advance the replica.
    revision: 0,
    projectionVersion: PROJECTION_CONTRACT_VERSION,
  }));

  const sessionProjections = sessions.map((session) => buildFocusSessionProjection({
    session: {
      id: session.id,
      userId: session.userId,
      planId: session.planId,
      planItemId: session.planItemId,
      lectureId: session.lectureId,
      status: session.status,
      startedAt: iso(session.startedAt),
      plannedEndAt: iso(session.plannedEndAt),
      actualEndedAt: iso(session.actualEndedAt),
      lastCheckpointAt: iso(session.lastCheckpointAt),
      activeSeconds: session.activeSeconds,
      pauseSeconds: session.pauseSeconds,
      completionReason: session.completionReason,
      updatedAt: session.updatedAt,
    },
    revision: session.projectionRevision.toString(),
    projectionVersion: PROJECTION_CONTRACT_VERSION,
  }));

  const metricProjections = metrics.map((metric) => buildStudyDailyMetricProjection({
    metric: {
      id: metric.id,
      userId: metric.userId,
      metricDate: metric.metricDate,
      focusSeconds: metric.focusSeconds,
      sessionsCompleted: metric.sessionsCompleted,
      mcqAttempts: metric.mcqAttempts,
      mcqCorrect: metric.mcqCorrect,
      flashcardReviews: metric.flashcardReviews,
      recallAttempts: metric.recallAttempts,
      recallCorrect: metric.recallCorrect,
      lectureCompletions: metric.lectureCompletions,
      interruptionCount: metric.interruptionCount,
      updatedAt: metric.updatedAt,
    },
    revision: metric.projectionRevision.toString(),
    projectionVersion: PROJECTION_CONTRACT_VERSION,
  }));

  return { planProjections, sessionProjections, metricProjections };
}

async function syncRows(entity: Entity, rows: Record<string, unknown>[]): Promise<void> {
  console.log(`[Phase5] syncing ${entity}: ${rows.length} row(s)`);
  for (let index = 0; index < rows.length; index += 1) {
    await send(entity, rows[index]);
    if ((index + 1) % 100 === 0 || index + 1 === rows.length) {
      console.log(`[Phase5] ${entity}: ${index + 1}/${rows.length}`);
    }
  }
}

async function main(): Promise<void> {
  console.log(`[Phase5] Private Data Worker: ${workerBaseUrl}`);
  const health = await fetch(`${workerBaseUrl}/health`);
  if (!health.ok) throw new Error(`Private Data Worker health check failed with HTTP ${health.status}.`);

  console.log("[Phase5] Reading canonical study-engine state from Supabase...");
  const rows = await canonical();

  if (!verifyOnly) {
    console.log("[Phase5] rebuilding disposable D1 study-engine replica schema...");
    await workerJson("/internal/private-maintenance/phase5-study-engine-reset", { method: "POST" });
    console.log("[Phase5] D1 study-engine replica schema rebuilt successfully.");
    await syncRows("FocusPlan", rows.planProjections as unknown as Record<string, unknown>[]);
    await syncRows("FocusSession", rows.sessionProjections as unknown as Record<string, unknown>[]);
    await syncRows("StudyDailyMetric", rows.metricProjections as unknown as Record<string, unknown>[]);
  }

  const counts = await workerJson<{
    focusPlans: number;
    focusSessions: number;
    studyDailyMetrics: number;
  }>("/internal/private-read/phase5-counts");

  const checks = [
    ["FocusPlan", rows.planProjections.length, Number(counts.focusPlans)],
    ["FocusSession", rows.sessionProjections.length, Number(counts.focusSessions)],
    ["StudyDailyMetric", rows.metricProjections.length, Number(counts.studyDailyMetrics)],
  ] as const;
  let ok = true;
  for (const [name, canonicalCount, d1Count] of checks) {
    const match = canonicalCount === d1Count;
    ok = ok && match;
    console.log(`[Phase5] verify ${name}: Supabase=${canonicalCount} D1=${d1Count} ${match ? "OK" : "MISMATCH"}`);
  }
  if (!ok) throw new Error("Phase 5 D1 verification failed.");

  console.log(verifyOnly
    ? "[Phase5] Verification passed. Study-engine replica matches canonical Supabase counts."
    : "[Phase5] Backfill + verification passed. Study-engine replica is ready for cutover.");
}

main()
  .catch((error) => {
    console.error(`[Phase5] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma().catch(() => {});
  });
