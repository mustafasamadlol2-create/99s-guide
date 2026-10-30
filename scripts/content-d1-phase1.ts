import "dotenv/config";
import { getPrisma, disconnectPrisma } from "../server/services/prismaClient.js";

type Entity =
  | "Lecture"
  | "Material"
  | "ModuleResource"
  | "Mcq"
  | "Flashcard"
  | "DailyMotto"
  | "CalendarEvent";

type Mutation = {
  version: 1;
  entity: Entity;
  operation: "upsert" | "delete";
  id: string;
  data?: Record<string, unknown>;
  occurredAt: string;
};

const workerBaseUrl = String(process.env.CONTENT_WORKER_BASE_URL || "").trim().replace(/\/+$/, "");
const secret = String(process.env.CONTENT_SYNC_SECRET || "").trim();
const verifyOnly = process.argv.includes("--verify-only");

if (!workerBaseUrl || !secret) {
  throw new Error("CONTENT_WORKER_BASE_URL and CONTENT_SYNC_SECRET are required.");
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function workerJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${workerBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "X-Content-Sync-Secret": secret,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Content Worker ${path} failed with HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  return (body ? JSON.parse(body) : {}) as T;
}

function mutation(entity: Entity, data: Record<string, unknown>): Mutation {
  return {
    version: 1,
    entity,
    operation: "upsert",
    id: String(data.id),
    data,
    occurredAt: new Date().toISOString(),
  };
}

function deletion(entity: Entity, id: string): Mutation {
  return {
    version: 1,
    entity,
    operation: "delete",
    id,
    occurredAt: new Date().toISOString(),
  };
}

async function sendBatches(mutations: Mutation[], label: string): Promise<void> {
  const batchSize = 100;
  for (let offset = 0; offset < mutations.length; offset += batchSize) {
    const batch = mutations.slice(offset, offset + batchSize);
    await workerJson("/internal/content-sync/batch", {
      method: "POST",
      body: JSON.stringify({ mutations: batch }),
    });
    const completed = Math.min(offset + batch.length, mutations.length);
    console.log(`[Phase1] ${label}: ${completed}/${mutations.length}`);
  }
}

async function canonicalRows(): Promise<Record<Entity, Array<Record<string, unknown>>>> {
  const prisma = getPrisma();
  const [lectures, materials, resources, mcqs, flashcards, mottos, events] = await Promise.all([
    prisma.lecture.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.material.findMany({
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
    }),
    prisma.moduleResource.findMany({
      where: { status: "READY" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        moduleId: true,
        title: true,
        fileSizeBytes: true,
        status: true,
        createdAt: true,
        storagePath: true,
      },
    }),
    prisma.mcq.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.flashcard.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.dailyMotto.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.calendarEvent.findMany({
      where: { userId: null },
      orderBy: [{ startDateTime: "asc" }, { id: "asc" }],
    }),
  ]);

  return {
    Lecture: lectures.map((row: any) => ({
      id: row.id,
      name: row.name,
      mainSubject: row.mainSubject,
      subSubject: row.subSubject ?? null,
      trackMode: row.trackMode,
      department: row.department ?? null,
      createdAt: iso(row.createdAt),
    })),
    Material: materials.map((row: any) => ({
      ...row,
      storagePath: row.storagePath ?? null,
      createdAt: iso(row.createdAt),
    })),
    ModuleResource: resources.map((row: any) => ({
      id: row.id,
      moduleId: row.moduleId,
      title: row.title,
      fileSizeBytes: Number(row.fileSizeBytes),
      status: row.status,
      createdAt: iso(row.createdAt),
      storagePath: row.storagePath,
    })),
    Mcq: mcqs.map((row: any) => ({
      id: row.id,
      question: row.question,
      optionA: row.optionA,
      optionB: row.optionB,
      optionC: row.optionC,
      optionD: row.optionD,
      correctAnswer: row.correctAnswer,
      hint: row.hint ?? null,
      explanation: row.explanation ?? null,
      sourceType: row.sourceType,
      sourceRef: row.sourceRef,
      difficulty: row.difficulty,
      lectureId: row.lectureId,
      createdAt: iso(row.createdAt),
    })),
    Flashcard: flashcards.map((row: any) => ({
      id: row.id,
      clinicalConcept: row.clinicalConcept,
      explanation: row.explanation,
      lectureId: row.lectureId,
      createdAt: iso(row.createdAt),
    })),
    DailyMotto: mottos.map((row: any) => ({
      id: row.id,
      message: row.message,
      isActive: row.isActive,
      isFeatured: row.isFeatured,
      createdBy: row.createdBy ?? null,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    CalendarEvent: events.map((row: any) => ({
      id: row.id,
      userId: null,
      title: row.title,
      eventType: row.eventType,
      startDateTime: iso(row.startDateTime),
      endDateTime: iso(row.endDateTime),
      targetGroups: row.targetGroups,
      description: row.description ?? null,
      subjectId: row.subjectId ?? null,
      lectureId: row.lectureId ?? null,
      room: row.room ?? null,
      doctor: row.doctor ?? null,
      notes: row.notes ?? null,
      isPinned: row.isPinned,
      isCompleted: row.isCompleted,
      allDay: row.allDay,
      importSource: row.importSource ?? null,
      sourceDocumentName: row.sourceDocumentName ?? null,
      sourceDocumentSha256: row.sourceDocumentSha256 ?? null,
      sourcePage: row.sourcePage ?? null,
      importFingerprint: row.importFingerprint ?? null,
    })),
  };
}

async function verify(rows: Record<Entity, Array<Record<string, unknown>>>): Promise<void> {
  const response = await workerJson<{ counts: Record<Entity, number> }>("/internal/content-read/counts");
  const expected = Object.fromEntries(
    (Object.keys(rows) as Entity[]).map((entity) => [entity, rows[entity].length]),
  ) as Record<Entity, number>;
  let mismatch = false;
  for (const entity of Object.keys(rows) as Entity[]) {
    const actual = Number(response.counts?.[entity] ?? -1);
    const wanted = expected[entity];
    const ok = actual === wanted;
    console.log(`[Phase1] verify ${entity}: Supabase=${wanted} D1=${actual} ${ok ? "OK" : "MISMATCH"}`);
    mismatch ||= !ok;
  }
  if (mismatch) throw new Error("D1 content verification failed: row counts do not match Supabase.");
}

async function prune(rows: Record<Entity, Array<Record<string, unknown>>>): Promise<void> {
  // Children first, parent Lecture last, so stale parent cascades can never erase
  // a canonical child that was just backfilled.
  const order: Entity[] = ["Material", "ModuleResource", "Mcq", "Flashcard", "DailyMotto", "CalendarEvent", "Lecture"];
  for (const entity of order) {
    const payload = await workerJson<{ ids: string[] }>(`/internal/content-read/ids?entity=${encodeURIComponent(entity)}`);
    const canonicalIds = new Set(rows[entity].map((row) => String(row.id)));
    const staleIds = (payload.ids || []).filter((id) => !canonicalIds.has(id));
    if (staleIds.length > 0) {
      console.log(`[Phase1] pruning ${staleIds.length} stale ${entity} row(s) from D1.`);
      await sendBatches(staleIds.map((id) => deletion(entity, id)), `${entity} prune`);
    }
  }
}

async function main(): Promise<void> {
  console.log(`[Phase1] Content Worker: ${workerBaseUrl}`);
  const health = await fetch(`${workerBaseUrl}/health`);
  if (!health.ok) throw new Error(`Content Worker health check failed with HTTP ${health.status}.`);

  console.log("[Phase1] Reading canonical academic content from Supabase...");
  const rows = await canonicalRows();

  if (!verifyOnly) {
    const order: Entity[] = ["Lecture", "Material", "ModuleResource", "Mcq", "Flashcard", "DailyMotto", "CalendarEvent"];
    for (const entity of order) {
      const mutations = rows[entity].map((row) => mutation(entity, row));
      console.log(`[Phase1] syncing ${entity}: ${mutations.length} row(s)`);
      if (mutations.length > 0) await sendBatches(mutations, entity);
    }
    await prune(rows);
  }

  await verify(rows);
  console.log(verifyOnly
    ? "[Phase1] Verification passed. D1 content replica matches canonical Supabase counts."
    : "[Phase1] Backfill + prune + verification passed. D1 content replica is ready for cutover.");
}

main()
  .catch((error) => {
    console.error("[Phase1] FAILED:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
