import { Prisma } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { MASTERY_RULE_VERSION } from "./constants.js";
import { loadLectureMasteryEvidence, type MasteryQueryClient } from "./evidence.js";
import { LectureMasteryError } from "./errors.js";
import {
  findLectureMastery,
  writeLectureMasteryProjection,
  type LectureMasteryProjection,
  type MasteryRepositoryClient,
} from "./repository.js";
import { evaluateLectureMasteryEvidence } from "./evaluator.js";
import type { LectureMasteryEvaluation } from "./types.js";

export type LectureMasteryInput = {
  userId: string;
  lectureId: string;
  asOf?: Date;
  tx?: MasteryQueryClient;
};

export type LectureMasteryRefreshResult = {
  evaluation: LectureMasteryEvaluation;
  row: LectureMasteryProjection;
  changed: boolean;
};

export async function evaluateLectureMastery(
  input: LectureMasteryInput,
): Promise<LectureMasteryEvaluation> {
  const asOf = captureAsOf(input.asOf);
  if (input.tx) {
    return evaluateWithClient(
      input.tx,
      input.userId,
      input.lectureId,
      asOf,
    );
  }

  const database = getPrisma();
  return database.$transaction(
    (tx) => evaluateWithClient(tx, input.userId, input.lectureId, asOf),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 15_000,
    },
  );
}

export async function refreshLectureMastery(
  input: LectureMasteryInput,
): Promise<LectureMasteryRefreshResult> {
  const asOf = captureAsOf(input.asOf);
  if (input.tx) {
    return refreshWithClient(
      input.tx,
      input.userId,
      input.lectureId,
      asOf,
    );
  }

  const database = getPrisma();
  return database.$transaction(
    (tx) => refreshWithClient(tx, input.userId, input.lectureId, asOf),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 15_000,
    },
  );
}

export async function refreshUserLectureMastery(input: {
  userId: string;
  lectureIds: readonly string[];
  asOf?: Date;
  tx?: MasteryQueryClient;
}): Promise<LectureMasteryRefreshResult[]> {
  if (!Array.isArray(input.lectureIds) || input.lectureIds.length > 100) {
    throw new LectureMasteryError(
      "INVALID_INPUT",
      "A Mastery batch can contain at most 100 lecture IDs.",
    );
  }
  const lectureIds = [...new Set(input.lectureIds)];
  if (lectureIds.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new LectureMasteryError("INVALID_INPUT", "Lecture IDs must be nonempty strings.");
  }
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
      timeout: 15_000,
    },
  );
}

export async function getMyLectureMastery(input: {
  userId: string;
  lectureId: string;
}): Promise<{
  lectureId: string;
  state: LectureMasteryEvaluation["state"];
  ruleVersion: string;
  lastEvaluatedAt: string;
  evidence: {
    objectiveAttempts: number;
    objectiveCorrect: number;
    objectiveAccuracyPercent: number | null;
    flashcardReviews: number;
    meaningfulFocusSeconds: number;
    recallObjectiveAttempts: number;
  };
}> {
  const database = getPrisma();
  const lecture = await database.lecture.findUnique({
    where: { id: input.lectureId },
    select: { id: true },
  });
  if (!lecture) {
    throw new LectureMasteryError("LECTURE_NOT_FOUND", "Lecture not found.");
  }

  const result = await refreshLectureMastery(input);
  return {
    lectureId: result.row.lectureId,
    state: result.row.state,
    ruleVersion: result.row.ruleVersion,
    lastEvaluatedAt: result.row.lastEvaluatedAt.toISOString(),
    evidence: {
      objectiveAttempts: result.row.objectiveAttemptCount,
      objectiveCorrect: result.row.objectiveCorrectCount,
      objectiveAccuracyPercent: result.evaluation.objectiveAccuracyPercent,
      flashcardReviews: result.row.flashcardReviewCount,
      meaningfulFocusSeconds: result.row.meaningfulFocusSeconds,
      recallObjectiveAttempts: result.row.recallObjectiveAttemptCount,
    },
  };
}

async function evaluateWithClient(
  client: MasteryQueryClient,
  userId: string,
  lectureId: string,
  asOf: Date,
): Promise<LectureMasteryEvaluation> {
  const [evidence] = await loadLectureMasteryEvidence(
    client,
    userId,
    [lectureId],
    asOf,
  );
  if (!evidence) {
    throw new Error("Mastery evidence loader omitted the requested lecture.");
  }
  return evaluateLectureMasteryEvidence(evidence);
}

async function refreshWithClient(
  client: MasteryRepositoryClient,
  userId: string,
  lectureId: string,
  asOf: Date,
): Promise<LectureMasteryRefreshResult> {
  const evaluation = await evaluateWithClient(client, userId, lectureId, asOf);
  const projection = await writeLectureMasteryProjection(client, evaluation, asOf);
  return { evaluation, ...projection };
}

async function refreshBatchWithClient(
  client: MasteryRepositoryClient,
  userId: string,
  lectureIds: readonly string[],
  asOf: Date,
): Promise<LectureMasteryRefreshResult[]> {
  const evidence = await loadLectureMasteryEvidence(
    client,
    userId,
    lectureIds,
    asOf,
  );
  const results: LectureMasteryRefreshResult[] = [];
  for (const item of evidence) {
    const evaluation = evaluateLectureMasteryEvidence(item);
    const projection = await writeLectureMasteryProjection(
      client,
      evaluation,
      asOf,
    );
    results.push({ evaluation, ...projection });
  }
  return results;
}

export async function readStoredLectureMastery(
  userId: string,
  lectureId: string,
  client: MasteryRepositoryClient = getPrisma(),
): Promise<LectureMasteryProjection | null> {
  return findLectureMastery(client, userId, lectureId);
}

export function activeMasteryRuleVersion(): string {
  return MASTERY_RULE_VERSION;
}

function captureAsOf(value?: Date): Date {
  const asOf = value ? new Date(value.getTime()) : new Date();
  if (!Number.isFinite(asOf.getTime())) {
    throw new LectureMasteryError("INVALID_INPUT", "Mastery asOf timestamp is invalid.");
  }
  return asOf;
}