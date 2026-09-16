type PrivateEntity = "User" | "FlashcardProgress" | "LectureProgress" | "ModerationHistory" | "Notification" | "PointsLog" | "QaAnswer" | "QaQuestion" | "QaVote" | "Report" | "SmartNotification" | "UserBan" | "UserBlock" | "UserMute" | "UserProgress" | "UserCalendarEvent";

type SqliteType = "TEXT" | "INTEGER" | "REAL" | "BLOB";
type TableConfig = {
  primaryKey: string[];
  columns: Record<string, SqliteType>;
};

const TABLES: Record<PrivateEntity, TableConfig> = {
  "User": {
    "primaryKey": [
      "id"
    ],
    "columns": {
      "id": "TEXT",
      "email": "TEXT",
      "name": "TEXT",
      "avatar": "TEXT",
      "avatarUrl": "TEXT",
      "role": "TEXT",
      "isOnline": "INTEGER",
      "lastActive": "TEXT",
      "lastSeen": "TEXT",
      "accountStatus": "TEXT",
      "createdAt": "TEXT",
      "updatedAt": "TEXT",
      "studentGroup": "TEXT",
      "totalPoints": "INTEGER",
      "level": "TEXT",
      "levelBadge": "TEXT",
      "streakDays": "INTEGER",
      "totalTimeSpent": "INTEGER",
      "preferences": "TEXT",
      "sessionVersion": "INTEGER",
      "isPrimaryOwner": "INTEGER",
      "emailVerified": "INTEGER",
      "profileEmail": "TEXT"
    }
  },
  "FlashcardProgress": {
    "primaryKey": [
      "id"
    ],
    "columns": {
      "id": "TEXT",
      "userId": "TEXT",
      "flashcardId": "TEXT",
      "status": "TEXT",
      "updatedAt": "TEXT"
    }
  },
  "LectureProgress": {
    "primaryKey": [
      "userId",
      "lectureId"
    ],
    "columns": {
      "userId": "TEXT",
      "lectureId": "TEXT",
      "pdfCompleted": "INTEGER",
      "notesCompleted": "INTEGER",
      "videoCompleted": "INTEGER",
      "flashcardsCompleted": "INTEGER",
      "quizCompleted": "INTEGER",
      "quizScore": "INTEGER",
      "lastAccessed": "TEXT"
    }
  },
  "ModerationHistory": {
    "primaryKey": [
      "id"
    ],
    "columns": {
      "id": "TEXT",
      "actionType": "TEXT",
      "adminId": "TEXT",
      "targetUserId": "TEXT",
      "commentId": "TEXT",
      "questionId": "TEXT",
      "answerId": "TEXT",
      "replyId": "TEXT",
      "lectureId": "TEXT",
      "reportId": "TEXT",
      "reason": "TEXT",
      "notes": "TEXT",
      "oldStatus": "TEXT",
      "newStatus": "TEXT",
      "duration": "INTEGER",
      "isPermanent": "INTEGER",
      "isSystemAction": "INTEGER",
      "createdAt": "TEXT",
      "expiresAt": "TEXT",
      "revokedAt": "TEXT",
      "revokedBy": "TEXT",
      "metadata": "TEXT"
    }
  },
  "Notification": {
    "primaryKey": [
      "id"
    ],
    "columns": {
      "id": "TEXT",
      "title": "TEXT",
      "message": "TEXT",
      "isSystem": "INTEGER",
      "targetUserId": "TEXT",
      "createdAt": "TEXT",
      "targetGroup": "TEXT"
    }
  },
  "PointsLog": {
    "primaryKey": [
      "id"
    ],
    "columns": {
      "id": "TEXT",
      "userId": "TEXT",
      "points": "INTEGER",
      "reason": "TEXT",
      "createdAt": "TEXT"
    }
  },
  "QaAnswer": {
    "primaryKey": [
      "id"
    ],
    "columns": {
      "id": "TEXT",
      "questionId": "TEXT",
      "userId": "TEXT",
      "content": "TEXT",
      "upvotes": "INTEGER",
      "isBest": "INTEGER",
      "isDeleted": "INTEGER",
      "createdAt": "TEXT",
      "updatedAt": "TEXT"
    }
  },
  "QaQuestion": {
    "primaryKey": [
      "id"
    ],
    "columns": {
      "id": "TEXT",
      "lectureId": "TEXT",
      "userId": "TEXT",
      "content": "TEXT",
      "upvotes": "INTEGER",
      "isDeleted": "INTEGER",
      "createdAt": "TEXT",
      "updatedAt": "TEXT"
    }
  },
  "QaVote": {
    "primaryKey": [
      "id"
    ],
    "columns": {
      "id": "TEXT",
      "userId": "TEXT",
      "targetId": "TEXT",
      "targetType": "TEXT",
      "value": "INTEGER",
      "createdAt": "TEXT"
    }
  },
  "Report": {
    "primaryKey": [
      "id"
    ],
    "columns": {
      "id": "TEXT",
      "reporterId": "TEXT",
      "reportedUserId": "TEXT",
      "lectureId": "TEXT",
      "commentId": "TEXT",
      "commentType": "TEXT",
      "commentContent": "TEXT",
      "reason": "TEXT",
      "description": "TEXT",
      "status": "TEXT",
      "createdAt": "TEXT"
    }
  },
  "SmartNotification": {
    "primaryKey": [
      "id"
    ],
    "columns": {
      "id": "TEXT",
      "title": "TEXT",
      "body": "TEXT",
      "type": "TEXT",
      "sentAt": "TEXT",
      "read": "INTEGER"
    }
  },
  "UserBan": {
    "primaryKey": [
      "id"
    ],
    "columns": {
      "id": "TEXT",
      "userId": "TEXT",
      "reason": "TEXT",
      "startTime": "TEXT",
      "endTime": "TEXT",
      "isPermanent": "INTEGER",
      "createdBy": "TEXT",
      "createdAt": "TEXT"
    }
  },
  "UserBlock": {
    "primaryKey": [
      "id"
    ],
    "columns": {
      "id": "TEXT",
      "blockerId": "TEXT",
      "blockedId": "TEXT",
      "createdAt": "TEXT"
    }
  },
  "UserMute": {
    "primaryKey": [
      "id"
    ],
    "columns": {
      "id": "TEXT",
      "userId": "TEXT",
      "reason": "TEXT",
      "startTime": "TEXT",
      "endTime": "TEXT",
      "isPermanent": "INTEGER",
      "createdBy": "TEXT",
      "createdAt": "TEXT"
    }
  },
  "UserProgress": {
    "primaryKey": [
      "id"
    ],
    "columns": {
      "id": "TEXT",
      "userId": "TEXT",
      "materialId": "TEXT",
      "hasViewed": "INTEGER",
      "isCompleted": "INTEGER",
      "createdAt": "TEXT",
      "updatedAt": "TEXT"
    }
  },
  "UserCalendarEvent": {
    "primaryKey": [
      "id"
    ],
    "columns": {
      "id": "TEXT",
      "userId": "TEXT",
      "title": "TEXT",
      "eventType": "TEXT",
      "startDateTime": "TEXT",
      "endDateTime": "TEXT",
      "targetGroups": "TEXT",
      "description": "TEXT",
      "subjectId": "TEXT",
      "lectureId": "TEXT",
      "room": "TEXT",
      "doctor": "TEXT",
      "notes": "TEXT",
      "isPinned": "INTEGER",
      "isCompleted": "INTEGER"
    }
  }
} as Record<PrivateEntity, TableConfig>;

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

async function secretsEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [aBuf, bBuf] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const a = new Uint8Array(aBuf);
  const b = new Uint8Array(bBuf);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function q(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function normalizeValue(value: unknown, type: SqliteType): unknown {
  if (value === null || value === undefined) return null;

  if (type === "INTEGER") {
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value);
    throw new Error("Invalid INTEGER value.");
  }

  if (type === "REAL") {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
    throw new Error("Invalid REAL value.");
  }

  if (type === "BLOB") throw new Error("BLOB sync is not supported.");

  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function assertEntity(value: unknown): asserts value is PrivateEntity {
  if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(TABLES, value)) {
    throw new Error("Unsupported private sync entity.");
  }
}

function normalizeKey(entity: PrivateEntity, key: Record<string, unknown>): Record<string, unknown> {
  const cfg = TABLES[entity];
  const result: Record<string, unknown> = {};

  for (const column of cfg.primaryKey) {
    if (!Object.prototype.hasOwnProperty.call(key, column)) {
      throw new Error(`Missing primary-key field: ${column}`);
    }
    const value = key[column];
    if (value === null || value === undefined || value === "") {
      throw new Error(`Invalid primary-key field: ${column}`);
    }
    result[column] = normalizeValue(value, cfg.columns[column]);
  }

  return result;
}

async function deleteRow(
  env: any,
  entity: PrivateEntity,
  key: Record<string, unknown>,
): Promise<void> {
  const cfg = TABLES[entity];
  const normalized = normalizeKey(entity, key);
  const where = cfg.primaryKey.map((column) => `${q(column)} = ?`).join(" AND ");

  await env.DB
    .prepare(`DELETE FROM ${q(entity)} WHERE ${where}`)
    .bind(...cfg.primaryKey.map((column) => normalized[column]))
    .run();
}

async function upsertRow(
  env: any,
  entity: PrivateEntity,
  key: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<void> {
  const cfg = TABLES[entity];
  const normalizedKey = normalizeKey(entity, key);
  const merged: Record<string, unknown> = { ...data, ...normalizedKey };

  for (const column of Object.keys(merged)) {
    if (!Object.prototype.hasOwnProperty.call(cfg.columns, column)) {
      throw new Error(`Unsupported column for ${entity}: ${column}`);
    }
  }

  const columns = Object.keys(merged).sort((a, b) => {
    const ap = cfg.primaryKey.indexOf(a);
    const bp = cfg.primaryKey.indexOf(b);
    if (ap >= 0 && bp >= 0) return ap - bp;
    if (ap >= 0) return -1;
    if (bp >= 0) return 1;
    return a.localeCompare(b);
  });

  if (!columns.length) throw new Error("Upsert data is empty.");

  const values = columns.map((column) =>
    normalizeValue(merged[column], cfg.columns[column])
  );

  const nonPk = columns.filter((column) => !cfg.primaryKey.includes(column));
  const update = nonPk.length
    ? "DO UPDATE SET " + nonPk.map((column) => `${q(column)} = excluded.${q(column)}`).join(", ")
    : "DO NOTHING";

  const sql =
    `INSERT INTO ${q(entity)} (${columns.map(q).join(", ")}) ` +
    `VALUES (${columns.map(() => "?").join(", ")}) ` +
    `ON CONFLICT (${cfg.primaryKey.map(q).join(", ")}) ${update}`;

  await env.DB.prepare(sql).bind(...values).run();
}

async function authenticate(request: Request, env: any): Promise<Response | null> {
  const configured = typeof env.PRIVATE_DATA_SYNC_SECRET === "string"
    ? env.PRIVATE_DATA_SYNC_SECRET
    : "";

  if (!configured) {
    return jsonNoStore({ ok: false, error: "Private data sync is not configured." }, 503);
  }

  const supplied = request.headers.get("X-Private-Data-Sync-Secret") || "";
  if (!supplied || !(await secretsEqual(supplied, configured))) {
    return jsonNoStore({ ok: false, error: "Unauthorized." }, 401);
  }

  return null;
}

async function handlePrivateSync(request: Request, env: any): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "no-store" },
    });
  }

  const authError = await authenticate(request, env);
  if (authError) return authError;

  const raw = await request.text();
  if (raw.length > 512 * 1024) {
    return jsonNoStore({ ok: false, error: "Payload too large." }, 413);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return jsonNoStore({ ok: false, error: "Invalid JSON." }, 400);
  }

  try {
    if (!isRecord(payload) || payload.version !== 1) {
      throw new Error("Unsupported private sync payload.");
    }

    assertEntity(payload.entity);
    const entity = payload.entity;

    if (payload.operation !== "upsert" && payload.operation !== "delete") {
      throw new Error("Unsupported private sync operation.");
    }
    if (!isRecord(payload.key)) throw new Error("Mutation key is required.");

    if (payload.operation === "delete") {
      await deleteRow(env, entity, payload.key);
    } else {
      if (!isRecord(payload.data)) throw new Error("Upsert data is required.");
      await upsertRow(env, entity, payload.key, payload.data);
    }

    return jsonNoStore({
      ok: true,
      entity,
      operation: payload.operation,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Private sync failed.";
    console.error("[PrivateDataSync]", message.slice(0, 220));

    const validation =
      message.includes("Unsupported") ||
      message.includes("Missing") ||
      message.includes("Invalid") ||
      message.includes("required") ||
      message.includes("empty");

    return jsonNoStore(
      { ok: false, error: validation ? message : "Private sync failed." },
      validation ? 400 : 500,
    );
  }
}

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      try {
        const db = await env.DB.prepare("SELECT 1 AS ok").first();
        const expected = Object.keys(TABLES);
        const placeholders = expected.map(() => "?").join(",");
        const result = await env.DB
          .prepare(
            `SELECT COUNT(*) AS count FROM sqlite_master ` +
            `WHERE type='table' AND name IN (${placeholders})`
          )
          .bind(...expected)
          .first();

        return jsonNoStore({
          ok: true,
          worker: { status: "ready" },
          d1: {
            connected: db?.ok === 1,
            safeMirrorTablesPresent: Number(result?.count || 0),
            safeMirrorTablesExpected: expected.length,
          },
          privateSync: {
            configured:
              typeof env.PRIVATE_DATA_SYNC_SECRET === "string" &&
              env.PRIVATE_DATA_SYNC_SECRET.length > 0,
          },
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("[Health]", error);
        return jsonNoStore({ ok: false, error: "D1 health check failed." }, 500);
      }
    }

    if (url.pathname === "/internal/private-sync") {
      return handlePrivateSync(request, env);
    }

    return new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  },
};
