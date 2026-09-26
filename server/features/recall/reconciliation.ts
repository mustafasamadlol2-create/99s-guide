import type { PrismaClient, RecallItemState } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import type { RecallItemType } from "./constants.js";
import { RecallError } from "./errors.js";
import {
  createRecallItemState,
  lockRecallItemState,
  lockRecallScope,
  readRecallItemHistory,
} from "./repository.js";
import { deriveRecallItemState } from "./stateReducer.js";
import type {
  DerivedRecallItemState,
  RecallTransaction,
} from "./types.js";

export type RecallStateMismatchCode =
  | "STATE_WITHOUT_ATTEMPTS"
  | "MISSING_STATE"
  | "COUNTER_MISMATCH"
  | "TIMESTAMP_MISMATCH"
  | "OUTCOME_MISMATCH"
  | "LECTURE_MISMATCH"
  | "REVISION_MISMATCH";

export interface ReconcileRecallItemStateInput {
  userId: string;
  itemType: RecallItemType;
  itemId: string;
  repair?: boolean;
}

export interface ReconcileRecallItemStateResult {
  matches: boolean;
  repaired: boolean;
  historyCount: number;
  mismatches: RecallStateMismatchCode[];
}

export async function reconcileRecallItemState(
  input: ReconcileRecallItemStateInput,
  database: PrismaClient = getPrisma(),
): Promise<ReconcileRecallItemStateResult> {
  validateInput(input);
  return database.$transaction(
    (tx) => reconcileInTransaction(tx, input),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 15_000,
    },
  );
}

export async function reconcileRecallItemStateInTransaction(
  tx: RecallTransaction,
  input: ReconcileRecallItemStateInput,
): Promise<ReconcileRecallItemStateResult> {
  validateInput(input);
  return reconcileInTransaction(tx, input);
}

async function reconcileInTransaction(
  tx: RecallTransaction,
  input: ReconcileRecallItemStateInput,
): Promise<ReconcileRecallItemStateResult> {
  await lockRecallScope(tx, "item", [
    input.userId,
    input.itemType,
    input.itemId,
  ]);
  const history = await readRecallItemHistory(
    tx,
    input.userId,
    input.itemType,
    input.itemId,
  );
  const expected = deriveRecallItemState(history);
  const actual = await lockRecallItemState(
    tx,
    input.userId,
    input.itemType,
    input.itemId,
  );
  const mismatches = compareState(expected, actual);

  if (!input.repair || mismatches.length === 0) {
    return {
      matches: mismatches.length === 0,
      repaired: false,
      historyCount: history.length,
      mismatches,
    };
  }

  if (!expected) {
    if (actual) {
      await tx.recallItemState.delete({ where: { id: actual.id } });
    }
    return {
      matches: true,
      repaired: true,
      historyCount: 0,
      mismatches,
    };
  }

  if (!actual) {
    await createRecallItemState(
      tx,
      input.userId,
      input.itemType,
      input.itemId,
      expected,
    );
  } else {
    await tx.recallItemState.update({
      where: { id: actual.id },
      data: toStateUpdate(expected),
    });
  }
  return {
    matches: true,
    repaired: true,
    historyCount: history.length,
    mismatches,
  };
}

function compareState(
  expected: DerivedRecallItemState | null,
  actual: RecallItemState | null,
): RecallStateMismatchCode[] {
  if (!expected) return actual ? ["STATE_WITHOUT_ATTEMPTS"] : [];
  if (!actual) return ["MISSING_STATE"];

  const mismatches = new Set<RecallStateMismatchCode>();
  const counterFields = [
    "presentationCount",
    "answerCount",
    "skipCount",
    "objectiveCorrectCount",
    "objectiveIncorrectCount",
    "selfReportedHardCount",
    "selfReportedMediumCount",
    "selfReportedEasyCount",
  ] as const;
  for (const field of counterFields) {
    if (actual[field] !== expected[field]) mismatches.add("COUNTER_MISMATCH");
  }
  if (actual.revision !== expected.revision) {
    mismatches.add("REVISION_MISMATCH");
  }
  for (const field of [
    "lastPresentedAt",
    "lastAnsweredAt",
    "lastSkippedAt",
  ] as const) {
    if (!sameDate(actual[field], expected[field])) {
      mismatches.add("TIMESTAMP_MISMATCH");
    }
  }
  if (actual.lastOutcome !== expected.lastOutcome) {
    mismatches.add("OUTCOME_MISMATCH");
  }
  if (actual.lectureId !== expected.lectureId) {
    mismatches.add("LECTURE_MISMATCH");
  }
  return [...mismatches];
}

function toStateUpdate(
  value: DerivedRecallItemState,
): Prisma.RecallItemStateUpdateInput {
  return {
    lectureId: value.lectureId,
    presentationCount: value.presentationCount,
    answerCount: value.answerCount,
    skipCount: value.skipCount,
    objectiveCorrectCount: value.objectiveCorrectCount,
    objectiveIncorrectCount: value.objectiveIncorrectCount,
    selfReportedHardCount: value.selfReportedHardCount,
    selfReportedMediumCount: value.selfReportedMediumCount,
    selfReportedEasyCount: value.selfReportedEasyCount,
    lastPresentedAt: value.lastPresentedAt,
    lastAnsweredAt: value.lastAnsweredAt,
    lastSkippedAt: value.lastSkippedAt,
    lastOutcome: value.lastOutcome,
    revision: value.revision,
  };
}

function sameDate(left: Date | null, right: Date | null): boolean {
  return left === null
    ? right === null
    : right !== null && left.getTime() === right.getTime();
}

function validateInput(input: ReconcileRecallItemStateInput): void {
  if (
    !input ||
    typeof input.userId !== "string" ||
    input.userId.length === 0 ||
    typeof input.itemId !== "string" ||
    input.itemId.length === 0 ||
    (input.itemType !== "MCQ" && input.itemType !== "FLASHCARD")
  ) {
    throw new RecallError(
      "INVALID_RECALL_INPUT",
      "Invalid Recall state reconciliation identity.",
    );
  }
}