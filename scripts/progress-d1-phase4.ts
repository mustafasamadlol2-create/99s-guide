import "dotenv/config";
import { getPrisma, disconnectPrisma } from "../server/services/prismaClient.js";

type Entity = "LectureProgress" | "FlashcardProgress" | "UserProgress" | "VideoWatchProgress";
type Mutation = {
  version: 1;
  entity: Entity;
  operation: "upsert" | "delete";
  key: Record<string, unknown>;
  data?: Record<string, unknown>;
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
    throw new Error(`Private Data Worker ${path} failed with HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  return (body ? JSON.parse(body) : {}) as T;
}

async function send(mutation: Mutation): Promise<void> {
  await workerJson("/internal/private-sync", {
    method: "POST",
    body: JSON.stringify(mutation),
  });
}

function upsert(entity: Entity, key: Record<string, unknown>, data: Record<string, unknown>): Mutation {
  return { version: 1, entity, operation: "upsert", key, data, occurredAt: new Date().toISOString() };
}

function deletion(entity: Entity, key: Record<string, unknown>): Mutation {
  return { version: 1, entity, operation: "delete", key, occurredAt: new Date().toISOString() };
}

async function canonical() {
  const prisma = getPrisma();
  const [lectureProgress, flashcardProgress, materialProgress, videoProgress] = await Promise.all([
    prisma.lectureProgress.findMany({ orderBy: [{ userId: "asc" }, { lectureId: "asc" }] }),
    prisma.flashcardProgress.findMany({ orderBy: { id: "asc" } }),
    prisma.userProgress.findMany({ orderBy: { id: "asc" } }),
    prisma.videoWatchProgress.findMany({
      orderBy: { id: "asc" },
      include: { material: { select: { lectureId: true } } },
    }),
  ]);

  return {
    lectureProgress: lectureProgress.map((row) => ({
      userId: row.userId,
      lectureId: row.lectureId,
      pdfCompleted: row.pdfCompleted,
      notesCompleted: row.notesCompleted,
      videoCompleted: row.videoCompleted,
      flashcardsCompleted: row.flashcardsCompleted,
      quizCompleted: row.quizCompleted,
      quizScore: row.quizScore,
      pdfCompletedAt: iso(row.pdfCompletedAt),
      notesCompletedAt: iso(row.notesCompletedAt),
      videoCompletedAt: iso(row.videoCompletedAt),
      flashcardsCompletedAt: iso(row.flashcardsCompletedAt),
      quizCompletedAt: iso(row.quizCompletedAt),
      lectureCompletedAt: iso(row.lectureCompletedAt),
      lastAccessed: iso(row.lastAccessed),
    })),
    flashcardProgress: flashcardProgress.map((row) => ({
      id: row.id,
      userId: row.userId,
      flashcardId: row.flashcardId,
      status: row.status,
      updatedAt: iso(row.updatedAt),
    })),
    materialProgress: materialProgress.map((row) => ({
      id: row.id,
      userId: row.userId,
      materialId: row.materialId,
      hasViewed: row.hasViewed,
      isCompleted: row.isCompleted,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    videoProgress: videoProgress.map((row) => ({
      id: row.id,
      userId: row.userId,
      materialId: row.materialId,
      lectureId: row.material.lectureId,
      sessionId: row.sessionId,
      durationSeconds: row.durationSeconds,
      verifiedMilliseconds: row.verifiedMilliseconds,
      lastPositionSeconds: row.lastPositionSeconds,
      lastHeartbeatAt: iso(row.lastHeartbeatAt),
      lastPlayerState: row.lastPlayerState,
      lastPlaybackRate: row.lastPlaybackRate,
      completedAt: iso(row.completedAt),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
  };
}

async function syncRows<T extends Record<string, unknown>>(
  label: string,
  entity: Entity,
  rows: T[],
  keyOf: (row: T) => Record<string, unknown>,
): Promise<void> {
  console.log(`[Phase4] syncing ${label}: ${rows.length} row(s)`);
  for (let i = 0; i < rows.length; i += 1) {
    await send(upsert(entity, keyOf(rows[i]), rows[i]));
    if ((i + 1) % 100 === 0 || i + 1 === rows.length) {
      console.log(`[Phase4] ${label}: ${i + 1}/${rows.length}`);
    }
  }
}

async function main(): Promise<void> {
  console.log(`[Phase4] Private Data Worker: ${workerBaseUrl}`);
  const health = await fetch(`${workerBaseUrl}/health`);
  if (!health.ok) throw new Error(`Private Data Worker health check failed with HTTP ${health.status}.`);

  console.log("[Phase4] Reading canonical progress from Supabase...");
  const rows = await canonical();

  if (!verifyOnly) {
    await syncRows("LectureProgress", "LectureProgress", rows.lectureProgress, (row) => ({ userId: row.userId, lectureId: row.lectureId }));
    await syncRows("FlashcardProgress", "FlashcardProgress", rows.flashcardProgress, (row) => ({ id: row.id }));
    await syncRows("UserProgress", "UserProgress", rows.materialProgress, (row) => ({ id: row.id }));
    await syncRows("VideoWatchProgress", "VideoWatchProgress", rows.videoProgress, (row) => ({ id: row.id }));

    const keys = await workerJson<{
      lectureProgress: Array<{ userId: string; lectureId: string }>;
      flashcardProgressIds: string[];
      materialProgressIds: string[];
      videoProgressIds: string[];
    }>("/internal/private-read/phase4-keys");

    const lectureKeys = new Set(rows.lectureProgress.map((row) => `${row.userId}\u0000${row.lectureId}`));
    for (const row of keys.lectureProgress || []) {
      if (!lectureKeys.has(`${row.userId}\u0000${row.lectureId}`)) {
        await send(deletion("LectureProgress", { userId: row.userId, lectureId: row.lectureId }));
      }
    }
    const flashIds = new Set(rows.flashcardProgress.map((row) => row.id));
    for (const id of keys.flashcardProgressIds || []) if (!flashIds.has(id)) await send(deletion("FlashcardProgress", { id }));
    const materialIds = new Set(rows.materialProgress.map((row) => row.id));
    for (const id of keys.materialProgressIds || []) if (!materialIds.has(id)) await send(deletion("UserProgress", { id }));
    const videoIds = new Set(rows.videoProgress.map((row) => row.id));
    for (const id of keys.videoProgressIds || []) if (!videoIds.has(id)) await send(deletion("VideoWatchProgress", { id }));
  }

  const counts = await workerJson<{
    lectureProgress: number;
    flashcardProgress: number;
    materialProgress: number;
    videoProgress: number;
  }>("/internal/private-read/phase4-counts");

  const checks = [
    ["LectureProgress", rows.lectureProgress.length, Number(counts.lectureProgress)],
    ["FlashcardProgress", rows.flashcardProgress.length, Number(counts.flashcardProgress)],
    ["UserProgress", rows.materialProgress.length, Number(counts.materialProgress)],
    ["VideoWatchProgress", rows.videoProgress.length, Number(counts.videoProgress)],
  ] as const;
  let ok = true;
  for (const [name, canonicalCount, d1Count] of checks) {
    const match = canonicalCount === d1Count;
    ok = ok && match;
    console.log(`[Phase4] verify ${name}: Supabase=${canonicalCount} D1=${d1Count} ${match ? "OK" : "MISMATCH"}`);
  }
  if (!ok) throw new Error("Phase 4 D1 verification failed.");

  console.log(verifyOnly
    ? "[Phase4] Verification passed. Progress replica matches canonical Supabase counts."
    : "[Phase4] Backfill + prune + verification passed. Progress replica is ready for cutover.");
}

main()
  .catch((error) => {
    console.error(`[Phase4] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma().catch(() => {});
  });
