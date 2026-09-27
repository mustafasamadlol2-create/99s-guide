import { Prisma } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import {
  RETENTION_MAX_REFRESH_LECTURES,
  RETENTION_RULE_VERSION,
} from "./retentionConstants.js";
import { LectureMasteryError } from "./errors.js";
import {
  loadLectureRetentionMemoryEvidence,
  type RetentionQueryClient,
} from "./retentionEvidence.js";
import { evaluateLectureRetention } from "./retentionEvaluator.js";
import {
  findLectureRetention,
  findUserLectureRetention,
  writeLectureRetentionProjection,
} from "./retentionRepository.js";
import {
  refreshUserLectureMastery,
  type LectureMasteryRefreshResult,
} from "./refresh.js";
import type {
  LectureRetentionEvaluation,
  LectureRetentionProjection,
} from "./retentionTypes.js";

export type LectureRetentionRefreshResult = {
  evaluation: LectureRetentionEvaluation | null;
  row: LectureRetentionProjection;
  changed: boolean;
  mastery: LectureMasteryRefreshResult;
};

export type LectureRetentionInput = {
  userId: string;
  lectureId: string;
  asOf?: Date;
  tx?: RetentionQueryClient;
};

export async function refreshLectureRetention(
  input: LectureRetentionInput,
): Promise<LectureRetentionRefreshResult> {
  validateIdentity(input.userId, input.lectureId);
  const [result] = await refreshUserLectureRetention({
    userId: input.userId,
    lectureIds: [input.lectureId],
    asOf: input.asOf,
    tx: input.tx,
  });
  if (!result) {
    throw new Error("Retention refresh omitted the requested lecture.");
  }
  return result;
}

export async function refreshUserLectureRetention(input: {
  userId: string;
  lectureIds: readonly string[];
  asOf?: Date;
  tx?: RetentionQueryClient;
}): Promise<LectureRetentionRefreshResult[]> {
  validateBatch(input.userId, input.lectureIds);
  const lectureIds = [...new Set(input.lectureIds)];
  if (lectureIds.length === 0) return [];
  const asOf = captureAsOf(input.asOf);

  if (input.tx) {
    return refreshBatchWithClient(input.tx, input.userId, lectureIds, asOf);
  }

  const database = getPrisma();
  return database.$transaction(
    (tx) => refreshBatchWithClient(tx, input.userId, lectureIds, asOf),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 20_000,
    },
  );
}

export async function readStoredLectureRetention(
  userId: string,
  lectureId: string,
  client: RetentionQueryClient = getPrisma(),
): Promise<LectureRetentionProjection | null> {
  return findLectureRetention(client, userId, lectureId);
}

async function refreshBatchWithClient(
  client: RetentionQueryClient,
  userId: string,
  lectureIds: readonly string[],
  asOf: Date,
): Promise<LectureRetentionRefreshResult[]> {
  const masteryResults = await refreshUserLectureMastery({
    userId,
    lectureIds,
    asOf,
    tx: client,
  });
  const storedRows = await findUserLectureRetention(
    client,
    userId,
    lectureIds,
  );
  const storedByLecture = new Map(
    storedRows.map((row) => [row.lectureId, row]),
  );

  const refreshTargets = masteryResults.filter(({ row: mastery }) => {
    const stored = storedByLecture.get(mastery.lectureId);
    return (
      !stored ||
      stored.sourceMasteryRevision !== mastery.revision ||
      stored.sourceMasteryRuleVersion !== mastery.ruleVersion ||
      stored.ruleVersion !== RETENTION_RULE_VERSION ||
      (stored.nextEvaluationAt !== null &&
        asOf.getTime() >= stored.nextEvaluationAt.getTime())
    );
  });

  const evidence = refreshTargets.length > 0
    ? await loadLectureRetentionMemoryEvidence(
        client,
        userId,
        refreshTargets.map(({ row }) => row.lectureId),
        asOf,
      )
    : [];
  const evidenceByLecture = new Map(
    evidence.map((item) => [item.lectureId, item]),
  );
  const results: LectureRetentionRefreshResult[] = [];

  for (const mastery of masteryResults) {
    const existing = storedByLecture.get(mastery.row.lectureId) ?? null;
    const refreshRequired = refreshTargets.some(
      ({ row }) => row.lectureId === mastery.row.lectureId,
    );
    if (!refreshRequired && existing) {
      results.push({
        evaluation: null,
        row: existing,
        changed: false,
        mastery,
      });
      continue;
    }

    const memoryEvidence = evidenceByLecture.get(mastery.row.lectureId);
    if (!memoryEvidence) {
      throw new Error("Retention evidence loader omitted a requested lecture.");
    }
    const evaluation = evaluateLectureRetention({
      mastery: mastery.row,
      memoryEvidence,
      asOf,
    });
    const projection = await writeLectureRetentionProjection(
      client,
      evaluation,
      asOf,
      existing,
    );
    results.push({
      evaluation,
      ...projection,
      mastery,
    });
  }
  return results;
}

function validateBatch(userId: string, lectureIds: readonly string[]): void {
  if (typeof userId !== "string" || userId.length === 0) {
    throw new LectureMasteryError(
      "INVALID_INPUT",
      "Retention user ID must be nonempty.",
    );
  }
  if (!Array.isArray(lectureIds) || lectureIds.length > RETENTION_MAX_REFRESH_LECTURES) {
    throw new LectureMasteryError(
      "INVALID_INPUT",
      `A Retention batch can contain at most ${RETENTION_MAX_REFRESH_LECTURES} lecture IDs.`,
    );
  }
  if (lectureIds.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new LectureMasteryError(
      "INVALID_INPUT",
      "Retention lecture IDs must be nonempty strings.",
    );
  }
}

function validateIdentity(userId: string, lectureId: string): void {
  validateBatch(userId, [lectureId]);
}

function captureAsOf(value?: Date): Date {
  const asOf = value ? new Date(value.getTime()) : new Date();
  if (!Number.isFinite(asOf.getTime())) {
    throw new LectureMasteryError(
      "INVALID_INPUT",
      "Retention asOf timestamp is invalid.",
    );
  }
  return asOf;
}