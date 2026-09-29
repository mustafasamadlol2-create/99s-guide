import { handleLeaderboardCache } from "./leaderboardCache";
type PrivateEntity = "User" | "FlashcardProgress" | "LectureProgress" | "ModerationHistory" | "Notification" | "PointsLog" | "QaAnswer" | "QaQuestion" | "QaVote" | "Report" | "SmartNotification" | "UserBan" | "UserBlock" | "UserMute" | "UserProgress" | "UserCalendarEvent" | "FocusPlan" | "FocusSession" | "StudyDailyMetric";
type ProjectionEntity = "FocusPlan" | "FocusSession" | "StudyDailyMetric";
const PROJECTION_ENTITIES = new Set<ProjectionEntity>(["FocusPlan", "FocusSession", "StudyDailyMetric"]);
const MAX_PROJECTION_DATA_BYTES = 64 * 1024;
const MAX_PROJECTION_REVISION_DIGITS = 40;
const MASTERY_ENTITIES = new Set(["LectureMastery", "LectureRetention", "MasteryProjectionUser"]);
const MASTERY_FIELDS: Record<string, string[]> = {
  LectureMastery: ["user_id","lecture_id","subject_id","state","evidence_score","evidence_count","objective_attempt_count","objective_correct_count","objective_incorrect_count","flashcard_review_count","flashcard_remembered_count","flashcard_not_remembered_count","recall_objective_attempt_count","recall_objective_correct_count","recall_objective_incorrect_count","meaningful_focus_session_count","meaningful_focus_seconds","last_study_evidence_at","last_objective_evidence_at","last_recall_evidence_at","rule_version","revision","projection_revision","last_evaluated_at","created_at","updated_at","projected_at"],
  LectureRetention: ["user_id","lecture_id","source_mastery_revision","source_mastery_rule_version","effective_mastery_state","retention_score","review_state","review_urgency_score","retention_anchor_at","next_review_at","next_evaluation_at","last_positive_memory_evidence_at","last_negative_memory_evidence_at","last_forgetting_evidence_at","objective_forgetting_item_count","self_reported_forgetting_item_count","forgetting_evidence_kind","rule_version","revision","projection_revision","last_evaluated_at","created_at","updated_at","projected_at"],
};
const MASTERY_INT_FIELDS = new Set(["evidence_score","evidence_count","objective_attempt_count","objective_correct_count","objective_incorrect_count","flashcard_review_count","flashcard_remembered_count","flashcard_not_remembered_count","recall_objective_attempt_count","recall_objective_correct_count","recall_objective_incorrect_count","meaningful_focus_session_count","meaningful_focus_seconds","source_mastery_revision","retention_score","review_urgency_score","objective_forgetting_item_count","self_reported_forgetting_item_count","revision"]);

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
  },
  "FocusPlan": {
    "primaryKey": ["id"],
    "columns": {
      "id": "TEXT",
      "canonicalId": "TEXT",
      "userId": "TEXT",
      "userScope": "TEXT",
      "title": "TEXT",
      "status": "TEXT",
      "timezone": "TEXT",
      "planVersion": "INTEGER",
      "createdAt": "TEXT",
      "updatedAt": "TEXT",
      "archivedAt": "TEXT",
      "itemsJson": "TEXT",
      "projectionVersion": "INTEGER",
      "revision": "TEXT",
      "deletedAt": "TEXT"
    }
  },
  "FocusSession": {
    "primaryKey": ["id"],
    "columns": {
      "id": "TEXT",
      "canonicalId": "TEXT",
      "userId": "TEXT",
      "userScope": "TEXT",
      "planId": "TEXT",
      "planItemId": "TEXT",
      "lectureId": "TEXT",
      "status": "TEXT",
      "startedAt": "TEXT",
      "plannedEndAt": "TEXT",
      "actualEndedAt": "TEXT",
      "lastCheckpointAt": "TEXT",
      "activeSeconds": "INTEGER",
      "pauseSeconds": "INTEGER",
      "completionReason": "TEXT",
      "updatedAt": "TEXT",
      "projectionVersion": "INTEGER",
      "revision": "TEXT",
      "deletedAt": "TEXT"
    }
  },
  "StudyDailyMetric": {
    "primaryKey": ["id"],
    "columns": {
      "id": "TEXT",
      "canonicalId": "TEXT",
      "userId": "TEXT",
      "userScope": "TEXT",
      "metricDate": "TEXT",
      "focusSeconds": "INTEGER",
      "sessionsCompleted": "INTEGER",
      "mcqAttempts": "INTEGER",
      "mcqCorrect": "INTEGER",
      "flashcardReviews": "INTEGER",
      "recallAttempts": "INTEGER",
      "recallCorrect": "INTEGER",
      "lectureCompletions": "INTEGER",
      "interruptionCount": "INTEGER",
      "updatedAt": "TEXT",
      "projectionVersion": "INTEGER",
      "revision": "TEXT",
      "deletedAt": "TEXT"
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

function isProjectionEntity(entity: PrivateEntity): entity is ProjectionEntity {
  return PROJECTION_ENTITIES.has(entity as ProjectionEntity);
}

function projectionRevision(value: unknown): bigint {
  const text = typeof value === "string"
    ? value
    : typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : "";
  if (!/^\d+$/.test(text) || text.length > MAX_PROJECTION_REVISION_DIGITS) {
    throw new Error("Invalid projection revision.");
  }
  return BigInt(text);
}

function decimalTextGreater(left: string, right: string): string {
  const leftText = `CAST(${left} AS TEXT)`;
  const rightText = `CAST(${right} AS TEXT)`;
  return `(length(${leftText}) > length(${rightText}) OR (length(${leftText}) = length(${rightText}) AND ${leftText} COLLATE BINARY > ${rightText} COLLATE BINARY))`;
}

function decimalTextGreaterOrEqual(left: string, right: string): string {
  const leftText = `CAST(${left} AS TEXT)`;
  const rightText = `CAST(${right} AS TEXT)`;
  return `(${leftText} COLLATE BINARY = ${rightText} COLLATE BINARY OR ${decimalTextGreater(left, right)})`;
}

function projectionVersion(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 1000) {
    throw new Error("Invalid projection version.");
  }
  return Number(value);
}

function boundedProjectionData(data: Record<string, unknown>): void {
  if (JSON.stringify(data).length > MAX_PROJECTION_DATA_BYTES) {
    throw new Error("Projection payload is too large.");
  }
}

function projectionUserScope(
  payload: Record<string, unknown>,
  data: Record<string, unknown> | null,
): string {
  const candidate = payload.userScope ?? data?.userScope ?? data?.userId;
  if (typeof candidate !== "string" || !candidate.trim() || candidate.length > 200) {
    throw new Error("Projection user scope is required.");
  }
  if (data?.userId !== undefined && data.userId !== candidate) {
    throw new Error("Projection user scope does not match userId.");
  }
  return candidate;
}

function projectionDataForCompare(
  entity: ProjectionEntity,
  row: Record<string, unknown>,
): string {
  const columns = Object.keys(TABLES[entity].columns).sort();
  return JSON.stringify(columns.map((column) => [column, row[column] ?? null]));
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

function prepareUpsertRow(
  env: any,
  entity: PrivateEntity,
  key: Record<string, unknown>,
  data: Record<string, unknown>,
  updateWhere?: string,
): any {
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
    ? "DO UPDATE SET " + nonPk.map((column) => `${q(column)} = excluded.${q(column)}`).join(", ") +
      (updateWhere ? ` WHERE ${updateWhere}` : "")
    : "DO NOTHING";

  const sql =
    `INSERT INTO ${q(entity)} (${columns.map(q).join(", ")}) ` +
    `VALUES (${columns.map(() => "?").join(", ")}) ` +
    `ON CONFLICT (${cfg.primaryKey.map(q).join(", ")}) ${update}`;

  return env.DB.prepare(sql).bind(...values);
}

async function upsertRow(
  env: any,
  entity: PrivateEntity,
  key: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<void> {
  await prepareUpsertRow(env, entity, key, data).run();
}

async function syncProjectionRow(
  env: any,
  entity: ProjectionEntity,
  key: Record<string, unknown>,
  data: Record<string, unknown> | null,
  payload: Record<string, unknown>,
): Promise<"applied" | "idempotent" | "stale"> {
  const normalizedKey = normalizeKey(entity, key);
  const id = String(normalizedKey.id);
  const incomingRevision = projectionRevision(payload.revision);
  const incomingProjectionVersion = projectionVersion(
    payload.projectionVersion ?? data?.projectionVersion,
  );
  const userScope = projectionUserScope(payload, data);
  boundedProjectionData(data || {});

  const tombstone = payload.operation === "delete";
  const merged: Record<string, unknown> = tombstone
    ? Object.fromEntries(Object.keys(TABLES[entity].columns).map((column) => [column, null]))
    : { ...(data || {}) };

  if (!tombstone && !data) throw new Error("Projection upsert data is required.");
  if (!tombstone && data?.id !== undefined && String(data.id) !== id) {
    throw new Error("Projection canonical ID does not match the sync key.");
  }
  if (!tombstone && data?.canonicalId !== undefined && String(data.canonicalId) !== id) {
    throw new Error("Projection canonical ID is not stable.");
  }

  Object.assign(merged, normalizedKey, {
    id,
    canonicalId: id,
    userScope,
    projectionVersion: incomingProjectionVersion,
    revision: incomingRevision.toString(),
    updatedAt: payload.updatedAt ?? data?.updatedAt ?? payload.occurredAt ?? new Date().toISOString(),
    deletedAt: tombstone
      ? payload.deletedAt ?? new Date().toISOString()
      : data?.deletedAt ?? null,
  });

  if (merged.userId !== undefined && merged.userId !== null && String(merged.userId) !== userScope) {
    throw new Error("Projection user scope does not match userId.");
  }
  merged.userId = userScope;

  const cfg = TABLES[entity];
  for (const column of Object.keys(merged)) {
    if (!Object.prototype.hasOwnProperty.call(cfg.columns, column)) {
      throw new Error(`Unsupported column for ${entity}: ${column}`);
    }
  }
  for (const column of ["updatedAt", "deletedAt"]) {
    if (merged[column] !== null && typeof merged[column] !== "string") {
      throw new Error(`Projection ${column} must be a string or null.`);
    }
  }

  const where = cfg.primaryKey.map((column) => `${q(column)} = ?`).join(" AND ");
  const currentQuery = env.DB
    .prepare(`SELECT * FROM ${q(entity)} WHERE ${where} LIMIT 1`)
    .bind(...cfg.primaryKey.map((column) => normalizedKey[column]));
  const revisionGuard = decimalTextGreater(
    `excluded.${q("revision")}`,
    `${q(entity)}.${q("revision")}`,
  );
  const upsert = prepareUpsertRow(env, entity, key, merged, revisionGuard);
  const [writeResult, currentResult] = await env.DB.batch([upsert, currentQuery]);
  const current = ((currentResult as any)?.results || [])[0] as Record<string, unknown> | undefined;
  if (!current) throw new Error("Projection row was not available after its fenced write.");

  const currentRevision = projectionRevision(current.revision);
  if (currentRevision > incomingRevision) return "stale";
  if (currentRevision < incomingRevision) {
    if (Number((writeResult as any)?.meta?.changes || 0) > 0) return "applied";
    throw new Error("Projection revision write was not applied.");
  }

  if (projectionDataForCompare(entity, current) !== projectionDataForCompare(entity, merged)) {
    throw new Error("Projection revision conflict.");
  }
  return Number((writeResult as any)?.meta?.changes || 0) > 0 ? "applied" : "idempotent";
}

async function authenticate(request: Request, env: any): Promise<Response | null> {
  const configured = typeof env.PRIVATE_DATA_SYNC_SECRET === "string"
    ? env.PRIVATE_DATA_SYNC_SECRET
    : "";

  if (!configured) {
    return jsonNoStore({
      ok: false,
      code: "PRIVATE_SYNC_AUTH_UNAVAILABLE",
      error: "Private data sync is not configured.",
    }, 503);
  }

  const supplied = request.headers.get("X-Private-Data-Sync-Secret") || "";
  if (!supplied || !(await secretsEqual(supplied, configured))) {
    return jsonNoStore({
      ok: false,
      code: "PRIVATE_SYNC_UNAUTHORIZED",
      error: "Unauthorized.",
    }, 401);
  }

  return null;
}

function masteryRevision(value: unknown): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d{1,40}$/.test(value)) return BigInt(value);
  throw new Error("Invalid mastery envelope revision.");
}

function masteryUser(key: Record<string, unknown>, data: Record<string, unknown> | null): string {
  const value = key.user_id ?? key.userId ?? data?.user_id ?? data?.userId;
  if (typeof value !== "string" || !value || value.length > 200) throw new Error("user_id is required.");
  return value;
}

function masteryKey(key: Record<string, unknown>): { user_id: string; lecture_id: string } {
  const user_id = masteryUser(key, null);
  const lecture_id = key.lecture_id ?? key.lectureId;
  if (typeof lecture_id !== "string" || !lecture_id || lecture_id.length > 200) throw new Error("lecture_id is required.");
  return { user_id, lecture_id };
}

function masteryRow(entity: "LectureMastery" | "LectureRetention", key: Record<string, unknown>, data: Record<string, unknown>, now: string) {
  const k = masteryKey(key);
  const out: Record<string, unknown> = { user_id: k.user_id, lecture_id: k.lecture_id };
  for (const column of MASTERY_FIELDS[entity]) {
    if (column === "user_id" || column === "lecture_id" || column === "projected_at") continue;
    const camel = column.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const value = column === "projection_revision"
      ? undefined
      : Object.prototype.hasOwnProperty.call(data, column)
        ? data[column]
        : data[camel];
    if (column === "projection_revision") { out[column] = "0"; continue; }
    if (value === undefined) throw new Error(`Missing projection field: ${column}`);
    if (MASTERY_INT_FIELDS.has(column)) {
      if (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 2147483647) throw new Error(`Invalid projection field: ${column}`);
      out[column] = Number(value);
    } else if (value === null) out[column] = null;
    else if (typeof value !== "string" || value.length > 500) throw new Error(`Invalid projection field: ${column}`);
    else out[column] = value;
  }
  out.projected_at = now;
  return out;
}

function prepareAdvanceMasteryState(
  env: any,
  userId: string,
  kind: "mastery" | "retention",
  revision: bigint,
  onlyWhen?: { sql: string; params: unknown[] },
): any {
  const stateTable = q("private_mastery_projection_state");
  const field = kind === "mastery" ? "mastery_watermark" : "retention_watermark";
  const revisionText = revision.toString();
  const masteryWatermark = kind === "mastery" ? revisionText : "0";
  const retentionWatermark = kind === "retention" ? revisionText : "0";
  const greater = decimalTextGreater(
    `excluded.${q(field)}`,
    `${stateTable}.${q(field)}`,
  );
  const source = onlyWhen
    ? `SELECT ?, ?, ?, ?, NULL, NULL WHERE ${onlyWhen.sql}`
    : "VALUES (?, ?, ?, ?, NULL, NULL)";
  const sql =
    `INSERT INTO ${stateTable} (user_id, mastery_watermark, retention_watermark, updated_at, deleted_at, deletion_revision) ` +
    `${source} ON CONFLICT (user_id) DO UPDATE SET ` +
    `${q(field)} = CASE WHEN ${greater} THEN excluded.${q(field)} ELSE ${stateTable}.${q(field)} END, ` +
    `${q("updated_at")} = CASE WHEN ${greater} THEN excluded.${q("updated_at")} ELSE ${stateTable}.${q("updated_at")} END, ` +
    `${q("deleted_at")} = ${stateTable}.${q("deleted_at")}, ` +
    `${q("deletion_revision")} = ${stateTable}.${q("deletion_revision")}`;

  return env.DB
    .prepare(sql)
    .bind(userId, masteryWatermark, retentionWatermark, new Date().toISOString(), ...(onlyWhen?.params || []));
}

function prepareMasteryProjectionUpsert(
  env: any,
  entity: "LectureMastery" | "LectureRetention",
  row: Record<string, unknown>,
): any {
  const table = entity === "LectureMastery" ? "private_mastery" : "private_retention";
  const tableSql = q(table);
  const stateTable = q("private_mastery_projection_state");
  const tombstoneTable = q("private_mastery_projection_tombstones");
  const fields = MASTERY_FIELDS[entity];
  const columns = fields.map(q);
  const comparableFields = fields.filter((field) => field !== "projected_at" && field !== "projection_revision");
  const comparableSql = comparableFields
    .map((field) => `${tableSql}.${q(field)} IS excluded.${q(field)}`)
    .join(" AND ");
  const updates = fields
    .filter((field) => field !== "user_id" && field !== "lecture_id")
    .map((field) => `${q(field)} = excluded.${q(field)}`)
    .join(", ");
  const incomingEnvelope = String(row.projection_revision);
  const incomingRevision = Number(row.revision);
  const sql =
    `INSERT INTO ${tableSql} (${columns.join(", ")}) ` +
    `SELECT ${columns.map(() => "?").join(", ")} ` +
    `WHERE NOT EXISTS (` +
    `SELECT 1 FROM ${tombstoneTable} AS tombstone ` +
    `WHERE tombstone.entity = ? AND tombstone.user_id = ? AND tombstone.lecture_id = ? ` +
    `AND (${decimalTextGreaterOrEqual("tombstone.projection_revision", "?")} OR tombstone.revision >= ?)) ` +
    `AND NOT EXISTS (` +
    `SELECT 1 FROM ${stateTable} AS projection_state ` +
    `WHERE projection_state.user_id = ? AND projection_state.deleted_at IS NOT NULL ` +
    `AND ${decimalTextGreaterOrEqual("COALESCE(projection_state.deletion_revision, '0')", "?")}) ` +
    `ON CONFLICT (user_id, lecture_id) DO UPDATE SET ${updates} ` +
    `WHERE ${decimalTextGreater(`excluded.${q("projection_revision")}`, `${tableSql}.${q("projection_revision")}`)} ` +
    `AND excluded.${q("revision")} >= ${tableSql}.${q("revision")} ` +
    `AND (excluded.${q("revision")} > ${tableSql}.${q("revision")} OR (${comparableSql}))`;

  return env.DB.prepare(sql).bind(
    ...fields.map((field) => row[field]),
    entity,
    row.user_id,
    row.lecture_id,
    incomingEnvelope,
    incomingEnvelope,
    incomingEnvelope,
    incomingEnvelope,
    incomingRevision,
    row.user_id,
    incomingEnvelope,
    incomingEnvelope,
    incomingEnvelope,
    incomingEnvelope,
  );
}

function prepareMasteryTombstoneUpsert(
  env: any,
  entity: "LectureMastery" | "LectureRetention",
  userId: string,
  lectureId: string,
  envelope: bigint,
  revision: number,
  deletedAt: string,
): any {
  const table = entity === "LectureMastery" ? "private_mastery" : "private_retention";
  const tombstoneTable = q("private_mastery_projection_tombstones");
  const stateTable = q("private_mastery_projection_state");
  const envelopeText = envelope.toString();
  const sql =
    `INSERT INTO ${tombstoneTable} (entity, user_id, lecture_id, projection_revision, revision, deleted_at) ` +
    `SELECT ?, ?, ?, ?, ?, ? ` +
    `WHERE NOT EXISTS (` +
    `SELECT 1 FROM ${q(table)} AS live_row ` +
    `WHERE live_row.user_id = ? AND live_row.lecture_id = ? ` +
    `AND (${decimalTextGreater("live_row.projection_revision", "?")} OR live_row.revision > ?)) ` +
    `AND NOT EXISTS (` +
    `SELECT 1 FROM ${stateTable} AS projection_state ` +
    `WHERE projection_state.user_id = ? AND projection_state.deleted_at IS NOT NULL ` +
    `AND ${decimalTextGreater("projection_state.deletion_revision", "?")}) ` +
    `ON CONFLICT (entity, user_id, lecture_id) DO UPDATE SET ` +
    `projection_revision = excluded.projection_revision, revision = excluded.revision, deleted_at = excluded.deleted_at ` +
    `WHERE ${decimalTextGreaterOrEqual(`excluded.${q("projection_revision")}`, `${tombstoneTable}.${q("projection_revision")}`)} ` +
    `AND excluded.${q("revision")} >= ${tombstoneTable}.${q("revision")}`;

  return env.DB.prepare(sql).bind(
    entity,
    userId,
    lectureId,
    envelopeText,
    revision,
    deletedAt,
    userId,
    lectureId,
    envelopeText,
    envelopeText,
    envelopeText,
    revision,
    userId,
    envelopeText,
    envelopeText,
    envelopeText,
  );
}

function prepareMasteryUserDeleteState(
  env: any,
  userId: string,
  envelope: bigint,
  deletedAt: string,
): any {
  const stateTable = q("private_mastery_projection_state");
  const revisionText = envelope.toString();
  const acceptable = [
    decimalTextGreaterOrEqual(`excluded.${q("mastery_watermark")}`, `${stateTable}.${q("mastery_watermark")}`),
    decimalTextGreaterOrEqual(`excluded.${q("retention_watermark")}`, `${stateTable}.${q("retention_watermark")}`),
    decimalTextGreaterOrEqual(`excluded.${q("deletion_revision")}`, `COALESCE(${stateTable}.${q("deletion_revision")}, '0')`),
    `(${stateTable}.${q("deleted_at")} IS NULL OR ${stateTable}.${q("deletion_revision")} IS NULL OR ${decimalTextGreater(`excluded.${q("deletion_revision")}`, `${stateTable}.${q("deletion_revision")}`)})`,
  ].join(" AND ");
  const sql =
    `INSERT INTO ${stateTable} (user_id, mastery_watermark, retention_watermark, updated_at, deleted_at, deletion_revision) ` +
    `VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET ` +
    `${q("mastery_watermark")} = excluded.${q("mastery_watermark")}, ` +
    `${q("retention_watermark")} = excluded.${q("retention_watermark")}, ` +
    `${q("updated_at")} = excluded.${q("updated_at")}, ` +
    `${q("deleted_at")} = excluded.${q("deleted_at")}, ` +
    `${q("deletion_revision")} = excluded.${q("deletion_revision")} ` +
    `WHERE ${acceptable}`;

  return env.DB.prepare(sql).bind(userId, revisionText, revisionText, deletedAt, deletedAt, revisionText);
}

async function syncMasteryProjection(env: any, entity: string, key: Record<string, unknown>, data: Record<string, unknown> | null, payload: Record<string, unknown>) {
  const envelope = masteryRevision(payload.revision);
  const userId = masteryUser(key, data);
  if (entity === "MasteryProjectionUser") {
    if (payload.operation !== "delete") throw new Error("MasteryProjectionUser only supports delete.");
    const deletedAt = new Date().toISOString();
    const revisionText = envelope.toString();
    const stateTable = q("private_mastery_projection_state");
    const stateUpdate = prepareMasteryUserDeleteState(env, userId, envelope, deletedAt);
    const deleteRows = (table: "private_mastery" | "private_retention") => {
      const tableSql = q(table);
      const sql =
        `DELETE FROM ${tableSql} WHERE user_id = ? ` +
        `AND NOT (${decimalTextGreater(`${tableSql}.${q("projection_revision")}`, "?")}) ` +
        `AND EXISTS (SELECT 1 FROM ${stateTable} AS projection_state ` +
        `WHERE projection_state.user_id = ? AND projection_state.deleted_at = ? ` +
        `AND projection_state.deletion_revision = ?)`;
      return env.DB.prepare(sql).bind(
        userId,
        revisionText,
        revisionText,
        revisionText,
        userId,
        deletedAt,
        revisionText,
      );
    };
    const stateQuery = env.DB
      .prepare(`SELECT * FROM ${stateTable} WHERE user_id = ?`)
      .bind(userId);
    const [writeResult, , , stateResult] = await env.DB.batch([
      stateUpdate,
      deleteRows("private_mastery"),
      deleteRows("private_retention"),
      stateQuery,
    ]);
    const state = ((stateResult as any)?.results || [])[0] as Record<string, unknown> | undefined;
    if (Number((writeResult as any)?.meta?.changes || 0) > 0) return "applied";
    if (state?.deleted_at && masteryRevision(state.deletion_revision) === envelope) return "idempotent";
    return "stale";
  }
  const table = entity === "LectureMastery" ? "private_mastery" : "private_retention";
  const kind = entity === "LectureMastery" ? "mastery" : "retention";
  const k = masteryKey(key);
  const tableSql = q(table);
  const tombstoneTable = q("private_mastery_projection_tombstones");
  const stateTable = q("private_mastery_projection_state");
  const incomingEnvelope = envelope.toString();
  if (payload.operation === "delete") {
    const canonical = data?.revision;
    if (!Number.isInteger(Number(canonical)) || Number(canonical) < 0 || Number(canonical) > 2147483647) throw new Error("Delete revision is required.");
    const revision = Number(canonical);
    const deletedAt = new Date().toISOString();
    const tombstoneWrite = prepareMasteryTombstoneUpsert(
      env,
      entity as "LectureMastery" | "LectureRetention",
      k.user_id,
      k.lecture_id,
      envelope,
      revision,
      deletedAt,
    );
    const deleteRow = env.DB.prepare(
      `DELETE FROM ${tableSql} WHERE user_id = ? AND lecture_id = ? ` +
      `AND NOT (${decimalTextGreater(`${tableSql}.${q("projection_revision")}`, "?")}) ` +
      `AND revision <= ? AND EXISTS (` +
      `SELECT 1 FROM ${tombstoneTable} AS tombstone ` +
      `WHERE tombstone.entity = ? AND tombstone.user_id = ? AND tombstone.lecture_id = ? ` +
      `AND tombstone.projection_revision = ? AND tombstone.revision = ?)`,
    ).bind(
      k.user_id,
      k.lecture_id,
      incomingEnvelope,
      incomingEnvelope,
      incomingEnvelope,
      revision,
      entity,
      k.user_id,
      k.lecture_id,
      incomingEnvelope,
      revision,
    );
    const advanceState = prepareAdvanceMasteryState(env, userId, kind as "mastery" | "retention", envelope, {
      sql: `EXISTS (SELECT 1 FROM ${tombstoneTable} AS tombstone ` +
        `WHERE tombstone.entity = ? AND tombstone.user_id = ? AND tombstone.lecture_id = ? ` +
        `AND tombstone.projection_revision = ? AND tombstone.revision = ?)`,
      params: [entity, k.user_id, k.lecture_id, incomingEnvelope, revision],
    });
    const currentQuery = env.DB
      .prepare(`SELECT * FROM ${tableSql} WHERE user_id = ? AND lecture_id = ?`)
      .bind(k.user_id, k.lecture_id);
    const tombstoneQuery = env.DB
      .prepare(`SELECT * FROM ${tombstoneTable} WHERE entity = ? AND user_id = ? AND lecture_id = ?`)
      .bind(entity, k.user_id, k.lecture_id);
    const [, , , currentResult, tombstoneResult] = await env.DB.batch([
      tombstoneWrite,
      deleteRow,
      advanceState,
      currentQuery,
      tombstoneQuery,
    ]);
    const current = ((currentResult as any)?.results || [])[0] as Record<string, unknown> | undefined;
    const tombstone = ((tombstoneResult as any)?.results || [])[0] as Record<string, unknown> | undefined;
    if (current && (envelope < masteryRevision(current.projection_revision) || revision < Number(current.revision))) {
      return "stale";
    }
    if (
      !tombstone ||
      envelope < masteryRevision(tombstone.projection_revision) ||
      revision < Number(tombstone.revision)
    ) {
      return "stale";
    }
    return "applied";
  }
  if (payload.operation !== "upsert" || !data) throw new Error("Projection upsert data is required.");
  if (data.projection_revision !== undefined && masteryRevision(data.projection_revision) !== envelope) {
    throw new Error("Projection revision does not match envelope revision.");
  }
  const row = masteryRow(entity as "LectureMastery" | "LectureRetention", key, data, new Date().toISOString());
  row.projection_revision = incomingEnvelope;
  const incomingCanonicalRevision = Number(row.revision);
  const upsert = prepareMasteryProjectionUpsert(
    env,
    entity as "LectureMastery" | "LectureRetention",
    row,
  );
  const cleanupTombstone = env.DB.prepare(
    `DELETE FROM ${tombstoneTable} WHERE entity = ? AND user_id = ? AND lecture_id = ? ` +
    `AND ${decimalTextGreater("?", `${tombstoneTable}.${q("projection_revision")}`)} ` +
    `AND ? > ${tombstoneTable}.${q("revision")} AND EXISTS (` +
    `SELECT 1 FROM ${tableSql} AS live_row ` +
    `WHERE live_row.user_id = ? AND live_row.lecture_id = ? ` +
    `AND live_row.projection_revision = ? AND live_row.revision = ?)`,
  ).bind(
    entity,
    row.user_id,
    row.lecture_id,
    incomingEnvelope,
    incomingEnvelope,
    incomingEnvelope,
    incomingCanonicalRevision,
    row.user_id,
    row.lecture_id,
    incomingEnvelope,
    incomingCanonicalRevision,
  );
  const advanceState = prepareAdvanceMasteryState(env, userId, kind as "mastery" | "retention", envelope, {
    sql: `EXISTS (SELECT 1 FROM ${tableSql} AS live_row ` +
      `WHERE live_row.user_id = ? AND live_row.lecture_id = ? ` +
      `AND live_row.projection_revision = ? AND live_row.revision = ?)`,
    params: [row.user_id, row.lecture_id, incomingEnvelope, incomingCanonicalRevision],
  });
  const currentQuery = env.DB
    .prepare(`SELECT * FROM ${tableSql} WHERE user_id = ? AND lecture_id = ?`)
    .bind(row.user_id, row.lecture_id);
  const tombstoneQuery = env.DB
    .prepare(`SELECT * FROM ${tombstoneTable} WHERE entity = ? AND user_id = ? AND lecture_id = ?`)
    .bind(entity, row.user_id, row.lecture_id);
  const stateQuery = env.DB
    .prepare(`SELECT * FROM ${stateTable} WHERE user_id = ?`)
    .bind(userId);
  const [writeResult, , , currentResult, tombstoneResult, stateResult] = await env.DB.batch([
    upsert,
    cleanupTombstone,
    advanceState,
    currentQuery,
    tombstoneQuery,
    stateQuery,
  ]);
  const current = ((currentResult as any)?.results || [])[0] as Record<string, unknown> | undefined;
  const tombstone = ((tombstoneResult as any)?.results || [])[0] as Record<string, unknown> | undefined;
  const state = ((stateResult as any)?.results || [])[0] as Record<string, unknown> | undefined;
  if (state?.deleted_at && envelope <= masteryRevision(state.deletion_revision)) return "stale";
  if (
    tombstone &&
    (envelope <= masteryRevision(tombstone.projection_revision) || incomingCanonicalRevision <= Number(tombstone.revision))
  ) {
    return "stale";
  }

  const comparable = (value: Record<string, unknown>) => JSON.stringify(
    MASTERY_FIELDS[entity]
      .filter((field) => field !== "projected_at" && field !== "projection_revision")
      .map((field) => value[field] ?? null),
  );
  if (current) {
    const currentEnvelope = masteryRevision(current.projection_revision);
    const currentCanonicalRevision = Number(current.revision);
    if (envelope < currentEnvelope || incomingCanonicalRevision < currentCanonicalRevision) return "stale";
    const samePayload = comparable(current) === comparable(row);
    if (envelope === currentEnvelope) {
      if (samePayload) return "idempotent";
      throw new Error("Projection revision conflict.");
    }
    if (incomingCanonicalRevision === currentCanonicalRevision && !samePayload) {
      throw new Error("Projection revision conflict.");
    }
    if (Number((writeResult as any)?.meta?.changes || 0) > 0) return "applied";
    if (
      incomingCanonicalRevision > currentCanonicalRevision ||
      (incomingCanonicalRevision === currentCanonicalRevision && samePayload)
    ) {
      throw new Error("Projection revision write was not applied.");
    }
    return "stale";
  }

  return Number((writeResult as any)?.meta?.changes || 0) > 0 ? "applied" : "stale";
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
    return jsonNoStore({ ok: false, code: "PRIVATE_SYNC_PAYLOAD_TOO_LARGE", error: "Payload too large." }, 413);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return jsonNoStore({ ok: false, code: "PRIVATE_SYNC_INVALID_JSON", error: "Invalid JSON." }, 400);
  }

  try {
    if (!isRecord(payload) || payload.version !== 1) {
      throw new Error("Unsupported private sync payload.");
    }

    if (typeof payload.entity === "string" && MASTERY_ENTITIES.has(payload.entity)) {
      const result = await syncMasteryProjection(env, payload.entity, isRecord(payload.key) ? payload.key : {}, isRecord(payload.data) ? payload.data : null, payload);
      return jsonNoStore({ ok: true, entity: payload.entity, operation: payload.operation, result, syncedAt: new Date().toISOString() });
    }
    assertEntity(payload.entity);
    const entity = payload.entity;

    if (payload.operation !== "upsert" && payload.operation !== "delete") {
      throw new Error("Unsupported private sync operation.");
    }
    if (!isRecord(payload.key)) throw new Error("Mutation key is required.");

    const result = isProjectionEntity(entity)
      ? await syncProjectionRow(
        env,
        entity,
        payload.key,
        isRecord(payload.data) ? payload.data : null,
        payload,
      )
      : payload.operation === "delete"
        ? await deleteRow(env, entity, payload.key).then(() => "applied" as const)
        : !isRecord(payload.data)
          ? (() => { throw new Error("Upsert data is required."); })()
          : await upsertRow(env, entity, payload.key, payload.data).then(() => "applied" as const);

    return jsonNoStore({
      ok: true,
      entity,
      operation: payload.operation,
      result,
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
      message.includes("empty") ||
      message.includes("conflict");
    const schemaIncompatible =
      /no such (?:table|column)|schema.{0,20}(?:version|incompatib|missing)/iu.test(message);
    const missingTarget = /(?:target|canonical row|projection).{0,40}not found/iu.test(message);
    const code = schemaIncompatible
      ? "PRIVATE_SYNC_SCHEMA_INCOMPATIBLE"
      : missingTarget
        ? "PRIVATE_SYNC_TARGET_NOT_FOUND"
        : message.toLowerCase().includes("conflict")
          ? "PRIVATE_SYNC_DETERMINISTIC_CONFLICT"
          : message.includes("Unsupported")
            ? "PRIVATE_SYNC_UNSUPPORTED_VERSION"
            : validation
              ? "PRIVATE_SYNC_INVALID_PAYLOAD"
              : "PRIVATE_SYNC_UNAVAILABLE";
    const permanent = schemaIncompatible || missingTarget || validation;

    return jsonNoStore(
      { ok: false, code, error: permanent ? message : "Private sync failed." },
      permanent ? 400 : 500,
    );
  }
}


function readStringParam(url: URL, name: string, max = 500): string | null {
  const value = url.searchParams.get(name);
  if (value === null) return null;
  const clean = value.trim();
  if (!clean || clean.length > max) return null;
  return clean;
}

function readLimit(url: URL, fallback: number, max: number): number {
  const raw = Number(url.searchParams.get("limit") || fallback);
  if (!Number.isInteger(raw) || raw < 1) return fallback;
  return Math.min(raw, max);
}

function strictEnum(url: URL, name: string, values: string[]): string | null | "invalid" {
  const value = url.searchParams.get(name);
  if (value === null) return null;
  return values.includes(value) ? value : "invalid";
}

function mapIntegerBooleans(
  row: Record<string, unknown> | null,
  fields: string[],
): Record<string, unknown> | null {
  if (!row) return null;
  const copy: Record<string, unknown> = { ...row };
  for (const field of fields) {
    if (copy[field] !== null && copy[field] !== undefined) {
      copy[field] = Number(copy[field]) === 1;
    }
  }
  return copy;
}

function mapManyIntegerBooleans(
  rows: Record<string, unknown>[],
  fields: string[],
): Record<string, unknown>[] {
  return rows.map((row) => mapIntegerBooleans(row, fields) as Record<string, unknown>);
}

function projectionReadUser(url: URL): string | null {
  return readStringParam(url, "userId", 200);
}

function readProjectionPlanRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    ...row,
    items: typeof row.itemsJson === "string" ? JSON.parse(row.itemsJson) : [],
  }));
}

async function masteryReadMetadata(env: any, userId: string) {
  const [state, stateCounts, counts, reviewCounts] = await Promise.all([
    env.DB.prepare(`SELECT * FROM private_mastery_projection_state WHERE user_id = ?`).bind(userId).first(),
    env.DB.prepare(`SELECT state, COUNT(*) AS count FROM private_mastery WHERE user_id = ? GROUP BY state`).bind(userId).all(),
    env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM private_mastery WHERE user_id = ?) AS mastery_count,
      (SELECT COUNT(*) FROM private_retention WHERE user_id = ?) AS retention_count,
      (SELECT COUNT(*) FROM private_mastery WHERE user_id = ? AND rule_version <> 'mastery-v1') +
        (SELECT COUNT(*) FROM private_retention WHERE user_id = ? AND rule_version <> 'retention-v1') AS unsupported_rule_count,
      (SELECT MIN(next_evaluation_at) FROM private_retention WHERE user_id = ? AND next_evaluation_at IS NOT NULL) AS min_next_evaluation_at,
      (SELECT COUNT(*) FROM private_mastery WHERE user_id = ? AND last_evaluated_at >= ?) AS recently_evaluated_count,
      (SELECT COUNT(*) FROM private_retention WHERE user_id = ? AND effective_mastery_state = 'NEEDS_REVIEW' AND review_state IN ('DUE','OVERDUE')) AS due_review_count,
      (SELECT COUNT(*) FROM private_retention WHERE user_id = ? AND effective_mastery_state = 'NEEDS_REVIEW' AND review_state = 'OVERDUE') AS overdue_count`)
      .bind(
        userId, userId, userId, userId, userId, userId,
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        userId, userId,
      ).first(),
    env.DB.prepare(`SELECT review_state, COUNT(*) AS count FROM private_retention WHERE user_id = ? GROUP BY review_state`).bind(userId).all(),
  ]);
  const byState = Object.fromEntries((stateCounts.results || []).map((row: any) => [row.state, Number(row.count || 0)]));
  const byReviewState = Object.fromEntries((reviewCounts.results || []).map((row: any) => [row.review_state, Number(row.count || 0)]));
  return {
    schema_version: "mastery-private-cache-v1",
    state: state || { user_id: userId, mastery_watermark: "0", retention_watermark: "0" },
    counts: {
      ...(counts || {}),
      mastery_state_counts: byState,
      review_state_counts: byReviewState,
    },
  };
}

async function handlePrivateRead(request: Request, env: any, url: URL): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET", "Cache-Control": "no-store" },
    });
  }

  const authError = await authenticate(request, env);
  if (authError) return authError;

  try {
    const path = url.pathname;
    const masteryPaths = ["/internal/private-read/mastery-dashboard", "/internal/private-read/mastery-lectures", "/internal/private-read/mastery-lecture", "/internal/private-read/mastery-reviews", "/internal/private-read/mastery-reconcile"];
    if (masteryPaths.includes(path)) {
      const userId = readStringParam(url, "userId", 200);
      if (!userId) return jsonNoStore({ ok: false, error: "userId is required." }, 400);
      const safeMastery = `user_id, lecture_id, subject_id, state, evidence_score, evidence_count,
        objective_attempt_count, objective_correct_count, objective_incorrect_count,
        flashcard_review_count, flashcard_remembered_count, flashcard_not_remembered_count,
        recall_objective_attempt_count, recall_objective_correct_count, recall_objective_incorrect_count,
        meaningful_focus_session_count, meaningful_focus_seconds, last_study_evidence_at,
        last_objective_evidence_at, last_recall_evidence_at, rule_version, revision,
        last_evaluated_at, created_at, updated_at, projected_at`;
      const safeRetention = `user_id, lecture_id, source_mastery_revision,
        source_mastery_rule_version, effective_mastery_state, retention_score, review_state,
        review_urgency_score, retention_anchor_at, next_review_at, next_evaluation_at,
        last_positive_memory_evidence_at, last_negative_memory_evidence_at,
        last_forgetting_evidence_at, objective_forgetting_item_count,
        self_reported_forgetting_item_count, forgetting_evidence_kind, rule_version,
        revision, last_evaluated_at, created_at, updated_at, projected_at`;
      const qualifiedMastery = safeMastery.replace(/\b(user_id|lecture_id|subject_id|state|evidence_score|evidence_count|objective_attempt_count|objective_correct_count|objective_incorrect_count|flashcard_review_count|flashcard_remembered_count|flashcard_not_remembered_count|recall_objective_attempt_count|recall_objective_correct_count|recall_objective_incorrect_count|meaningful_focus_session_count|meaningful_focus_seconds|last_study_evidence_at|last_objective_evidence_at|last_recall_evidence_at|rule_version|revision|last_evaluated_at|created_at|updated_at|projected_at)\b/g, "m.$1");
      if (path === "/internal/private-read/mastery-reconcile") {
        const limit = readLimit(url, 25, 100);
        const cursor = readStringParam(url, "cursor", 200);
        const where = ["ids.user_id = ?"], binds: unknown[] = [userId, userId, userId];
        if (cursor) { where.push("ids.lecture_id > ?"); binds.push(cursor); }
        const masteryReconcileSelect = safeMastery.split(",").map((column) => `m.${column.trim()} AS mastery_${column.trim()}`).join(", ");
        const retentionReconcileSelect = safeRetention.split(",").map((column) => `r.${column.trim()} AS retention_${column.trim()}`).join(", ");
        const rows = await env.DB.prepare(`WITH ids AS (
            SELECT user_id, lecture_id FROM private_mastery WHERE user_id = ?
            UNION
            SELECT user_id, lecture_id FROM private_retention WHERE user_id = ?
          )
          SELECT ids.lecture_id AS reconciliation_lecture_id, ${masteryReconcileSelect}, ${retentionReconcileSelect}
          FROM ids
          LEFT JOIN private_mastery m ON m.user_id=ids.user_id AND m.lecture_id=ids.lecture_id
          LEFT JOIN private_retention r ON r.user_id=ids.user_id AND r.lecture_id=ids.lecture_id
          WHERE ${where.join(" AND ")} ORDER BY ids.lecture_id ASC LIMIT ?`).bind(...binds, limit + 1).all();
        const page = (rows.results || []).slice(0, limit).map((raw: any) => {
          const mastery: Record<string, unknown> = {}, retention: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(raw)) {
            if (key.startsWith("mastery_")) mastery[key.slice(8)] = value;
            if (key.startsWith("retention_")) retention[key.slice(10)] = value;
          }
          return {
            lectureId: raw.reconciliation_lecture_id,
            mastery: mastery.user_id != null ? mastery : null,
            retention: retention.user_id != null ? retention : null,
          };
        });
        const next = page.length === limit && (rows.results || []).length > limit ? (page[page.length - 1] as any).lectureId : null;
        return jsonNoStore({ ...(await masteryReadMetadata(env, userId)), rows: page, nextCursor: next, next_cursor: next });
      }
      if (path === "/internal/private-read/mastery-lecture") {
        const lectureId = readStringParam(url, "lectureId", 200);
        if (!lectureId) return jsonNoStore({ ok: false, error: "lectureId is required." }, 400);
        const [mastery, retention] = await Promise.all([
          env.DB.prepare(`SELECT ${safeMastery} FROM private_mastery WHERE user_id = ? AND lecture_id = ?`).bind(userId, lectureId).first(),
          env.DB.prepare(`SELECT ${safeRetention} FROM private_retention WHERE user_id = ? AND lecture_id = ?`).bind(userId, lectureId).first(),
        ]);
        return jsonNoStore({ ...(await masteryReadMetadata(env, userId)), mastery, retention });
      }
      if (path === "/internal/private-read/mastery-lectures") {
        const limit = readLimit(url, 25, 100);
        const masteryState = strictEnum(url, "state", ["NOT_STARTED", "STARTED", "LEARNING", "NEEDS_REVIEW", "GOOD", "MASTERED"]);
        const reviewState = strictEnum(url, "reviewState", ["INSUFFICIENT_EVIDENCE", "FRESH", "DUE_SOON", "DUE", "OVERDUE"]);
        if (masteryState === "invalid" || reviewState === "invalid") return jsonNoStore({ ok: false, error: "Invalid filter enum." }, 400);
        const subject = readStringParam(url, "subjectId", 200);
        const cursor = readStringParam(url, "cursor", 200);
        const where = ["m.user_id = ?"], binds: unknown[] = [userId];
        if (masteryState) { where.push("m.state = ?"); binds.push(masteryState); }
        if (reviewState) { where.push("r.review_state = ?"); binds.push(reviewState); }
        if (subject) { where.push("m.subject_id = ?"); binds.push(subject); }
        if (cursor) { where.push("m.lecture_id > ?"); binds.push(cursor); }
        const rows = await env.DB.prepare(`SELECT ${qualifiedMastery}, r.effective_mastery_state, r.review_state, r.next_review_at AS nextReviewAt,
          r.objective_forgetting_item_count, r.self_reported_forgetting_item_count, r.last_evaluated_at AS lastEvaluatedAt
          FROM private_mastery m LEFT JOIN private_retention r ON r.user_id=m.user_id AND r.lecture_id=m.lecture_id
          WHERE ${where.join(" AND ")} ORDER BY m.lecture_id ASC LIMIT ?`).bind(...binds, limit + 1).all();
        const page = (rows.results || []).slice(0, limit) as any[];
        const next = page.length === limit && (rows.results || []).length > limit ? page[page.length - 1].lecture_id : null;
        return jsonNoStore({ ...(await masteryReadMetadata(env, userId)), rows: page, nextCursor: next, next_cursor: next });
      }
      if (path === "/internal/private-read/mastery-reviews") {
        const limit = readLimit(url, 25, 100);
        const state = strictEnum(url, "reviewState", ["DUE", "OVERDUE"]);
        if (state === "invalid") return jsonNoStore({ ok: false, error: "reviewState must be DUE or OVERDUE." }, 400);
        const subject = readStringParam(url, "subjectId", 200);
        const cursor = readStringParam(url, "cursor", 200);
        const where = ["r.user_id = ?"], binds: unknown[] = [userId];
        where.push("r.effective_mastery_state = 'NEEDS_REVIEW'");
        if (state) { where.push("r.review_state = ?"); binds.push(state); } else where.push("r.review_state IN ('DUE','OVERDUE')");
        if (subject) { where.push("m.subject_id = ?"); binds.push(subject); }
        if (cursor) { where.push("r.lecture_id > ?"); binds.push(cursor); }
        const qualifiedRetention = safeRetention.split(",").map((column) => `r.${column.trim()}`).join(", ");
        const rows = await env.DB.prepare(`SELECT ${qualifiedRetention}, m.subject_id, m.state,
          m.objective_attempt_count, m.objective_correct_count, m.objective_incorrect_count,
          m.flashcard_review_count, r.next_review_at AS nextReviewAt, r.last_evaluated_at AS lastEvaluatedAt
          FROM private_retention r LEFT JOIN private_mastery m ON m.user_id=r.user_id AND m.lecture_id=r.lecture_id WHERE ${where.join(" AND ")} ORDER BY r.lecture_id ASC LIMIT ?`).bind(...binds, limit + 1).all();
        const page = (rows.results || []).slice(0, limit) as any[];
        return jsonNoStore({ ...(await masteryReadMetadata(env, userId)), rows: page, nextCursor: page.length === limit && (rows.results || []).length > limit ? page[page.length - 1].lecture_id : null, next_cursor: page.length === limit && (rows.results || []).length > limit ? page[page.length - 1].lecture_id : null });
      }
      const [counts, stateCounts, due, subjects, state] = await Promise.all([
        env.DB.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN state = 'MASTERED' THEN 1 ELSE 0 END) AS mastered FROM private_mastery WHERE user_id = ?`).bind(userId).first(),
        env.DB.prepare(`SELECT state, COUNT(*) AS count FROM private_mastery WHERE user_id = ? GROUP BY state ORDER BY state`).bind(userId).all(),
        env.DB.prepare(`SELECT COUNT(*) AS due FROM private_retention WHERE user_id = ? AND review_state IN ('DUE','OVERDUE') AND effective_mastery_state = 'NEEDS_REVIEW' AND next_review_at IS NOT NULL AND next_review_at <= ?`).bind(userId, new Date().toISOString()).first(),
        env.DB.prepare(`SELECT m.subject_id, m.state, r.review_state, COUNT(*) AS count,
          SUM(CASE WHEN r.review_state IN ('DUE','OVERDUE') AND r.effective_mastery_state = 'NEEDS_REVIEW' THEN 1 ELSE 0 END) AS due_review_count,
          SUM(CASE WHEN r.review_state = 'OVERDUE' AND r.effective_mastery_state = 'NEEDS_REVIEW' THEN 1 ELSE 0 END) AS overdue_count,
          SUM(CASE WHEN m.last_evaluated_at >= ? THEN 1 ELSE 0 END) AS recently_evaluated_count
          FROM private_mastery m LEFT JOIN private_retention r ON r.user_id=m.user_id AND r.lecture_id=m.lecture_id
          WHERE m.user_id = ? GROUP BY m.subject_id, m.state, r.review_state ORDER BY m.subject_id, m.state, r.review_state`).bind(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), userId).all(),
        env.DB.prepare(`SELECT * FROM private_mastery_projection_state WHERE user_id = ?`).bind(userId).first(),
      ]);
      const dueRows = await env.DB.prepare(`SELECT r.user_id, r.lecture_id, m.subject_id, m.state, r.effective_mastery_state, r.review_state,
        r.next_review_at AS nextReviewAt, r.last_evaluated_at AS lastEvaluatedAt,
        m.objective_attempt_count, m.objective_correct_count, m.objective_incorrect_count,
        m.flashcard_review_count, r.review_urgency_score
        FROM private_retention r LEFT JOIN private_mastery m ON m.user_id=r.user_id AND m.lecture_id=r.lecture_id
        WHERE r.user_id = ? AND r.review_state IN ('DUE','OVERDUE') AND r.effective_mastery_state = 'NEEDS_REVIEW'
          AND r.next_review_at IS NOT NULL AND r.next_review_at <= ? ORDER BY r.next_review_at ASC LIMIT 10`).bind(userId, new Date().toISOString()).all();
      const metadata = await env.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM private_mastery WHERE user_id = ?) AS mastery_count,
        (SELECT COUNT(*) FROM private_retention WHERE user_id = ?) AS retention_count,
        (SELECT COUNT(*) FROM private_mastery WHERE user_id = ? AND rule_version <> 'mastery-v1') +
          (SELECT COUNT(*) FROM private_retention WHERE user_id = ? AND rule_version <> 'retention-v1') AS unsupported_rule_count,
        (SELECT MIN(next_evaluation_at) FROM private_retention WHERE user_id = ? AND next_evaluation_at IS NOT NULL) AS min_next_evaluation_at,
        (SELECT COUNT(*) FROM private_mastery WHERE user_id = ? AND last_evaluated_at >= ?) AS recently_evaluated_count,
        (SELECT COUNT(*) FROM private_retention WHERE user_id = ? AND effective_mastery_state = 'NEEDS_REVIEW' AND review_state IN ('DUE','OVERDUE')) AS due_review_count,
        (SELECT COUNT(*) FROM private_retention WHERE user_id = ? AND effective_mastery_state = 'NEEDS_REVIEW' AND review_state = 'OVERDUE') AS overdue_count`)
        .bind(
          userId, userId, userId, userId, userId, userId,
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          userId, userId,
        ).first();
      const reviewCountRows = await env.DB.prepare(
        `SELECT review_state, COUNT(*) AS count FROM private_retention WHERE user_id = ? GROUP BY review_state`
      ).bind(userId).all();
      const reviewStateCounts = Object.fromEntries(
        (reviewCountRows.results || []).map((row: any) => [row.review_state, Number(row.count || 0)])
      );
      const byState = Object.fromEntries((stateCounts.results || []).map((row: any) => [row.state, Number(row.count || 0)]));
      const subjectAggregates = new Map<string, any>();
      for (const row of (subjects.results || []) as any[]) {
        const key = String(row.subject_id || "");
        const item = subjectAggregates.get(key) || { subject_id: row.subject_id, count: 0, due_review_count: 0, overdue_count: 0, recently_evaluated_count: 0, mastery_state_counts: {}, review_state_counts: {} };
        item.count += Number(row.count || 0);
        item.due_review_count += Number(row.due_review_count || 0);
        item.overdue_count += Number(row.overdue_count || 0);
        item.recently_evaluated_count += Number(row.recently_evaluated_count || 0);
        if (row.state) item.mastery_state_counts[row.state] = (item.mastery_state_counts[row.state] || 0) + Number(row.count || 0);
        if (row.review_state) item.review_state_counts[row.review_state] = (item.review_state_counts[row.review_state] || 0) + Number(row.count || 0);
        subjectAggregates.set(key, item);
      }
      return jsonNoStore({
        totals: { ...(counts || {}), byState },
        counts: {
          ...(metadata || {}),
          recently_evaluated: Number((metadata as any)?.recently_evaluated_count || 0),
          recentlyEvaluatedWindowDays: 7,
          review_state_counts: reviewStateCounts,
        },
        schema_version: "mastery-private-cache-v1",
        due: dueRows.results || [],
        subjectAggregates: [...subjectAggregates.values()],
        state: state || { user_id: userId, mastery_watermark: "0", retention_watermark: "0" },
      });
    }

    if (path === "/internal/private-read/focus-plans") {
      const userId = projectionReadUser(url);
      if (!userId) return jsonNoStore({ ok: false, error: "userId is required." }, 400);
      const limit = readLimit(url, 100, 500);
      const result = await env.DB.prepare(
        `SELECT * FROM "FocusPlan"
         WHERE "userScope" = ? AND "deletedAt" IS NULL
         ORDER BY "updatedAt" DESC, "id" ASC
         LIMIT ?`
      ).bind(userId, limit).all();
      return jsonNoStore({ rows: readProjectionPlanRows(result.results || []) });
    }

    if (path === "/internal/private-read/focus-sessions") {
      const userId = projectionReadUser(url);
      if (!userId) return jsonNoStore({ ok: false, error: "userId is required." }, 400);
      const status = readStringParam(url, "status", 80);
      const limit = readLimit(url, 100, 500);
      const result = status
        ? await env.DB.prepare(
          `SELECT * FROM "FocusSession"
           WHERE "userScope" = ? AND "deletedAt" IS NULL AND "status" = ?
           ORDER BY "updatedAt" DESC, "id" ASC
           LIMIT ?`
        ).bind(userId, status, limit).all()
        : await env.DB.prepare(
          `SELECT * FROM "FocusSession"
           WHERE "userScope" = ? AND "deletedAt" IS NULL
           ORDER BY "updatedAt" DESC, "id" ASC
           LIMIT ?`
        ).bind(userId, limit).all();
      return jsonNoStore({ rows: result.results || [] });
    }

    if (path === "/internal/private-read/study-daily-metrics") {
      const userId = projectionReadUser(url);
      if (!userId) return jsonNoStore({ ok: false, error: "userId is required." }, 400);
      const from = readStringParam(url, "from", 10);
      const to = readStringParam(url, "to", 10);
      for (const date of [from, to]) {
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return jsonNoStore({ ok: false, error: "from and to must be ISO dates." }, 400);
        }
      }
      const limit = readLimit(url, 366, 366);
      const predicates = ['"userScope" = ?', '"deletedAt" IS NULL'];
      const bindings: unknown[] = [userId];
      if (from) {
        predicates.push('"metricDate" >= ?');
        bindings.push(from);
      }
      if (to) {
        predicates.push('"metricDate" <= ?');
        bindings.push(to);
      }
      bindings.push(limit);
      const result = await env.DB.prepare(
        `SELECT * FROM "StudyDailyMetric"
         WHERE ${predicates.join(" AND ")}
         ORDER BY "metricDate" DESC, "id" ASC
         LIMIT ?`
      ).bind(...bindings).all();
      return jsonNoStore({ rows: result.results || [] });
    }

    if (path === "/internal/private-read/auth-user") {
      const id = readStringParam(url, "id");
      const email = readStringParam(url, "email");
      if ((!id && !email) || (id && email)) {
        return jsonNoStore({ ok: false, error: "Provide exactly one of id or email." }, 400);
      }

      const where = id ? `"id" = ?` : `lower("email") = lower(?)`;
      const value = id || email || "";
      const row = await env.DB.prepare(
        `SELECT
          "id","email","profileEmail","role","sessionVersion","name","avatar","avatarUrl",
          "totalPoints","level","levelBadge","streakDays","totalTimeSpent","lastActive",
          "createdAt","accountStatus","isOnline","studentGroup","isPrimaryOwner","emailVerified"
         FROM "User"
         WHERE ${where}
         LIMIT 1`
      ).bind(value).first();

      return jsonNoStore({
        row: mapIntegerBooleans(row || null, ["isOnline","isPrimaryOwner","emailVerified"]),
      });
    }

    if (path === "/internal/private-read/users") {
      const limit = readLimit(url, 200, 2000);
      const result = await env.DB.prepare(
        `SELECT
          "id","email","name","avatar","avatarUrl","role","isPrimaryOwner","isOnline",
          "lastSeen","createdAt","updatedAt","studentGroup","accountStatus"
         FROM "User"
         ORDER BY "isOnline" DESC, lower(COALESCE("name", "")) ASC, "id" ASC
         LIMIT ?`
      ).bind(limit).all();

      return jsonNoStore({
        rows: mapManyIntegerBooleans(result.results || [], ["isPrimaryOwner","isOnline"]),
      });
    }

    if (path === "/internal/private-read/lecture-progress") {
      const userId = readStringParam(url, "userId");
      if (!userId) return jsonNoStore({ ok: false, error: "userId is required." }, 400);
      const result = await env.DB.prepare(
        `SELECT * FROM "LectureProgress" WHERE "userId" = ? LIMIT 2000`
      ).bind(userId).all();
      return jsonNoStore({
        rows: mapManyIntegerBooleans(
          result.results || [],
          ["pdfCompleted","notesCompleted","videoCompleted","flashcardsCompleted","quizCompleted"],
        ),
      });
    }

    if (path === "/internal/private-read/flashcard-progress") {
      const userId = readStringParam(url, "userId");
      if (!userId) return jsonNoStore({ ok: false, error: "userId is required." }, 400);
      const result = await env.DB.prepare(
        `SELECT * FROM "FlashcardProgress" WHERE "userId" = ?`
      ).bind(userId).all();
      return jsonNoStore({ rows: result.results || [] });
    }

    if (path === "/internal/private-read/points-logs") {
      const userId = readStringParam(url, "userId");
      if (!userId) return jsonNoStore({ ok: false, error: "userId is required." }, 400);
      const limit = readLimit(url, 50, 500);
      const result = await env.DB.prepare(
        `SELECT * FROM "PointsLog"
         WHERE "userId" = ?
         ORDER BY "createdAt" DESC, "id" DESC
         LIMIT ?`
      ).bind(userId, limit).all();
      return jsonNoStore({ rows: result.results || [] });
    }

    if (path === "/internal/private-read/personal-calendar") {
      const userId = readStringParam(url, "userId");
      if (!userId) return jsonNoStore({ ok: false, error: "userId is required." }, 400);
      const result = await env.DB.prepare(
        `SELECT * FROM "UserCalendarEvent" WHERE "userId" = ? LIMIT 2000`
      ).bind(userId).all();
      return jsonNoStore({
        rows: mapManyIntegerBooleans(result.results || [], ["isPinned","isCompleted"]),
      });
    }

    if (path === "/internal/private-read/material-progress") {
      const userId = readStringParam(url, "userId");
      const materialId = readStringParam(url, "materialId");
      if (!userId || !materialId) {
        return jsonNoStore({ ok: false, error: "userId and materialId are required." }, 400);
      }
      const row = await env.DB.prepare(
        `SELECT * FROM "UserProgress" WHERE "userId" = ? AND "materialId" = ? LIMIT 1`
      ).bind(userId, materialId).first();
      return jsonNoStore({
        row: mapIntegerBooleans(row || null, ["hasViewed","isCompleted"]),
      });
    }

    if (path === "/internal/private-read/notifications") {
      const userId = readStringParam(url, "userId");
      if (!userId) return jsonNoStore({ ok: false, error: "userId is required." }, 400);
      const group = readStringParam(url, "group", 10);
      const limit = readLimit(url, 50, 100);

      const sql = group
        ? `SELECT * FROM "Notification"
           WHERE ("targetUserId" IS NULL OR "targetUserId" = ?)
             AND ("targetGroup" IS NULL OR "targetGroup" = ?)
           ORDER BY "createdAt" DESC, "id" DESC LIMIT ?`
        : `SELECT * FROM "Notification"
           WHERE ("targetUserId" IS NULL OR "targetUserId" = ?)
             AND "targetGroup" IS NULL
           ORDER BY "createdAt" DESC, "id" DESC LIMIT ?`;

      const result = group
        ? await env.DB.prepare(sql).bind(userId, group, limit).all()
        : await env.DB.prepare(sql).bind(userId, limit).all();

      return jsonNoStore({
        rows: mapManyIntegerBooleans(result.results || [], ["isSystem"]),
      });
    }

    if (path === "/internal/private-read/ban") {
      const userId = readStringParam(url, "userId");
      if (!userId) return jsonNoStore({ ok: false, error: "userId is required." }, 400);
      const row = await env.DB.prepare(
        `SELECT * FROM "UserBan" WHERE "userId" = ? LIMIT 1`
      ).bind(userId).first();
      return jsonNoStore({ row: mapIntegerBooleans(row || null, ["isPermanent"]) });
    }

    if (path === "/internal/private-read/mute") {
      const userId = readStringParam(url, "userId");
      if (!userId) return jsonNoStore({ ok: false, error: "userId is required." }, 400);
      const row = await env.DB.prepare(
        `SELECT * FROM "UserMute" WHERE "userId" = ? LIMIT 1`
      ).bind(userId).first();
      return jsonNoStore({ row: mapIntegerBooleans(row || null, ["isPermanent"]) });
    }

    if (path === "/internal/private-read/blocks") {
      const userId = readStringParam(url, "userId");
      if (!userId) return jsonNoStore({ ok: false, error: "userId is required." }, 400);
      const result = await env.DB.prepare(
        `SELECT * FROM "UserBlock"
         WHERE "blockerId" = ? OR "blockedId" = ?
         ORDER BY "createdAt" DESC, "id" DESC`
      ).bind(userId, userId).all();
      return jsonNoStore({ rows: result.results || [] });
    }


    if (path === "/internal/private-read/blocked-users") {
      const userId = readStringParam(url, "userId");
      if (!userId) return jsonNoStore({ ok: false, error: "userId is required." }, 400);

      const result = await env.DB.prepare(
        `SELECT
          b."id" AS "blockId",
          b."blockedId" AS "id",
          b."createdAt" AS "blockedAt",
          u."name" AS "name",
          u."avatar" AS "avatar",
          u."avatarUrl" AS "avatarUrl"
         FROM "UserBlock" b
         LEFT JOIN "User" u ON u."id" = b."blockedId"
         WHERE b."blockerId" = ?
         ORDER BY b."createdAt" DESC, b."id" DESC`
      ).bind(userId).all();

      return jsonNoStore({ rows: result.results || [] });
    }

    if (path === "/internal/private-read/admin-roster") {
      const limit = readLimit(url, 1000, 2000);

      const usersResult = await env.DB.prepare(
        `SELECT
          "id","name","email","profileEmail","role","isPrimaryOwner","emailVerified",
          "avatar","avatarUrl","totalPoints","level","levelBadge","streakDays",
          "totalTimeSpent","lastActive","createdAt"
         FROM "User"
         ORDER BY "id" ASC
         LIMIT ?`
      ).bind(limit).all();

      const progressResult = await env.DB.prepare(
        `SELECT
          "userId","lectureId","pdfCompleted","notesCompleted","videoCompleted",
          "flashcardsCompleted","quizCompleted","quizScore","lastAccessed"
         FROM "LectureProgress"
         ORDER BY "userId" ASC, "lectureId" ASC
         LIMIT 10000`
      ).all();

      const progressByUser = new Map<string, any[]>();
      for (const raw of progressResult.results || []) {
        const row: any = raw;
        const arr = progressByUser.get(String(row.userId)) || [];
        arr.push({
          userId: row.userId,
          lectureId: row.lectureId,
          pdfCompleted: Number(row.pdfCompleted) === 1,
          notesCompleted: Number(row.notesCompleted) === 1,
          videoCompleted: Number(row.videoCompleted) === 1,
          flashcardsCompleted: Number(row.flashcardsCompleted) === 1,
          quizCompleted: Number(row.quizCompleted) === 1,
          quizScore: Number(row.quizScore || 0),
          lastAccessed: row.lastAccessed,
        });
        progressByUser.set(String(row.userId), arr);
      }

      const rows = (usersResult.results || []).map((raw: any) => {
        const progress = progressByUser.get(String(raw.id)) || [];
        return {
          id: raw.id,
          name: raw.name || "",
          email: raw.email,
          profileEmail: raw.profileEmail ?? null,
          role: raw.role,
          isAdmin: raw.role === "admin",
          isPrimaryOwner: Number(raw.isPrimaryOwner) === 1,
          emailVerified: Number(raw.emailVerified) === 1,
          avatar: raw.avatar || "",
          avatarUrl: raw.avatarUrl || raw.avatar || "",
          totalPoints: Number(raw.totalPoints || 0),
          level: raw.level,
          levelBadge: raw.levelBadge,
          streakDays: Number(raw.streakDays || 0),
          totalTimeSpent: Number(raw.totalTimeSpent || 0),
          lastActive: raw.lastActive,
          created_at: raw.createdAt,
          completedLectCount: progress.filter((p) => p.pdfCompleted).length,
          completedQuizzesCount: progress.filter((p) => p.quizCompleted).length,
          progress,
        };
      });

      rows.sort((a: any, b: any) =>
        ((b.totalPoints || 0) - (a.totalPoints || 0)) ||
        String(a.id).localeCompare(String(b.id))
      );
      return jsonNoStore({ rows });
    }

    if (path === "/internal/private-read/qa") {
      const lectureId = readStringParam(url, "lectureId");
      const callerId = readStringParam(url, "callerId");
      if (!lectureId || !callerId) {
        return jsonNoStore({ ok: false, error: "lectureId and callerId are required." }, 400);
      }

      const blockedResult = await env.DB.prepare(
        `SELECT "blockedId" FROM "UserBlock" WHERE "blockerId" = ?`
      ).bind(callerId).all();
      const blocked = new Set((blockedResult.results || []).map((r: any) => String(r.blockedId)));

      const qResult = await env.DB.prepare(
        `SELECT
          q."id", q."lectureId", q."userId", q."content", q."upvotes",
          q."createdAt", u."name" AS "userName", u."avatar" AS "userAvatarRaw",
          u."avatarUrl" AS "userAvatarUrl"
         FROM "QaQuestion" q
         LEFT JOIN "User" u ON u."id" = q."userId"
         WHERE q."lectureId" = ? AND q."isDeleted" = 0
         ORDER BY q."createdAt" DESC, q."id" DESC`
      ).bind(lectureId).all();

      const aResult = await env.DB.prepare(
        `SELECT
          a."id", a."questionId", a."userId", a."content", a."upvotes",
          a."isBest", a."createdAt", u."name" AS "userName",
          u."avatar" AS "userAvatarRaw", u."avatarUrl" AS "userAvatarUrl"
         FROM "QaAnswer" a
         INNER JOIN "QaQuestion" q ON q."id" = a."questionId"
         LEFT JOIN "User" u ON u."id" = a."userId"
         WHERE q."lectureId" = ? AND a."isDeleted" = 0
         ORDER BY a."createdAt" ASC, a."id" ASC`
      ).bind(lectureId).all();

      const answersByQuestion = new Map<string, any[]>();
      for (const row of aResult.results || []) {
        const questionId = String((row as any).questionId);
        const arr = answersByQuestion.get(questionId) || [];
        if (arr.length < 200) {
          arr.push({
            id: (row as any).id,
            questionId: (row as any).questionId,
            userId: (row as any).userId,
            userName: (row as any).userName || "Unknown",
            userAvatar: (row as any).userAvatarUrl || (row as any).userAvatarRaw || "",
            content: (row as any).content,
            createdAt: (row as any).createdAt,
            upvotes: Number((row as any).upvotes || 0),
            isBest: Number((row as any).isBest) === 1,
            isBlocked: blocked.has(String((row as any).userId)),
          });
        }
        answersByQuestion.set(questionId, arr);
      }

      const rows = (qResult.results || []).map((row: any) => ({
        id: row.id,
        lectureId: row.lectureId,
        user_id: row.userId,
        userName: row.userName || "Unknown",
        userAvatar: row.userAvatarUrl || row.userAvatarRaw || "",
        content: row.content,
        createdAt: row.createdAt,
        upvotes: Number(row.upvotes || 0),
        isBlocked: blocked.has(String(row.userId)),
        answers: answersByQuestion.get(String(row.id)) || [],
      }));

      return jsonNoStore({ rows });
    }

    return jsonNoStore({ ok: false, error: "Unknown private read endpoint." }, 404);
  } catch (error) {
    console.error("[PrivateDataRead]", error);
    return jsonNoStore({ ok: false, error: "Private read failed." }, 500);
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

    if (url.pathname.startsWith("/internal/leaderboard-cache/")) {
      return handleLeaderboardCache(request, env);
    }

    if (url.pathname.startsWith("/internal/private-read/")) {
      return handlePrivateRead(request, env, url);
    }

    return new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  },
};
