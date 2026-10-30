import {
  parseMCQCategory,
  parseMCQDifficulty,
} from "../../shared/mcqMetadata";
import {
  MODULE_RESOURCE_MODULES,
  MAX_MODULE_RESOURCE_PDF_BYTES,
} from "../../shared/moduleResources";

type ContentEntity =
  | "Lecture"
  | "Material"
  | "ModuleResource"
  | "Mcq"
  | "Flashcard"
  | "DailyMotto"
  | "CalendarEvent";

type ContentSyncMutation = {
  version: 1;
  entity: ContentEntity;
  operation: "upsert" | "delete";
  id: string;
  data?: Record<string, unknown>;
  occurredAt?: string;
};

function jsonNoStore(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireText(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value;
}

function optionalText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error(`${key} must be a string or null.`);
  return value;
}

function requireIsoDate(row: Record<string, unknown>, key: string): string {
  const value = requireText(row, key);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${key} must be a valid date.`);
  return date.toISOString();
}

function booleanToInteger(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  throw new Error(`${key} must be boolean.`);
}

function normalizeTargetGroups(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(String).map((v) => v.trim()).filter(Boolean).join(",");
  }
  if (typeof value === "string" && value.trim()) return value;
  throw new Error("targetGroups must be a non-empty string or array.");
}

function validateModuleResourceModuleId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !(MODULE_RESOURCE_MODULES as readonly string[]).includes(value)
  ) {
    throw new Error("moduleId must be one of the supported modules.");
  }
  return value;
}

function validateMutationId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 160 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new Error("Invalid mutation id.");
  }
  return value;
}

async function secretsEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);

  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let diff = a.length ^ b.length;
  const length = Math.min(a.length, b.length);

  for (let i = 0; i < length; i += 1) {
    diff |= a[i] ^ b[i];
  }

  return diff === 0;
}

async function upsertContentRow(env: any, entity: ContentEntity, data: Record<string, unknown>): Promise<void> {
  switch (entity) {
    case "Lecture": {
      const id = validateMutationId(data.id);
      await env.DB.prepare(`
        INSERT INTO "Lecture"
          ("id","name","mainSubject","subSubject","trackMode","department","createdAt")
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT("id") DO UPDATE SET
          "name"=excluded."name",
          "mainSubject"=excluded."mainSubject",
          "subSubject"=excluded."subSubject",
          "trackMode"=excluded."trackMode",
          "department"=excluded."department",
          "createdAt"=excluded."createdAt"
      `).bind(
        id,
        requireText(data, "name"),
        requireText(data, "mainSubject"),
        optionalText(data, "subSubject"),
        requireText(data, "trackMode"),
        optionalText(data, "department"),
        requireIsoDate(data, "createdAt"),
      ).run();
      return;
    }

    case "Material": {
      const id = validateMutationId(data.id);
      await env.DB.prepare(`
        INSERT INTO "Material"
          ("id","title","type","fileUrlOrLink","lectureId","createdAt","storagePath")
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT("id") DO UPDATE SET
          "title"=excluded."title",
          "type"=excluded."type",
          "fileUrlOrLink"=excluded."fileUrlOrLink",
          "lectureId"=excluded."lectureId",
          "createdAt"=excluded."createdAt",
          "storagePath"=excluded."storagePath"
      `).bind(
        id,
        requireText(data, "title"),
        requireText(data, "type"),
        requireText(data, "fileUrlOrLink"),
        validateMutationId(data.lectureId),
        requireIsoDate(data, "createdAt"),
        optionalText(data, "storagePath"),
      ).run();
      return;
    }

    case "ModuleResource": {
      const id = validateMutationId(data.id);
      const fileSizeBytes = Number(data.fileSizeBytes);
      if (
        !Number.isSafeInteger(fileSizeBytes) ||
        fileSizeBytes <= 0 ||
        fileSizeBytes > MAX_MODULE_RESOURCE_PDF_BYTES
      ) {
        throw new Error("fileSizeBytes must be a valid Module Resource PDF size.");
      }
      const status = requireText(data, "status");
      if (status !== "READY") {
        throw new Error("Only READY ModuleResource rows may be mirrored.");
      }

      await env.DB.prepare(`
        INSERT INTO "ModuleResource"
          ("id","moduleId","title","fileSizeBytes","status","createdAt","storagePath")
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT("id") DO UPDATE SET
          "moduleId"=excluded."moduleId",
          "title"=excluded."title",
          "fileSizeBytes"=excluded."fileSizeBytes",
          "status"=excluded."status",
          "createdAt"=excluded."createdAt",
          "storagePath"=excluded."storagePath"
      `).bind(
        id,
        validateModuleResourceModuleId(data.moduleId),
        requireText(data, "title"),
        fileSizeBytes,
        status,
        requireIsoDate(data, "createdAt"),
        optionalText(data, "storagePath"),
      ).run();
      return;
    }

    case "Mcq": {
      const id = validateMutationId(data.id);
      const correctAnswer = requireText(data, "correctAnswer").toUpperCase();
      if (!["A", "B", "C", "D"].includes(correctAnswer)) {
        throw new Error("correctAnswer must be A, B, C, or D.");
      }
      const sourceType = parseMCQCategory(data.sourceType);
      if (!sourceType) throw new Error("sourceType must be AI_GENERATED, PREVIOUS_YEAR, or RESOURCE.");
      const difficulty = parseMCQDifficulty(data.difficulty);
      if (!difficulty) throw new Error("difficulty must be Easy, Medium, or Hard.");

      await env.DB.prepare(`
        INSERT INTO "Mcq"
          ("id","question","optionA","optionB","optionC","optionD","correctAnswer",
           "hint","explanation","sourceType","sourceRef","difficulty","lectureId","createdAt")
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT("id") DO UPDATE SET
          "question"=excluded."question",
          "optionA"=excluded."optionA",
          "optionB"=excluded."optionB",
          "optionC"=excluded."optionC",
          "optionD"=excluded."optionD",
          "correctAnswer"=excluded."correctAnswer",
          "hint"=excluded."hint",
          "explanation"=excluded."explanation",
          "sourceType"=excluded."sourceType",
          "sourceRef"=excluded."sourceRef",
          "difficulty"=excluded."difficulty",
          "lectureId"=excluded."lectureId",
          "createdAt"=excluded."createdAt"
      `).bind(
        id,
        requireText(data, "question"),
        requireText(data, "optionA"),
        requireText(data, "optionB"),
        requireText(data, "optionC"),
        requireText(data, "optionD"),
        correctAnswer,
        optionalText(data, "hint"),
        optionalText(data, "explanation"),
         sourceType,
        typeof data.sourceRef === "string" ? data.sourceRef : "",
         difficulty,
        validateMutationId(data.lectureId),
        requireIsoDate(data, "createdAt"),
      ).run();
      return;
    }

    case "Flashcard": {
      const id = validateMutationId(data.id);
      await env.DB.prepare(`
        INSERT INTO "Flashcard"
          ("id","clinicalConcept","explanation","lectureId","createdAt")
        VALUES (?,?,?,?,?)
        ON CONFLICT("id") DO UPDATE SET
          "clinicalConcept"=excluded."clinicalConcept",
          "explanation"=excluded."explanation",
          "lectureId"=excluded."lectureId",
          "createdAt"=excluded."createdAt"
      `).bind(
        id,
        requireText(data, "clinicalConcept"),
        requireText(data, "explanation"),
        validateMutationId(data.lectureId),
        requireIsoDate(data, "createdAt"),
      ).run();
      return;
    }

    case "DailyMotto": {
      const id = validateMutationId(data.id);
      await env.DB.prepare(`
        INSERT INTO "DailyMotto"
          ("id","message","isActive","isFeatured","createdBy","createdAt","updatedAt")
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT("id") DO UPDATE SET
          "message"=excluded."message",
          "isActive"=excluded."isActive",
          "isFeatured"=excluded."isFeatured",
          "createdBy"=excluded."createdBy",
          "createdAt"=excluded."createdAt",
          "updatedAt"=excluded."updatedAt"
      `).bind(
        id,
        requireText(data, "message"),
        booleanToInteger(data, "isActive"),
        booleanToInteger(data, "isFeatured"),
        optionalText(data, "createdBy"),
        requireIsoDate(data, "createdAt"),
        requireIsoDate(data, "updatedAt"),
      ).run();
      return;
    }

    case "CalendarEvent": {
      const id = validateMutationId(data.id);
      if (data.userId !== null && data.userId !== undefined && data.userId !== "") {
        throw new Error("D1 accepts global CalendarEvent rows only.");
      }

      await env.DB.prepare(`
        INSERT INTO "CalendarEvent"
          ("id","userId","title","eventType","startDateTime","endDateTime","targetGroups",
           "description","subjectId","lectureId","room","doctor","notes","isPinned","isCompleted",
           "allDay","importSource","sourceDocumentName","sourceDocumentSha256","sourcePage","importFingerprint")
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT("id") DO UPDATE SET
          "userId"=excluded."userId",
          "title"=excluded."title",
          "eventType"=excluded."eventType",
          "startDateTime"=excluded."startDateTime",
          "endDateTime"=excluded."endDateTime",
          "targetGroups"=excluded."targetGroups",
          "description"=excluded."description",
          "subjectId"=excluded."subjectId",
          "lectureId"=excluded."lectureId",
          "room"=excluded."room",
          "doctor"=excluded."doctor",
          "notes"=excluded."notes",
          "isPinned"=excluded."isPinned",
          "isCompleted"=excluded."isCompleted",
          "allDay"=excluded."allDay",
          "importSource"=excluded."importSource",
          "sourceDocumentName"=excluded."sourceDocumentName",
          "sourceDocumentSha256"=excluded."sourceDocumentSha256",
          "sourcePage"=excluded."sourcePage",
          "importFingerprint"=excluded."importFingerprint"
      `).bind(
        id,
        null,
        requireText(data, "title"),
        requireText(data, "eventType"),
        requireIsoDate(data, "startDateTime"),
        requireIsoDate(data, "endDateTime"),
        normalizeTargetGroups(data.targetGroups),
        optionalText(data, "description"),
        optionalText(data, "subjectId"),
        optionalText(data, "lectureId"),
        optionalText(data, "room"),
        optionalText(data, "doctor"),
        optionalText(data, "notes"),
        booleanToInteger(data, "isPinned"),
        booleanToInteger(data, "isCompleted"),
        data.allDay === undefined ? 0 : booleanToInteger(data, "allDay"),
        optionalText(data, "importSource"),
        optionalText(data, "sourceDocumentName"),
        optionalText(data, "sourceDocumentSha256"),
        data.sourcePage === null || data.sourcePage === undefined ? null : Number(data.sourcePage),
        optionalText(data, "importFingerprint"),
      ).run();
      return;
    }
  }
}

async function deleteContentRow(env: any, entity: ContentEntity, id: string): Promise<void> {
  const tableByEntity: Record<ContentEntity, string> = {
    Lecture: "Lecture",
    Material: "Material",
    ModuleResource: "ModuleResource",
    Mcq: "Mcq",
    Flashcard: "Flashcard",
    DailyMotto: "DailyMotto",
    CalendarEvent: "CalendarEvent",
  };

  const table = tableByEntity[entity];
  await env.DB.prepare(`DELETE FROM "${table}" WHERE "id" = ?`).bind(id).run();
}

async function handleInternalContentSync(request: Request, env: any): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "no-store" },
    });
  }

  const configuredSecret = typeof env.CONTENT_SYNC_SECRET === "string"
    ? env.CONTENT_SYNC_SECRET
    : "";
  if (!configuredSecret) {
    return jsonNoStore({ ok: false, error: "Content sync is not configured." }, 503);
  }

  const suppliedSecret = request.headers.get("X-Content-Sync-Secret") || "";
  if (!suppliedSecret || !(await secretsEqual(suppliedSecret, configuredSecret))) {
    return jsonNoStore({ ok: false, error: "Unauthorized." }, 401);
  }

  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(contentLength) && contentLength > 512 * 1024) {
    return jsonNoStore({ ok: false, error: "Payload too large." }, 413);
  }

  const rawBody = await request.text();
  if (rawBody.length > 512 * 1024) {
    return jsonNoStore({ ok: false, error: "Payload too large." }, 413);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonNoStore({ ok: false, error: "Invalid JSON." }, 400);
  }

  if (!isRecord(payload)) {
    return jsonNoStore({ ok: false, error: "Invalid content sync payload." }, 400);
  }

  const entity = payload.entity;
  const operation = payload.operation;
  const version = payload.version;

  let id: string;
  try {
    id = validateMutationId(payload.id);
  } catch (error) {
    return jsonNoStore(
      { ok: false, error: error instanceof Error ? error.message : "Invalid mutation id." },
      400,
    );
  }

  const validEntities: ContentEntity[] = [
    "Lecture",
    "Material",
    "ModuleResource",
    "Mcq",
    "Flashcard",
    "DailyMotto",
    "CalendarEvent",
  ];

  if (version !== 1 || !validEntities.includes(entity as ContentEntity)) {
    return jsonNoStore({ ok: false, error: "Unsupported content sync payload." }, 400);
  }

  if (operation !== "upsert" && operation !== "delete") {
    return jsonNoStore({ ok: false, error: "Unsupported content sync operation." }, 400);
  }

  try {
    if (operation === "delete") {
      await deleteContentRow(env, entity as ContentEntity, id);
    } else {
      if (!isRecord(payload.data)) {
        return jsonNoStore({ ok: false, error: "Upsert data is required." }, 400);
      }
      if (payload.data.id !== id) {
        return jsonNoStore({ ok: false, error: "Payload id mismatch." }, 400);
      }
      await upsertContentRow(env, entity as ContentEntity, payload.data);
    }

    return jsonNoStore({
      ok: true,
      entity,
      operation,
      id,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[ContentSync]", {
      entity,
      operation,
      id,
      message: error instanceof Error ? error.message.slice(0, 200) : "Unknown error",
    });

    const message = error instanceof Error ? error.message : "Content sync failed.";
    const isValidationError =
      message.includes("must be") ||
      message.includes("Invalid") ||
      message.includes("accepts global") ||
      message.includes("mismatch");

    return jsonNoStore(
      { ok: false, error: isValidationError ? message : "Content sync failed." },
      isValidationError ? 400 : 500,
    );
  }
}


type D1Row = Record<string, any>;

function rowsFromResult(result: any): D1Row[] {
  return Array.isArray(result?.results) ? result.results as D1Row[] : [];
}

function integerBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function normalizeCalendarReadRow(row: D1Row): D1Row {
  return {
    ...row,
    isPinned: integerBoolean(row.isPinned),
    isCompleted: integerBoolean(row.isCompleted),
    allDay: integerBoolean(row.allDay),
  };
}

function normalizeMottoReadRow(row: D1Row): D1Row {
  return {
    ...row,
    isActive: integerBoolean(row.isActive),
    isFeatured: integerBoolean(row.isFeatured),
  };
}

async function authorizeInternalContentRequest(request: Request, env: any): Promise<Response | null> {
  const configuredSecret = typeof env.CONTENT_SYNC_SECRET === "string"
    ? env.CONTENT_SYNC_SECRET
    : "";
  if (!configuredSecret) {
    return jsonNoStore({ ok: false, error: "Content service is not configured." }, 503);
  }
  const suppliedSecret = request.headers.get("X-Content-Sync-Secret") || "";
  if (!suppliedSecret || !(await secretsEqual(suppliedSecret, configuredSecret))) {
    return jsonNoStore({ ok: false, error: "Unauthorized." }, 401);
  }
  return null;
}

function buildLectureFilter(url: URL): { sql: string; binds: string[] } {
  const allowed = ["mainSubject", "subSubject", "trackMode", "department"] as const;
  const clauses: string[] = [];
  const binds: string[] = [];
  for (const field of allowed) {
    const value = url.searchParams.get(field)?.trim();
    if (!value) continue;
    clauses.push(`LOWER("${field}") = LOWER(?)`);
    binds.push(value);
  }
  return {
    sql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    binds,
  };
}

async function readLectures(env: any, url: URL): Promise<D1Row[]> {
  const filter = buildLectureFilter(url);
  const lectures = rowsFromResult(await env.DB.prepare(`
    SELECT "id","name","mainSubject","subSubject","trackMode","department","createdAt"
    FROM "Lecture"${filter.sql}
    ORDER BY "createdAt" ASC, "id" ASC
    LIMIT 2000
  `).bind(...filter.binds).all());
  if (lectures.length === 0) return [];

  const wanted = new Set(lectures.map((row) => String(row.id)));
  const [materialsResult, mcqsResult, flashcardsResult] = await Promise.all([
    env.DB.prepare(`
      SELECT "id","title","type","fileUrlOrLink","lectureId","createdAt","storagePath"
      FROM "Material" ORDER BY "createdAt" ASC, "id" ASC LIMIT 10000
    `).all(),
    env.DB.prepare(`SELECT "id","lectureId" FROM "Mcq" ORDER BY "createdAt" ASC, "id" ASC LIMIT 20000`).all(),
    env.DB.prepare(`SELECT "id","lectureId" FROM "Flashcard" ORDER BY "createdAt" ASC, "id" ASC LIMIT 20000`).all(),
  ]);

  const materialsByLecture = new Map<string, D1Row[]>();
  for (const row of rowsFromResult(materialsResult)) {
    const lectureId = String(row.lectureId || "");
    if (!wanted.has(lectureId)) continue;
    const list = materialsByLecture.get(lectureId) ?? [];
    list.push(row);
    materialsByLecture.set(lectureId, list);
  }
  const mcqsByLecture = new Map<string, D1Row[]>();
  for (const row of rowsFromResult(mcqsResult)) {
    const lectureId = String(row.lectureId || "");
    if (!wanted.has(lectureId)) continue;
    const list = mcqsByLecture.get(lectureId) ?? [];
    list.push({ id: row.id });
    mcqsByLecture.set(lectureId, list);
  }
  const flashcardsByLecture = new Map<string, D1Row[]>();
  for (const row of rowsFromResult(flashcardsResult)) {
    const lectureId = String(row.lectureId || "");
    if (!wanted.has(lectureId)) continue;
    const list = flashcardsByLecture.get(lectureId) ?? [];
    list.push({ id: row.id });
    flashcardsByLecture.set(lectureId, list);
  }

  return lectures.map((lecture) => ({
    ...lecture,
    materials: materialsByLecture.get(String(lecture.id)) ?? [],
    mcqs: mcqsByLecture.get(String(lecture.id)) ?? [],
    flashcards: flashcardsByLecture.get(String(lecture.id)) ?? [],
  }));
}

async function readLectureDetail(env: any, id: string): Promise<D1Row | null> {
  const lecture = await env.DB.prepare(`
    SELECT "id","name","mainSubject","subSubject","trackMode","department","createdAt"
    FROM "Lecture" WHERE "id" = ? LIMIT 1
  `).bind(id).first();
  if (!lecture) return null;

  const [materialsResult, mcqsResult, flashcardsResult] = await Promise.all([
    env.DB.prepare(`
      SELECT "id","title","type","fileUrlOrLink","lectureId","createdAt","storagePath"
      FROM "Material" WHERE "lectureId" = ? ORDER BY "createdAt" ASC, "id" ASC
    `).bind(id).all(),
    env.DB.prepare(`
      SELECT "id","question","optionA","optionB","optionC","optionD","hint","explanation",
             "sourceType","sourceRef","difficulty","lectureId","createdAt"
      FROM "Mcq" WHERE "lectureId" = ? ORDER BY "createdAt" ASC, "id" ASC
    `).bind(id).all(),
    env.DB.prepare(`
      SELECT "id","clinicalConcept","explanation","lectureId","createdAt"
      FROM "Flashcard" WHERE "lectureId" = ? ORDER BY "createdAt" ASC, "id" ASC
    `).bind(id).all(),
  ]);

  return {
    ...lecture,
    materials: rowsFromResult(materialsResult),
    mcqs: rowsFromResult(mcqsResult),
    flashcards: rowsFromResult(flashcardsResult),
  };
}

async function readMaterialsData(env: any, scope: string): Promise<Record<string, D1Row[]>> {
  const normalizedScope = scope === "subjects" || scope === "offline" ? scope : "full";
  const needsSubjects = normalizedScope === "full" || normalizedScope === "subjects";
  const needsOffline = normalizedScope === "full" || normalizedScope === "offline";
  const needsCalendar = normalizedScope === "full";

  const lectures = needsSubjects ? await readLectures(env, new URL("https://internal/lectures")) : [];
  const [mcqsResult, flashcardsResult, materialsResult, eventsResult] = await Promise.all([
    needsOffline ? env.DB.prepare(`
      SELECT "id","question","optionA","optionB","optionC","optionD","correctAnswer","hint","explanation",
             "sourceType","sourceRef","difficulty","lectureId","createdAt"
      FROM "Mcq" ORDER BY "createdAt" ASC, "id" ASC LIMIT 20000
    `).all() : Promise.resolve({ results: [] }),
    needsOffline ? env.DB.prepare(`
      SELECT "id","clinicalConcept","explanation","lectureId","createdAt"
      FROM "Flashcard" ORDER BY "createdAt" ASC, "id" ASC LIMIT 20000
    `).all() : Promise.resolve({ results: [] }),
    needsSubjects ? env.DB.prepare(`
      SELECT "id","title","type","fileUrlOrLink","lectureId","createdAt","storagePath"
      FROM "Material" ORDER BY "createdAt" ASC, "id" ASC LIMIT 10000
    `).all() : Promise.resolve({ results: [] }),
    needsCalendar ? env.DB.prepare(`
      SELECT "id","userId","title","eventType","startDateTime","endDateTime","targetGroups","description",
             "subjectId","lectureId","room","doctor","notes","isPinned","isCompleted","allDay",
             "importSource","sourceDocumentName","sourceDocumentSha256","sourcePage","importFingerprint"
      FROM "CalendarEvent" WHERE "userId" IS NULL
      ORDER BY "startDateTime" ASC, "id" ASC LIMIT 2000
    `).all() : Promise.resolve({ results: [] }),
  ]);

  return {
    lectures,
    mcqs: rowsFromResult(mcqsResult),
    flashcards: rowsFromResult(flashcardsResult),
    materials: rowsFromResult(materialsResult),
    events: rowsFromResult(eventsResult).map(normalizeCalendarReadRow),
  };
}

function searchConditions(columns: string[], terms: string[]): { sql: string; binds: string[] } {
  const clauses: string[] = [];
  const binds: string[] = [];
  for (const term of terms) {
    const inner = columns.map((column) => `LOWER(${column}) LIKE ?`);
    clauses.push(`(${inner.join(" OR ")})`);
    for (let i = 0; i < columns.length; i += 1) binds.push(`%${term.toLowerCase()}%`);
  }
  return { sql: clauses.length > 0 ? clauses.join(" OR ") : "1=0", binds };
}

async function readSearch(env: any, query: string): Promise<D1Row[]> {
  const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 8);
  if (terms.length === 0) return [];
  const lectureWhere = searchConditions([`"name"`, `"mainSubject"`], terms);
  const materialWhere = searchConditions([`"title"`], terms);
  const mcqWhere = searchConditions([`"question"`], terms);
  const flashcardWhere = searchConditions([`"clinicalConcept"`, `"explanation"`], terms);

  const [lecturesResult, materialsResult, mcqsResult, flashcardsResult] = await Promise.all([
    env.DB.prepare(`
      SELECT "id","name","mainSubject","subSubject" FROM "Lecture"
      WHERE ${lectureWhere.sql} ORDER BY "createdAt" ASC LIMIT 10
    `).bind(...lectureWhere.binds).all(),
    env.DB.prepare(`
      SELECT "id","title","type","lectureId" FROM "Material"
      WHERE ${materialWhere.sql} ORDER BY "createdAt" ASC LIMIT 10
    `).bind(...materialWhere.binds).all(),
    env.DB.prepare(`
      SELECT "id","question","lectureId","sourceType","difficulty" FROM "Mcq"
      WHERE ${mcqWhere.sql} ORDER BY "createdAt" ASC LIMIT 10
    `).bind(...mcqWhere.binds).all(),
    env.DB.prepare(`
      SELECT "id","clinicalConcept","lectureId" FROM "Flashcard"
      WHERE ${flashcardWhere.sql} ORDER BY "createdAt" ASC LIMIT 10
    `).bind(...flashcardWhere.binds).all(),
  ]);

  const lectures = rowsFromResult(lecturesResult);
  const materials = rowsFromResult(materialsResult);
  const mcqs = rowsFromResult(mcqsResult);
  const flashcards = rowsFromResult(flashcardsResult);
  const subjectByLecture = new Map<string, string>();
  for (const lecture of lectures) subjectByLecture.set(String(lecture.id), String(lecture.mainSubject));

  const missingLectureIds = Array.from(new Set([
    ...materials.map((row) => String(row.lectureId || "")),
    ...mcqs.map((row) => String(row.lectureId || "")),
    ...flashcards.map((row) => String(row.lectureId || "")),
  ].filter((id) => id && !subjectByLecture.has(id))));

  if (missingLectureIds.length > 0) {
    const placeholders = missingLectureIds.map(() => "?").join(",");
    const related = rowsFromResult(await env.DB.prepare(`
      SELECT "id","mainSubject" FROM "Lecture" WHERE "id" IN (${placeholders})
    `).bind(...missingLectureIds).all());
    for (const row of related) subjectByLecture.set(String(row.id), String(row.mainSubject));
  }

  const results = new Map<string, D1Row>();
  for (const row of lectures) {
    const key = `db-lecture-${row.id}`;
    results.set(key, {
      id: key,
      title: row.name,
      subtitle: row.subSubject || row.mainSubject,
      type: "lecture",
      lectureId: row.id,
      subjectId: row.mainSubject,
      raw: row,
    });
  }
  for (const row of materials) {
    const typeMap: Record<string, string> = { PDF: "pdf", NOTE: "notes", VIDEO: "video" };
    const resultType = typeMap[String(row.type || "").toUpperCase()] || "pdf";
    const key = `db-${resultType}-${row.id}`;
    results.set(key, {
      id: key,
      title: `${row.title} (${resultType === "video" ? "Video" : resultType === "notes" ? "Notes" : "PDF"})`,
      subtitle: row.title,
      type: resultType,
      lectureId: row.lectureId,
      subjectId: subjectByLecture.get(String(row.lectureId)),
      raw: row,
    });
  }
  for (const row of mcqs) {
    const key = `db-mcq-${row.id}`;
    results.set(key, {
      id: key,
      title: row.question,
      subtitle: "Quiz Question",
      type: "mcq",
      lectureId: row.lectureId,
      subjectId: subjectByLecture.get(String(row.lectureId)),
      raw: row,
    });
  }
  for (const row of flashcards) {
    const key = `db-flashcard-${row.id}`;
    results.set(key, {
      id: key,
      title: row.clinicalConcept,
      subtitle: "Flashcard",
      type: "flashcard",
      lectureId: row.lectureId,
      subjectId: subjectByLecture.get(String(row.lectureId)),
      raw: row,
    });
  }

  const queryLower = query.toLowerCase();
  const subjects = new Set(subjectByLecture.values());
  for (const subject of subjects) {
    if (!subject.toLowerCase().includes(queryLower)) continue;
    const key = `subject-${subject}`;
    if (!results.has(key)) {
      results.set(key, { id: key, title: subject, subtitle: "Subject", type: "subject", subjectId: subject });
    }
  }
  return Array.from(results.values());
}

async function contentTableCounts(env: any): Promise<Record<string, number>> {
  const tables = ["Lecture", "Material", "ModuleResource", "Mcq", "Flashcard", "DailyMotto", "CalendarEvent"];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).first();
    counts[table] = Number(row?.count || 0);
  }
  return counts;
}

async function contentEntityIds(env: any, entity: string): Promise<string[] | null> {
  const allowed = new Set(["Lecture", "Material", "ModuleResource", "Mcq", "Flashcard", "DailyMotto", "CalendarEvent"]);
  if (!allowed.has(entity)) return null;
  const rows = rowsFromResult(await env.DB.prepare(`SELECT "id" FROM "${entity}" ORDER BY "id" ASC`).all());
  return rows.map((row) => String(row.id));
}

async function handleInternalContentRead(request: Request, env: any, url: URL): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } });
  }
  const authFailure = await authorizeInternalContentRequest(request, env);
  if (authFailure) return authFailure;

  const prefix = "/internal/content-read";
  const path = url.pathname.slice(prefix.length) || "/";
  try {
    if (path === "/lectures") {
      return jsonNoStore(await readLectures(env, url));
    }
    if (path.startsWith("/lectures/")) {
      const id = decodeURIComponent(path.slice("/lectures/".length));
      if (!id) return jsonNoStore({ error: "Lecture id is required." }, 400);
      const lecture = await readLectureDetail(env, id);
      return lecture ? jsonNoStore(lecture) : jsonNoStore({ error: "Lecture not found." }, 404);
    }
    if (path === "/materials-data") {
      return jsonNoStore(await readMaterialsData(env, url.searchParams.get("scope") || "full"));
    }
    if (path === "/search") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) return jsonNoStore([]);
      return jsonNoStore(await readSearch(env, q));
    }
    if (path === "/calendar/global") {
      const rows = rowsFromResult(await env.DB.prepare(`
        SELECT "id","userId","title","eventType","startDateTime","endDateTime","targetGroups","description",
               "subjectId","lectureId","room","doctor","notes","isPinned","isCompleted","allDay",
               "importSource","sourceDocumentName","sourceDocumentSha256","sourcePage","importFingerprint"
        FROM "CalendarEvent" WHERE "userId" IS NULL
        ORDER BY "startDateTime" ASC, "id" ASC LIMIT 2000
      `).all()).map(normalizeCalendarReadRow);
      return jsonNoStore({ events: rows });
    }
    if (path === "/mottos/active") {
      const rows = rowsFromResult(await env.DB.prepare(`
        SELECT "id","message","isActive","isFeatured","createdBy","createdAt","updatedAt"
        FROM "DailyMotto" WHERE "isActive" = 1
        ORDER BY "createdAt" DESC, "id" ASC LIMIT 100
      `).all()).map(normalizeMottoReadRow);
      return jsonNoStore({ mottos: rows });
    }
    if (path === "/flashcards") {
      const rows = rowsFromResult(await env.DB.prepare(`
        SELECT "id","clinicalConcept","explanation","lectureId","createdAt"
        FROM "Flashcard" ORDER BY "createdAt" ASC, "id" ASC LIMIT 20000
      `).all());
      return jsonNoStore(rows);
    }
    if (path.startsWith("/module-resources/")) {
      const moduleId = decodeURIComponent(path.slice("/module-resources/".length));
      if (!moduleId) return jsonNoStore({ error: "Module id is required." }, 400);
      const rows = rowsFromResult(await env.DB.prepare(`
        SELECT "id","moduleId","title","fileSizeBytes","status","createdAt","storagePath"
        FROM "ModuleResource" WHERE "moduleId" = ? AND "status" = 'READY'
        ORDER BY "createdAt" ASC, "id" ASC
      `).bind(moduleId).all());
      return jsonNoStore({ resources: rows });
    }
    if (path.startsWith("/module-resource/")) {
      const id = decodeURIComponent(path.slice("/module-resource/".length));
      const row = await env.DB.prepare(`
        SELECT "id","moduleId","title","fileSizeBytes","status","createdAt","storagePath"
        FROM "ModuleResource" WHERE "id" = ? LIMIT 1
      `).bind(id).first();
      return row ? jsonNoStore({ resource: row }) : jsonNoStore({ error: "Module resource not found." }, 404);
    }
    if (path === "/counts") {
      return jsonNoStore({ counts: await contentTableCounts(env) });
    }
    if (path === "/ids") {
      const entity = url.searchParams.get("entity") || "";
      const ids = await contentEntityIds(env, entity);
      return ids ? jsonNoStore({ entity, ids }) : jsonNoStore({ error: "Unsupported entity." }, 400);
    }
    return jsonNoStore({ error: "Content read route not found." }, 404);
  } catch (error) {
    console.error("[ContentRead]", {
      path,
      message: error instanceof Error ? error.message.slice(0, 200) : "Unknown error",
    });
    return jsonNoStore({ error: "Content read failed." }, 500);
  }
}

async function applyContentMutation(env: any, payload: unknown): Promise<{ entity: ContentEntity; operation: "upsert" | "delete"; id: string }> {
  if (!isRecord(payload)) throw new Error("Invalid content sync payload.");
  const entity = payload.entity;
  const operation = payload.operation;
  const version = payload.version;
  const validEntities: ContentEntity[] = ["Lecture", "Material", "ModuleResource", "Mcq", "Flashcard", "DailyMotto", "CalendarEvent"];
  const id = validateMutationId(payload.id);
  if (version !== 1 || !validEntities.includes(entity as ContentEntity)) {
    throw new Error("Unsupported content sync payload.");
  }
  if (operation !== "upsert" && operation !== "delete") {
    throw new Error("Unsupported content sync operation.");
  }
  if (operation === "delete") {
    await deleteContentRow(env, entity as ContentEntity, id);
  } else {
    if (!isRecord(payload.data)) throw new Error("Upsert data is required.");
    if (payload.data.id !== id) throw new Error("Payload id mismatch.");
    await upsertContentRow(env, entity as ContentEntity, payload.data);
  }
  return { entity: entity as ContentEntity, operation, id };
}

async function handleInternalContentSyncBatch(request: Request, env: any): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
  }
  const authFailure = await authorizeInternalContentRequest(request, env);
  if (authFailure) return authFailure;
  const rawBody = await request.text();
  if (rawBody.length > 4 * 1024 * 1024) return jsonNoStore({ ok: false, error: "Payload too large." }, 413);
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return jsonNoStore({ ok: false, error: "Invalid JSON." }, 400); }
  if (!isRecord(payload) || !Array.isArray(payload.mutations)) {
    return jsonNoStore({ ok: false, error: "mutations array is required." }, 400);
  }
  if (payload.mutations.length < 1 || payload.mutations.length > 200) {
    return jsonNoStore({ ok: false, error: "Batch must contain 1 to 200 mutations." }, 400);
  }
  const applied: Array<{ entity: ContentEntity; operation: "upsert" | "delete"; id: string }> = [];
  try {
    for (const mutation of payload.mutations) applied.push(await applyContentMutation(env, mutation));
    return jsonNoStore({ ok: true, applied: applied.length, syncedAt: new Date().toISOString() });
  } catch (error) {
    console.error("[ContentSyncBatch]", { applied: applied.length, message: error instanceof Error ? error.message.slice(0, 200) : "Unknown error" });
    return jsonNoStore({ ok: false, applied: applied.length, error: error instanceof Error ? error.message : "Content sync batch failed." }, 400);
  }
}

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);

    // ---------------------------------------------------------
    // HEALTH CHECK
    // ---------------------------------------------------------
    if (url.pathname === "/health") {
      try {
        const dbResult = await env.DB
          .prepare("SELECT 1 AS ok")
          .first();

        const r2Result = await env.FILES.list({
          limit: 1,
        });

        return Response.json({
          ok: true,

          worker: {
            status: "ready",
          },

          d1: {
            connected: dbResult?.ok === 1,
          },

          r2: {
            connected: true,
            objectCheckCompleted: true,
            returnedObjects: r2Result.objects.length,
          },

          contentSync: {
            configured: typeof env.CONTENT_SYNC_SECRET === "string" && env.CONTENT_SYNC_SECRET.length > 0,
          },

          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("[Health]", error);

        return Response.json(
          {
            ok: false,
            error: "Cloudflare resource binding check failed",
          },
          {
            status: 500,
          },
        );
      }
    }

    // ---------------------------------------------------------
    // PRIVATE RENDER -> D1 CONTENT SYNC
    // ---------------------------------------------------------
    if (url.pathname === "/internal/content-sync") {
      return handleInternalContentSync(request, env);
    }

    if (url.pathname === "/internal/content-sync/batch") {
      return handleInternalContentSyncBatch(request, env);
    }

    if (url.pathname.startsWith("/internal/content-read")) {
      return handleInternalContentRead(request, env, url);
    }

    // ---------------------------------------------------------
    // PUBLIC AVATAR DELIVERY
    //
    // URL:
    // /avatars/<userId>/<filename>
    //
    // R2:
    // avatars/<userId>/<filename>
    // ---------------------------------------------------------
    if (url.pathname.startsWith("/avatars/")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: {
            Allow: "GET, HEAD",
          },
        });
      }

      const parts = url.pathname
        .split("/")
        .filter(Boolean);

      // Expected:
      // ["avatars", "<userId>", "<filename>"]
      if (parts.length !== 3) {
        return new Response("Not Found", {
          status: 404,
        });
      }

      const userId = parts[1];
      const fileName = parts[2];

      // Strict validation prevents arbitrary R2 object access.
      if (
        !/^[A-Za-z0-9_-]+$/.test(userId) ||
        !/^[A-Za-z0-9_-]+\.(webp|png|jpg|jpeg)$/i.test(fileName)
      ) {
        return new Response("Invalid avatar path", {
          status: 400,
        });
      }

      const objectKey = `avatars/${userId}/${fileName}`;

      try {
        const object = await env.FILES.get(objectKey);

        if (!object) {
          return new Response("Avatar Not Found", {
            status: 404,
            headers: {
              "Cache-Control": "no-store",
            },
          });
        }

        const headers = new Headers();

        object.writeHttpMetadata(headers);

        headers.set(
          "Content-Type",
          headers.get("Content-Type") || "image/webp",
        );

        if (object.httpEtag) {
          headers.set("ETag", object.httpEtag);
        }

        // Our future avatar filenames are versioned.
        // Therefore each URL can safely be cached for a long time.
        headers.set(
          "Cache-Control",
          "public, max-age=31536000, immutable",
        );

        headers.set(
          "X-Content-Type-Options",
          "nosniff",
        );

        headers.set(
          "Access-Control-Allow-Origin",
          "*",
        );

        if (request.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers,
          });
        }

        return new Response(object.body, {
          status: 200,
          headers,
        });
      } catch (error) {
        console.error("[AvatarDelivery]", error);

        return new Response("Avatar delivery failed", {
          status: 500,
        });
      }
    }

    return new Response("Not Found", {
      status: 404,
    });
  },
};
