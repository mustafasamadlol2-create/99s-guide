type ContentEntity =
  | "Lecture"
  | "Material"
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

    case "Mcq": {
      const id = validateMutationId(data.id);
      const correctAnswer = requireText(data, "correctAnswer").toUpperCase();
      if (!["A", "B", "C", "D"].includes(correctAnswer)) {
        throw new Error("correctAnswer must be A, B, C, or D.");
      }

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
        requireText(data, "sourceType"),
        typeof data.sourceRef === "string" ? data.sourceRef : "",
        requireText(data, "difficulty"),
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
           "description","subjectId","lectureId","room","doctor","notes","isPinned","isCompleted")
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
          "isCompleted"=excluded."isCompleted"
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
      ).run();
      return;
    }
  }
}

async function deleteContentRow(env: any, entity: ContentEntity, id: string): Promise<void> {
  const tableByEntity: Record<ContentEntity, string> = {
    Lecture: "Lecture",
    Material: "Material",
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


type D1RowsResult<T = Record<string, unknown>> = {
  results?: T[];
};

function d1Rows<T = Record<string, unknown>>(result: D1RowsResult<T> | null | undefined): T[] {
  return Array.isArray(result?.results) ? result!.results! : [];
}

async function authorizeInternalContentRead(request: Request, env: any): Promise<Response | null> {
  const configuredSecret =
    typeof env.CONTENT_SYNC_SECRET === "string" ? env.CONTENT_SYNC_SECRET : "";

  if (!configuredSecret) {
    return jsonNoStore({ ok: false, error: "Content read shadow endpoint is not configured." }, 503);
  }

  const suppliedSecret = request.headers.get("X-Content-Sync-Secret") || "";
  if (!suppliedSecret || !(await secretsEqual(suppliedSecret, configuredSecret))) {
    return jsonNoStore({ ok: false, error: "Unauthorized." }, 401);
  }

  return null;
}

function validateReadId(raw: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new Error("Invalid lecture id.");
  }
  return validateMutationId(decoded);
}

function lectureFilterStatement(url: URL): { sql: string; values: string[] } {
  const allowed = ["mainSubject", "subSubject", "trackMode", "department"] as const;
  const clauses: string[] = [];
  const values: string[] = [];

  for (const key of allowed) {
    const value = url.searchParams.get(key);
    if (typeof value === "string" && value.trim()) {
      clauses.push(`LOWER("${key}") = LOWER(?)`);
      values.push(value.trim());
    }
  }

  return {
    sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}

async function readLectureListFromD1(url: URL, env: any): Promise<Response> {
  const { sql: whereSql, values } = lectureFilterStatement(url);

  const lectureStmt = env.DB.prepare(`
    SELECT "id","name","mainSubject","subSubject","trackMode","department","createdAt"
    FROM "Lecture"
    ${whereSql}
    ORDER BY "createdAt" DESC
  `).bind(...values);

  // These collections are small shared-content tables. Reading them once and
  // grouping in memory avoids an N+1 D1 query pattern for the lecture list.
  const [lectureResult, materialResult, mcqResult, flashcardResult] = await env.DB.batch([
    lectureStmt,
    env.DB.prepare(`
      SELECT "id","title","type","fileUrlOrLink","lectureId","createdAt"
      FROM "Material"
      ORDER BY "createdAt" ASC, "id" ASC
    `),
    env.DB.prepare(`
      SELECT "id","lectureId"
      FROM "Mcq"
      ORDER BY "id" ASC
    `),
    env.DB.prepare(`
      SELECT "id","lectureId"
      FROM "Flashcard"
      ORDER BY "id" ASC
    `),
  ]);

  const lectures = d1Rows<any>(lectureResult);
  const selectedIds = new Set(lectures.map((row: any) => String(row.id)));

  const materialsByLecture = new Map<string, any[]>();
  for (const row of d1Rows<any>(materialResult)) {
    const lectureId = String(row.lectureId);
    if (!selectedIds.has(lectureId)) continue;
    const bucket = materialsByLecture.get(lectureId) || [];
    bucket.push({
      id: row.id,
      title: row.title,
      type: row.type,
      fileUrlOrLink: row.fileUrlOrLink,
      lectureId: row.lectureId,
      createdAt: row.createdAt,
    });
    materialsByLecture.set(lectureId, bucket);
  }

  const mcqsByLecture = new Map<string, any[]>();
  for (const row of d1Rows<any>(mcqResult)) {
    const lectureId = String(row.lectureId);
    if (!selectedIds.has(lectureId)) continue;
    const bucket = mcqsByLecture.get(lectureId) || [];
    bucket.push({ id: row.id });
    mcqsByLecture.set(lectureId, bucket);
  }

  const flashcardsByLecture = new Map<string, any[]>();
  for (const row of d1Rows<any>(flashcardResult)) {
    const lectureId = String(row.lectureId);
    if (!selectedIds.has(lectureId)) continue;
    const bucket = flashcardsByLecture.get(lectureId) || [];
    bucket.push({ id: row.id });
    flashcardsByLecture.set(lectureId, bucket);
  }

  const payload = lectures.map((lecture: any) => ({
    id: lecture.id,
    name: lecture.name,
    mainSubject: lecture.mainSubject,
    subSubject: lecture.subSubject,
    trackMode: lecture.trackMode,
    department: lecture.department,
    createdAt: lecture.createdAt,
    materials: materialsByLecture.get(String(lecture.id)) || [],
    mcqs: mcqsByLecture.get(String(lecture.id)) || [],
    flashcards: flashcardsByLecture.get(String(lecture.id)) || [],
  }));

  return jsonNoStore(payload);
}

async function readLectureDetailFromD1(id: string, env: any): Promise<Response> {
  const lecture = await env.DB.prepare(`
    SELECT "id","name","mainSubject","subSubject","trackMode","department","createdAt"
    FROM "Lecture"
    WHERE "id" = ?
    LIMIT 1
  `).bind(id).first();

  if (!lecture) {
    return jsonNoStore({ error: "Lecture not found" }, 404);
  }

  const [materialResult, mcqResult, flashcardResult] = await env.DB.batch([
    env.DB.prepare(`
      SELECT "id","title","type","fileUrlOrLink","lectureId","createdAt"
      FROM "Material"
      WHERE "lectureId" = ?
      ORDER BY "createdAt" ASC, "id" ASC
    `).bind(id),
    env.DB.prepare(`
      SELECT
        "id","question","optionA","optionB","optionC","optionD",
        "hint","explanation","sourceType","sourceRef","difficulty",
        "lectureId","createdAt"
      FROM "Mcq"
      WHERE "lectureId" = ?
      ORDER BY "createdAt" ASC, "id" ASC
    `).bind(id),
    env.DB.prepare(`
      SELECT "id","clinicalConcept","explanation","lectureId","createdAt"
      FROM "Flashcard"
      WHERE "lectureId" = ?
      ORDER BY "createdAt" ASC, "id" ASC
    `).bind(id),
  ]);

  // SECURITY: correctAnswer intentionally does not appear in the SELECT above.
  // It remains available only to the authoritative grading path.
  return jsonNoStore({
    ...lecture,
    materials: d1Rows<any>(materialResult),
    mcqs: d1Rows<any>(mcqResult),
    flashcards: d1Rows<any>(flashcardResult),
  });
}


type MaterialsReadScope = "full" | "subjects" | "offline";

function parseMaterialsReadScope(url: URL): MaterialsReadScope {
  const requested = url.searchParams.get("scope");
  if (requested === "subjects" || requested === "offline") return requested;
  return "full";
}

function normalizeD1CalendarEvent(row: any): any {
  return {
    id: row.id,
    userId: row.userId ?? null,
    title: row.title,
    eventType: row.eventType,
    startDateTime: row.startDateTime,
    endDateTime: row.endDateTime,
    targetGroups: row.targetGroups,
    description: row.description ?? null,
    subjectId: row.subjectId ?? null,
    lectureId: row.lectureId ?? null,
    room: row.room ?? null,
    doctor: row.doctor ?? null,
    notes: row.notes ?? null,
    isPinned: row.isPinned === 1 || row.isPinned === true,
    isCompleted: row.isCompleted === 1 || row.isCompleted === true,
  };
}

async function readMaterialsDataFromD1(url: URL, env: any): Promise<Response> {
  const scope = parseMaterialsReadScope(url);
  const needsSubjects = scope === "full" || scope === "subjects";
  const needsOfflineStudyData = scope === "full" || scope === "offline";
  const needsCalendar = scope === "full";

  let lectures: any[] = [];
  let mcqs: any[] = [];
  let flashcards: any[] = [];
  let materials: any[] = [];
  let events: any[] = [];

  if (needsSubjects) {
    // Current Render /api/materials uses take: 2000 for Lecture and Material.
    // Nested material metadata is built from D1 without correctAnswer or binary data.
    const [lectureResult, nestedMaterialResult, materialResult] = await env.DB.batch([
      env.DB.prepare(`
        SELECT "id","name","mainSubject","subSubject","trackMode","department","createdAt"
        FROM "Lecture"
        ORDER BY "createdAt" DESC
        LIMIT 2000
      `),
      env.DB.prepare(`
        SELECT "id","title","type","fileUrlOrLink","lectureId"
        FROM "Material"
      `),
      env.DB.prepare(`
        SELECT "id","title","type","fileUrlOrLink","lectureId"
        FROM "Material"
        LIMIT 2000
      `),
    ]);

    const lectureRows = d1Rows<any>(lectureResult);
    const selectedLectureIds = new Set(lectureRows.map((row: any) => String(row.id)));

    const materialsByLecture = new Map<string, any[]>();
    for (const row of d1Rows<any>(nestedMaterialResult)) {
      const lectureId = String(row.lectureId);
      if (!selectedLectureIds.has(lectureId)) continue;
      const bucket = materialsByLecture.get(lectureId) || [];
      bucket.push({
        id: row.id,
        title: row.title,
        type: row.type,
        fileUrlOrLink: row.fileUrlOrLink,
        lectureId: row.lectureId,
      });
      materialsByLecture.set(lectureId, bucket);
    }

    lectures = lectureRows.map((row: any) => ({
      id: row.id,
      name: row.name,
      mainSubject: row.mainSubject,
      subSubject: row.subSubject ?? null,
      trackMode: row.trackMode,
      department: row.department ?? null,
      createdAt: row.createdAt,
      materials: materialsByLecture.get(String(row.id)) || [],
    }));

    materials = d1Rows<any>(materialResult).map((row: any) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      fileUrlOrLink: row.fileUrlOrLink,
      lectureId: row.lectureId,
    }));
  }

  if (needsOfflineStudyData) {
    const [mcqResult, flashcardResult] = await env.DB.batch([
      env.DB.prepare(`
        SELECT
          "id","question","optionA","optionB","optionC","optionD",
          "hint","explanation","sourceType","sourceRef","difficulty",
          "lectureId","createdAt"
        FROM "Mcq"
        LIMIT 2000
      `),
      env.DB.prepare(`
        SELECT "id","clinicalConcept","explanation","lectureId","createdAt"
        FROM "Flashcard"
        LIMIT 2000
      `),
    ]);

    // SECURITY: correctAnswer is intentionally absent from this SELECT.
    mcqs = d1Rows<any>(mcqResult);
    flashcards = d1Rows<any>(flashcardResult);
  }

  if (needsCalendar) {
    const eventResult = await env.DB.prepare(`
      SELECT
        "id","userId","title","eventType","startDateTime","endDateTime",
        "targetGroups","description","subjectId","lectureId","room","doctor",
        "notes","isPinned","isCompleted"
      FROM "CalendarEvent"
      WHERE "userId" IS NULL
      LIMIT 2000
    `).all();

    events = d1Rows<any>(eventResult).map(normalizeD1CalendarEvent);
  }

  return jsonNoStore({
    scope,
    lectures,
    mcqs,
    flashcards,
    materials,
    events,
  });
}


async function readActiveMottosFromD1(env: any): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT
      "id","message","isActive","isFeatured","createdBy","createdAt","updatedAt"
    FROM "DailyMotto"
    WHERE "isActive" = 1
    ORDER BY "createdAt" DESC
    LIMIT 100
  `).all();

  const mottos = d1Rows<any>(result).map((row: any) => ({
    id: row.id,
    message: row.message,
    isActive: row.isActive === 1 || row.isActive === true,
    isFeatured: row.isFeatured === 1 || row.isFeatured === true,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  return jsonNoStore({ mottos });
}


function parseCalendarTargetGroups(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((v) => v.trim().toUpperCase()).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);
}

async function readGlobalCalendarFromD1(env: any): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT
      "id","userId","title","eventType","startDateTime","endDateTime",
      "targetGroups","description","subjectId","lectureId","room","doctor",
      "notes","isPinned","isCompleted"
    FROM "CalendarEvent"
    WHERE "userId" IS NULL
    ORDER BY "startDateTime" ASC
    LIMIT 1000
  `).all();

  const events = d1Rows<any>(result).map((row: any) => ({
    id: row.id,
    userId: null,
    title: row.title,
    eventType: row.eventType,
    startDateTime: row.startDateTime,
    endDateTime: row.endDateTime,
    targetGroups: parseCalendarTargetGroups(row.targetGroups),
    description: row.description ?? null,
    subjectId: row.subjectId ?? null,
    lectureId: row.lectureId ?? null,
    room: row.room ?? null,
    doctor: row.doctor ?? null,
    notes: row.notes ?? null,
    isPinned: row.isPinned === 1 || row.isPinned === true,
    isCompleted: row.isCompleted === 1 || row.isCompleted === true,
  }));

  return jsonNoStore({ events });
}


function buildContainsAnySql(
  columns: string[],
  keywords: string[],
): { sql: string; bindings: string[] } {
  const clauses: string[] = [];
  const bindings: string[] = [];

  for (const keyword of keywords) {
    for (const column of columns) {
      clauses.push(`instr(lower(${column}), lower(?)) > 0`);
      bindings.push(keyword);
    }
  }

  return {
    sql: clauses.length > 0 ? `(${clauses.join(" OR ")})` : "0",
    bindings,
  };
}

async function readSearchFromD1(url: URL, env: any): Promise<Response> {
  const q = url.searchParams.get("q");

  if (!q || q.trim() === "") {
    return jsonNoStore([]);
  }

  const query = q.trim();

  if (query.length > 200) {
    return jsonNoStore(
      { error: "Search query is too long." },
      { status: 400 },
    );
  }

  const keywordFilters = query.split(/\s+/).filter((word) => word.length > 0);

  if (keywordFilters.length > 8) {
    return jsonNoStore(
      { error: "Search query contains too many terms." },
      { status: 400 },
    );
  }

  const lectureWhere = buildContainsAnySql(
    ['"name"', '"mainSubject"'],
    keywordFilters,
  );
  const materialWhere = buildContainsAnySql(['"title"'], keywordFilters);
  const mcqWhere = buildContainsAnySql(['"question"'], keywordFilters);
  const flashcardWhere = buildContainsAnySql(
    ['"clinicalConcept"', '"explanation"'],
    keywordFilters,
  );

  const [lectureResult, materialResult, mcqResult, flashcardResult] =
    await env.DB.batch([
      env.DB.prepare(`
        SELECT "id","name","mainSubject","subSubject"
        FROM "Lecture"
        WHERE ${lectureWhere.sql}
        LIMIT 10
      `).bind(...lectureWhere.bindings),

      env.DB.prepare(`
        SELECT "id","title","type","lectureId"
        FROM "Material"
        WHERE ${materialWhere.sql}
        LIMIT 10
      `).bind(...materialWhere.bindings),

      env.DB.prepare(`
        SELECT "id","question","lectureId"
        FROM "Mcq"
        WHERE ${mcqWhere.sql}
        LIMIT 10
      `).bind(...mcqWhere.bindings),

      env.DB.prepare(`
        SELECT "id","clinicalConcept","lectureId"
        FROM "Flashcard"
        WHERE ${flashcardWhere.sql}
        LIMIT 10
      `).bind(...flashcardWhere.bindings),
    ]);

  const lectures = d1Rows<any>(lectureResult);
  const materials = d1Rows<any>(materialResult);
  const mcqs = d1Rows<any>(mcqResult);
  const flashcards = d1Rows<any>(flashcardResult);

  const resultsMap = new Map<string, any>();
  const lectureToSubjectMap = new Map<string, string>();

  for (const lecture of lectures) {
    lectureToSubjectMap.set(String(lecture.id), String(lecture.mainSubject));
  }

  const unknownLectureIds = new Set<string>();

  for (const material of materials) {
    if (!lectureToSubjectMap.has(String(material.lectureId))) {
      unknownLectureIds.add(String(material.lectureId));
    }
  }

  for (const mcq of mcqs) {
    if (!lectureToSubjectMap.has(String(mcq.lectureId))) {
      unknownLectureIds.add(String(mcq.lectureId));
    }
  }

  for (const flashcard of flashcards) {
    if (!lectureToSubjectMap.has(String(flashcard.lectureId))) {
      unknownLectureIds.add(String(flashcard.lectureId));
    }
  }

  let relatedLectures: Array<{ id: string; mainSubject: string }> = [];

  if (unknownLectureIds.size > 0) {
    const ids = Array.from(unknownLectureIds);
    const placeholders = ids.map(() => "?").join(",");

    const result = await env.DB.prepare(`
      SELECT "id","mainSubject"
      FROM "Lecture"
      WHERE "id" IN (${placeholders})
    `).bind(...ids).all();

    relatedLectures = d1Rows<any>(result).map((row: any) => ({
      id: String(row.id),
      mainSubject: String(row.mainSubject),
    }));

    for (const lecture of relatedLectures) {
      lectureToSubjectMap.set(lecture.id, lecture.mainSubject);
    }
  }

  for (const lecture of lectures) {
    const key = `db-lecture-${lecture.id}`;
    if (!resultsMap.has(key)) {
      resultsMap.set(key, {
        id: key,
        title: lecture.name,
        subtitle: lecture.subSubject || lecture.mainSubject,
        type: "lecture",
        lectureId: lecture.id,
        subjectId: lecture.mainSubject,
        raw: {
          id: lecture.id,
          name: lecture.name,
          mainSubject: lecture.mainSubject,
          subSubject: lecture.subSubject ?? null,
        },
      });
    }
  }

  for (const material of materials) {
    const typeMap: Record<string, string> = {
      PDF: "pdf",
      NOTE: "notes",
      VIDEO: "video",
    };

    const type = typeMap[String(material.type)] || "pdf";
    const key = `db-${type}-${material.id}`;

    if (!resultsMap.has(key)) {
      resultsMap.set(key, {
        id: key,
        title: `${material.title} (${type === "video" ? "Video" : type === "notes" ? "Notes" : "PDF"})`,
        subtitle: material.title,
        type,
        lectureId: material.lectureId,
        subjectId: lectureToSubjectMap.get(String(material.lectureId)),
        raw: {
          id: material.id,
          title: material.title,
          type: material.type,
          lectureId: material.lectureId,
        },
      });
    }
  }

  for (const mcq of mcqs) {
    const key = `db-mcq-${mcq.id}`;

    if (!resultsMap.has(key)) {
      resultsMap.set(key, {
        id: key,
        title: mcq.question,
        subtitle: "Quiz Question",
        type: "mcq",
        lectureId: mcq.lectureId,
        subjectId: lectureToSubjectMap.get(String(mcq.lectureId)),
        raw: {
          id: mcq.id,
          question: mcq.question,
          lectureId: mcq.lectureId,
        },
      });
    }
  }

  for (const flashcard of flashcards) {
    const key = `db-flashcard-${flashcard.id}`;

    if (!resultsMap.has(key)) {
      resultsMap.set(key, {
        id: key,
        title: flashcard.clinicalConcept,
        subtitle: "Flashcard",
        type: "flashcard",
        lectureId: flashcard.lectureId,
        subjectId: lectureToSubjectMap.get(String(flashcard.lectureId)),
        raw: {
          id: flashcard.id,
          clinicalConcept: flashcard.clinicalConcept,
          lectureId: flashcard.lectureId,
        },
      });
    }
  }

  const subjectsSet = new Set<string>([
    ...lectures.map((lecture: any) => String(lecture.mainSubject)),
    ...relatedLectures.map((lecture) => lecture.mainSubject),
  ]);

  for (const subject of subjectsSet) {
    if (subject.toLowerCase().includes(query.toLowerCase())) {
      const key = `subject-${subject}`;

      if (!resultsMap.has(key)) {
        resultsMap.set(key, {
          id: key,
          title: subject,
          subtitle: "Subject",
          type: "subject",
          subjectId: subject,
        });
      }
    }
  }

  return jsonNoStore(Array.from(resultsMap.values()));
}

async function handleInternalContentRead(request: Request, env: any, url: URL): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET", "Cache-Control": "no-store" },
    });
  }

  const authFailure = await authorizeInternalContentRead(request, env);
  if (authFailure) return authFailure;

  if (url.pathname === "/internal/content-read/lectures") {
    return readLectureListFromD1(url, env);
  }

  if (url.pathname === "/internal/content-read/materials-data") {
    return readMaterialsDataFromD1(url, env);
  }

  if (url.pathname === "/internal/content-read/mottos/active") {
    return readActiveMottosFromD1(env);
  }

  if (url.pathname === "/internal/content-read/calendar/global") {
    return readGlobalCalendarFromD1(env);
  }

  if (url.pathname === "/internal/content-read/search") {
    return readSearchFromD1(url, env);
  }

  const match = url.pathname.match(/^\/internal\/content-read\/lectures\/([^/]+)$/);
  if (match) {
    try {
      return await readLectureDetailFromD1(validateReadId(match[1]), env);
    } catch (error) {
      return jsonNoStore(
        { ok: false, error: error instanceof Error ? error.message : "Invalid lecture id." },
        400,
      );
    }
  }

  return jsonNoStore({ error: "Not Found" }, 404);
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

    // ---------------------------------------------------------
    // STAGE 5A — PRIVATE D1 SHADOW READS
    //
    // These routes are intentionally NOT used by the production client yet.
    // They let us verify D1 response contracts before any read cutover.
    // ---------------------------------------------------------
    if (url.pathname === "/internal/content-read/lectures" ||
        url.pathname.startsWith("/internal/content-read/lectures/") ||
        url.pathname === "/internal/content-read/materials-data" ||
        url.pathname === "/internal/content-read/mottos/active" ||
        url.pathname === "/internal/content-read/calendar/global" ||
        url.pathname === "/internal/content-read/search") {
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
