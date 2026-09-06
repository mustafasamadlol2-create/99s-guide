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
