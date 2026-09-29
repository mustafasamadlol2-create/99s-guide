import { getPrisma } from "../../services/prismaClient.js";
import { fetchPrivateReadJson } from "../../services/privateD1Read.js";
import { enqueueMasteryD1RowDeletion } from "../../services/privateD1Sync.js";
import {
  enqueueLectureMasteryD1Projection,
  enqueueLectureRetentionD1Projection,
  lectureMasteryD1Payload,
  lectureRetentionD1Payload,
} from "./d1Projection.js";
import type { LectureMasteryProjection } from "./repository.js";
import type { LectureRetentionProjection } from "./retentionTypes.js";

export const MASTERY_RECONCILIATION_STATUSES = [
  "OK", "D1_UNAVAILABLE", "D1_SCHEMA_MISMATCH", "WATERMARK_MISMATCH",
  "COUNT_MISMATCH", "MISSING_MASTERY", "MISSING_RETENTION",
  "ORPHAN_MASTERY", "ORPHAN_RETENTION", "MASTERY_REVISION_MISMATCH",
  "RETENTION_REVISION_MISMATCH", "MASTERY_RULE_MISMATCH", "RETENTION_RULE_MISMATCH",
  "PAYLOAD_MISMATCH", "RETENTION_TIME_STALE",
] as const;
export type MasteryReconciliationStatus = (typeof MASTERY_RECONCILIATION_STATUSES)[number];

export type MasteryReconciliationReport = {
  userId: string;
  lectureId: string | null;
  repair: boolean;
  status: MasteryReconciliationStatus;
  statuses: Array<{ lectureId: string; codes: MasteryReconciliationStatus[] }>;
  checked: number;
  repaired: number;
  d1: { available: boolean; watermarkMismatch: boolean; countMismatch: boolean };
};

type D1Row = Record<string, any>;
type D1Payload = { schema_version?: unknown; state?: D1Row; counts?: D1Row; rows?: unknown[]; nextCursor?: unknown; next_cursor?: unknown };

export const MASTERY_D1_CACHE_SCHEMA_VERSION = "mastery-private-cache-v1" as const;
const SCHEMA = MASTERY_D1_CACHE_SCHEMA_VERSION;
const MAX_PAGE = 100;
const MAX_ID = 200;

function iso(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }
  return value;
}

function payloadEqual(left: Record<string, unknown>, right: D1Row, fields: string[]): boolean {
  return fields.every((field) => {
    const a = iso(left[field]);
    const b = iso(right[field]);
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  });
}

function rowCodes(
  mastery: any | null,
  retention: any | null,
  d1Mastery: D1Row | null,
  d1Retention: D1Row | null,
  now: Date,
  subjectId: string | null,
): MasteryReconciliationStatus[] {
  const codes: MasteryReconciliationStatus[] = [];
  if (!mastery && d1Mastery) codes.push("ORPHAN_MASTERY");
  if (mastery && !d1Mastery) codes.push("MISSING_MASTERY");
  if (!retention && d1Retention) codes.push("ORPHAN_RETENTION");
  if (retention && !d1Retention) codes.push("MISSING_RETENTION");
  if (mastery && d1Mastery) {
    if (Number(d1Mastery.revision) !== mastery.revision) codes.push("MASTERY_REVISION_MISMATCH");
    if (String(d1Mastery.rule_version) !== mastery.ruleVersion) codes.push("MASTERY_RULE_MISMATCH");
    const expected = lectureMasteryD1Payload(mastery as LectureMasteryProjection, subjectId);
    if (!payloadEqual(expected, d1Mastery, Object.keys(expected))) codes.push("PAYLOAD_MISMATCH");
  }
  if (retention && d1Retention) {
    if (Number(d1Retention.revision) !== retention.revision) codes.push("RETENTION_REVISION_MISMATCH");
    if (String(d1Retention.rule_version) !== retention.ruleVersion) codes.push("RETENTION_RULE_MISMATCH");
    const expected = lectureRetentionD1Payload(retention as LectureRetentionProjection);
    if (!payloadEqual(expected, d1Retention, Object.keys(expected))) codes.push("PAYLOAD_MISMATCH");
    if (retention.nextEvaluationAt && retention.nextEvaluationAt <= now) codes.push("RETENTION_TIME_STALE");
  }
  return [...new Set(codes)];
}

function validPage(payload: D1Payload, userId: string): payload is D1Payload & { rows: D1Row[] } {
  return payload.schema_version === SCHEMA &&
    !!payload.state && payload.state.user_id === userId &&
    Array.isArray(payload.rows) &&
    payload.rows.every((row) => row && typeof row === "object" && typeof (row as D1Row).lectureId === "string" ||
      row && typeof row === "object" && typeof (row as D1Row).lecture_id === "string");
}

function pageRow(row: D1Row): { lectureId: string; mastery: D1Row | null; retention: D1Row | null } {
  return {
    lectureId: String(row.lectureId ?? row.lecture_id),
    mastery: row.mastery ?? row.mastery_row ?? null,
    retention: row.retention ?? row.retention_row ?? null,
  };
}

export function compareMasteryD1Rows(input: {
  mastery?: any | null; retention?: any | null;
  d1Mastery?: D1Row | null; d1Retention?: D1Row | null;
  subjectId?: string | null; now?: Date;
}): MasteryReconciliationStatus[] {
  return rowCodes(input.mastery ?? null, input.retention ?? null, input.d1Mastery ?? null,
    input.d1Retention ?? null, input.now ?? new Date(), input.subjectId ?? null);
}

export async function reconcileMasteryD1Projection(input: {
  userId: string;
  lectureId?: string;
  repair?: boolean;
}): Promise<MasteryReconciliationReport> {
  const { userId, lectureId, repair = false } = input;
  if (!userId || userId.trim() !== userId || userId.length > MAX_ID ||
      (lectureId !== undefined && (!lectureId || lectureId.trim() !== lectureId || lectureId.length > MAX_ID))) {
    throw new Error("Invalid reconciliation scope.");
  }
  const db: any = getPrisma();
  const where = { userId, ...(lectureId ? { lectureId } : {}) };
  const [masteryRows, retentionRows, state] = await Promise.all([
    db.lectureMastery.findMany({ where, orderBy: { lectureId: "asc" } }),
    db.lectureRetention.findMany({ where, orderBy: { lectureId: "asc" } }),
    db.masteryD1ProjectionState.findUnique({ where: { userId } }),
  ]);
  const lectures = masteryRows.length
    ? await db.lecture.findMany({
        where: { id: { in: masteryRows.map((row: any) => row.lectureId) } },
        select: { id: true, mainSubject: true },
      })
    : [];
  const subjectByLecture = new Map(lectures.map((row: any) => [row.id, row.mainSubject ?? null]));
  const canonical = new Map<string, { mastery: any | null; retention: any | null }>();
  for (const row of masteryRows) canonical.set(row.lectureId, { mastery: row, retention: null });
  for (const row of retentionRows) canonical.set(row.lectureId, { ...(canonical.get(row.lectureId) ?? { mastery: null }), retention: row });

  const d1 = new Map<string, { mastery: D1Row | null; retention: D1Row | null }>();
  let cursor: string | undefined;
  let d1Available = true;
  let d1SchemaMismatch = false;
  try {
    do {
      const payload = await fetchPrivateReadJson<D1Payload>("/internal/private-read/mastery-reconcile", {
        userId, ...(lectureId ? { lectureId } : {}), limit: MAX_PAGE, cursor,
      });
      if (!validPage(payload, userId)) { d1SchemaMismatch = true; break; }
      for (const raw of payload.rows) {
        const row = pageRow(raw);
        if (!lectureId || row.lectureId === lectureId) d1.set(row.lectureId, { mastery: row.mastery, retention: row.retention });
      }
      const next = payload.nextCursor ?? payload.next_cursor;
      cursor = typeof next === "string" && next.length <= MAX_ID ? next : undefined;
    } while (cursor);
  } catch {
    d1Available = false;
  }

  const statuses: Array<{ lectureId: string; codes: MasteryReconciliationStatus[] }> = [];
  const ids = new Set([...canonical.keys(), ...d1.keys()]);
  for (const id of [...ids].sort()) {
    const expected = canonical.get(id) ?? { mastery: null, retention: null };
    const actual = d1.get(id) ?? { mastery: null, retention: null };
    const codes = rowCodes(expected.mastery, expected.retention, actual.mastery, actual.retention,
      new Date(), (subjectByLecture.get(id) as string | null | undefined) ?? null);
    if (codes.length) statuses.push({ lectureId: id, codes });
  }

  let watermarkMismatch = false;
  let countMismatch = false;
  if (d1Available && !d1SchemaMismatch) {
    const first = await fetchPrivateReadJson<D1Payload>("/internal/private-read/mastery-reconcile", {
      userId, limit: 1, ...(lectureId ? { lectureId } : {}),
    }).catch(() => null);
    const d1State = first?.state;
    watermarkMismatch = !d1State ||
      String(d1State.mastery_watermark ?? "0") !== String(state?.masteryWatermark ?? 0) ||
      String(d1State.retention_watermark ?? "0") !== String(state?.retentionWatermark ?? 0);
    const counts = first?.counts;
    countMismatch = !!counts && (!lectureId &&
      (Number(counts.mastery_count) !== masteryRows.length || Number(counts.retention_count) !== retentionRows.length));
  }
  if (watermarkMismatch) statuses.push({ lectureId: lectureId ?? "*", codes: ["WATERMARK_MISMATCH"] });
  if (countMismatch) statuses.push({ lectureId: lectureId ?? "*", codes: ["COUNT_MISMATCH"] });
  if (!d1Available) statuses.push({ lectureId: lectureId ?? "*", codes: ["D1_UNAVAILABLE"] });
  if (d1SchemaMismatch) statuses.push({ lectureId: lectureId ?? "*", codes: ["D1_SCHEMA_MISMATCH"] });

  let repaired = 0;
  if (repair) {
    await db.$transaction(async (tx: any) => {
      for (const row of masteryRows) {
        await enqueueLectureMasteryD1Projection(tx, row, (subjectByLecture.get(row.lectureId) as string | null | undefined) ?? null);
        repaired++;
      }
      for (const row of retentionRows) {
        await enqueueLectureRetentionD1Projection(tx, row);
        repaired++;
      }
      if (d1Available && !d1SchemaMismatch) {
        for (const [id, actual] of d1) {
          const expected = canonical.get(id);
          if (actual.mastery && !expected?.mastery) {
            await enqueueMasteryD1RowDeletion(tx, { entity: "LectureMastery", userId, lectureId: id });
            repaired++;
          }
          if (actual.retention && !expected?.retention) {
            await enqueueMasteryD1RowDeletion(tx, { entity: "LectureRetention", userId, lectureId: id });
            repaired++;
          }
        }
      }
    });
  }
  return {
    userId, lectureId: lectureId ?? null, repair, status: !statuses.length ? "OK" : statuses[0].codes[0],
    statuses, checked: ids.size, repaired,
    d1: { available: d1Available, watermarkMismatch, countMismatch },
  };
}