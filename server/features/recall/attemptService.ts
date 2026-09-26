import {
  Prisma,
  type PrismaClient,
  type RecallAttempt,
  type RecallItemState,
} from "@prisma/client";
import type { EvidenceClass } from "../study-core/evidence.js";
import { getPrisma } from "../../services/prismaClient.js";
import {
  RECALL_FLASHCARD_RATINGS,
  RECALL_ITEM_TYPES,
  RECALL_MCQ_OPTIONS,
  RECALL_PRIVACY_CLASS,
  outcomeForFlashcardRating,
} from "./constants.js";
import type {
  RecallAnswerOutcome,
  RecallAttemptStatus,
  RecallItemType,
} from "./constants.js";
import { RecallError } from "./errors.js";
import { recallIssuanceFingerprint } from "./fingerprint.js";
import {
  createRecallItemState,
  lockRecallAttempt,
  lockRecallItemState,
  lockRecallScope,
  readRecallItemHistory,
} from "./repository.js";
import { loadCanonicalRecallSource } from "./sourceAdapters.js";
import { deriveRecallItemState } from "./stateReducer.js";
import type {
  IssueRecallAttemptInput,
  PublicRecallTransition,
  RecallAttemptAnswer,
  RecallAttemptService,
  RecallTransaction,
} from "./types.js";

const MAX_DATABASE_INT = 2_147_483_647;

export interface RecallAttemptServiceOptions {
  database?: PrismaClient;
  now?: () => Date;
}

export function createRecallAttemptService(
  options: RecallAttemptServiceOptions = {},
): RecallAttemptService {
  const database = options.database ?? getPrisma();
  const now = options.now ?? (() => new Date());

  return {
    async issue(input) {
      validateIssueInput(input);
      return withTransaction(database, input.tx, (tx) =>
        issueInTransaction(tx, input, now),
      );
    },
    async answer(userId, attemptId, answer) {
      validatePathIdentity(userId, attemptId);
      validateAnswer(answer);
      return withTransaction(database, undefined, async (tx) => {
        const attempt = await lockOwnedAttempt(tx, userId, attemptId);
        if (attempt.status === "ANSWERED") {
          if (!sameAnswer(attempt, answer)) {
            throw new RecallError(
              "RECALL_ATTEMPT_FINALIZED",
              "This Recall attempt was already answered differently.",
            );
          }
          return publicTransition(attempt, true);
        }
        if (attempt.status !== "PRESENTED") {
          throw new RecallError(
            "RECALL_ATTEMPT_FINALIZED",
            "This Recall attempt is already terminal.",
          );
        }

        const operationTime = validNow(now);
        assertNotBeforePresentation(attempt, operationTime);
        if (hasExpired(attempt, operationTime)) {
          return expireLockedAttempt(tx, attempt, operationTime, false);
        }

        const expectedKind =
          attempt.itemType === "MCQ"
            ? "MCQ_OPTION"
            : "FLASHCARD_RECALL_RATING";
        if (answer.kind !== expectedKind) {
          throw new RecallError(
            "RECALL_ANSWER_KIND_MISMATCH",
            "The answer type does not match the Recall item.",
          );
        }

        const source = await loadCanonicalRecallSource(
          tx,
          attempt.itemType as RecallItemType,
          attempt.itemId,
        );
        if (source.lectureId !== attempt.lectureId) {
          throw new RecallError(
            "RECALL_SOURCE_CHANGED",
            "The Recall item no longer matches its issued lecture context.",
          );
        }

        const outcome =
          answer.kind === "MCQ_OPTION"
            ? answer.value === source.correctAnswer
              ? "CORRECT"
              : "INCORRECT"
            : outcomeForFlashcardRating(answer.value);
        const evidenceClass: EvidenceClass =
          answer.kind === "MCQ_OPTION" ? "SERVER_DERIVED" : "CLIENT_OBSERVED";
        const updated = await tx.recallAttempt.update({
          where: { id: attempt.id },
          data: {
            status: "ANSWERED",
            answeredAt: operationTime,
            answerKind: answer.kind,
            answerValue: answer.value,
            outcome,
            evidenceClass,
          },
        });
        await applyTerminalState(
          tx,
          updated,
          "ANSWERED",
          outcome,
          operationTime,
        );
        return publicTransition(updated, false);
      });
    },
    async skip(userId, attemptId) {
      validatePathIdentity(userId, attemptId);
      return withTransaction(database, undefined, async (tx) => {
        const attempt = await lockOwnedAttempt(tx, userId, attemptId);
        if (attempt.status === "SKIPPED") return publicTransition(attempt, true);
        if (attempt.status !== "PRESENTED") {
          throw new RecallError(
            "RECALL_ATTEMPT_FINALIZED",
            "This Recall attempt is already terminal.",
          );
        }
        const operationTime = validNow(now);
        assertNotBeforePresentation(attempt, operationTime);
        if (hasExpired(attempt, operationTime)) {
          return expireLockedAttempt(tx, attempt, operationTime, false);
        }

        const updated = await tx.recallAttempt.update({
          where: { id: attempt.id },
          data: {
            status: "SKIPPED",
            skippedAt: operationTime,
            answerKind: null,
            answerValue: null,
            outcome: null,
            evidenceClass: "SERVER_VALIDATED",
          },
        });
        await applyTerminalState(
          tx,
          updated,
          "SKIPPED",
          "SKIPPED",
          operationTime,
        );
        return publicTransition(updated, false);
      });
    },
    async expire(userId, attemptId) {
      validatePathIdentity(userId, attemptId);
      return withTransaction(database, undefined, async (tx) => {
        const attempt = await lockOwnedAttempt(tx, userId, attemptId);
        if (attempt.status === "EXPIRED") return publicTransition(attempt, true);
        if (attempt.status !== "PRESENTED") {
          throw new RecallError(
            "RECALL_ATTEMPT_FINALIZED",
            "This Recall attempt is already terminal.",
          );
        }
        const operationTime = validNow(now);
        assertNotBeforePresentation(attempt, operationTime);
        if (!hasExpired(attempt, operationTime)) {
          throw new RecallError(
            "INVALID_RECALL_INPUT",
            "Recall attempt has not reached its expiry time.",
          );
        }
        return expireLockedAttempt(tx, attempt, operationTime, false);
      });
    },
  };
}

async function issueInTransaction(
  tx: RecallTransaction,
  input: IssueRecallAttemptInput,
  now: () => Date,
): Promise<RecallAttempt> {
  await lockRecallScope(tx, "issuance", [
    input.userId,
    input.issuanceIdempotencyKey,
  ]);

  const existing = await tx.recallAttempt.findUnique({
    where: {
      userId_issuanceIdempotencyKey: {
        userId: input.userId,
        issuanceIdempotencyKey: input.issuanceIdempotencyKey,
      },
    },
  });
  if (existing) {
    const requestedLectureId = input.lectureId ?? existing.lectureId;
    const expectedFingerprint = recallIssuanceFingerprint({
      userId: input.userId,
      itemType: input.itemType,
      itemId: input.itemId,
      lectureId: requestedLectureId,
      issuanceIdempotencyKey: input.issuanceIdempotencyKey,
      presentedAt: input.presentedAt,
      expiresAt: input.expiresAt,
    });
    if (
      requestedLectureId !== existing.lectureId ||
      expectedFingerprint !== existing.issuanceFingerprint
    ) {
      throw new RecallError(
        "RECALL_ISSUANCE_CONFLICT",
        "The issuance key was already used for different Recall input.",
      );
    }
    return existing;
  }

  await lockRecallScope(tx, "item", [
    input.userId,
    input.itemType,
    input.itemId,
  ]);
  const source = await loadCanonicalRecallSource(tx, input.itemType, input.itemId);
  if (input.lectureId && input.lectureId !== source.lectureId) {
    throw new RecallError(
      "RECALL_SOURCE_CHANGED",
      "The requested lecture does not match the canonical Recall item.",
    );
  }
  const user = await tx.user.findUnique({
    where: { id: input.userId },
    select: { id: true },
  });
  if (!user) {
    throw new RecallError("RECALL_USER_NOT_FOUND", "Recall user not found.");
  }

  const presentedAt = input.presentedAt ?? validNow(now);
  const expiresAt = input.expiresAt ?? null;
  const attempt = await tx.recallAttempt.create({
    data: {
      userId: input.userId,
      itemType: source.itemType,
      itemId: source.itemId,
      lectureId: source.lectureId,
      status: "PRESENTED",
      presentedAt,
      expiresAt,
      evidenceClass: "SERVER_VALIDATED",
      privacyClass: RECALL_PRIVACY_CLASS,
      issuanceIdempotencyKey: input.issuanceIdempotencyKey,
      issuanceFingerprint: recallIssuanceFingerprint({
        userId: input.userId,
        itemType: source.itemType,
        itemId: source.itemId,
        lectureId: source.lectureId,
        issuanceIdempotencyKey: input.issuanceIdempotencyKey,
        presentedAt: input.presentedAt,
        expiresAt,
      }),
    },
  });
  await applyPresentationState(tx, attempt);
  return attempt;
}

async function applyPresentationState(
  tx: RecallTransaction,
  attempt: RecallAttempt,
): Promise<void> {
  const state = await lockRecallItemState(
    tx,
    attempt.userId,
    attempt.itemType as RecallItemType,
    attempt.itemId,
  );
  if (!state) {
    const history = await readRecallItemHistory(
      tx,
      attempt.userId,
      attempt.itemType as RecallItemType,
      attempt.itemId,
    );
    const derived = deriveRecallItemState(history);
    if (!derived) {
      throw new RecallError(
        "RECALL_STATE_CORRUPT",
        "Recall state could not be rebuilt after issuance.",
      );
    }
    await createRecallItemState(
      tx,
      attempt.userId,
      attempt.itemType as RecallItemType,
      attempt.itemId,
      derived,
    );
    return;
  }

  assertCanIncrement(state, ["presentationCount", "revision"]);
  const latest = await tx.recallAttempt.findFirst({
    where: {
      userId: attempt.userId,
      itemType: attempt.itemType,
      itemId: attempt.itemId,
    },
    orderBy: [{ presentedAt: "desc" }, { id: "desc" }],
    select: { lectureId: true, presentedAt: true },
  });
  if (!latest) {
    throw new RecallError(
      "RECALL_STATE_CORRUPT",
      "Issued Recall attempt disappeared within its transaction.",
    );
  }
  await tx.recallItemState.update({
    where: { id: state.id },
    data: {
      presentationCount: { increment: 1 },
      revision: { increment: 1 },
      lectureId: latest.lectureId,
      lastPresentedAt: latest.presentedAt,
    },
  });
}

async function applyTerminalState(
  tx: RecallTransaction,
  attempt: RecallAttempt,
  status: Extract<RecallAttemptStatus, "ANSWERED" | "SKIPPED" | "EXPIRED">,
  outcome: RecallAnswerOutcome | "SKIPPED" | "EXPIRED",
  at: Date,
): Promise<void> {
  const itemType = attempt.itemType as RecallItemType;
  const state = await lockRecallItemState(
    tx,
    attempt.userId,
    itemType,
    attempt.itemId,
  );
  if (!state) {
    const history = await readRecallItemHistory(
      tx,
      attempt.userId,
      itemType,
      attempt.itemId,
    );
    const derived = deriveRecallItemState(history);
    if (!derived) {
      throw new RecallError(
        "RECALL_STATE_CORRUPT",
        "Recall state could not be rebuilt after a terminal transition.",
      );
    }
    await createRecallItemState(
      tx,
      attempt.userId,
      itemType,
      attempt.itemId,
      derived,
    );
    return;
  }

  const incrementFields: Array<keyof RecallItemState> = ["revision"];
  if (status === "ANSWERED") incrementFields.push("answerCount");
  if (status === "SKIPPED") incrementFields.push("skipCount");
  if (outcome === "CORRECT") incrementFields.push("objectiveCorrectCount");
  if (outcome === "INCORRECT") incrementFields.push("objectiveIncorrectCount");
  if (outcome === "SELF_REPORTED_HARD") incrementFields.push("selfReportedHardCount");
  if (outcome === "SELF_REPORTED_MEDIUM") incrementFields.push("selfReportedMediumCount");
  if (outcome === "SELF_REPORTED_EASY") incrementFields.push("selfReportedEasyCount");
  assertCanIncrement(state, incrementFields);

  const data: Prisma.RecallItemStateUpdateInput = {
    revision: { increment: 1 },
    lastOutcome: outcome,
  };
  if (status === "ANSWERED") {
    data.answerCount = { increment: 1 };
    data.lastAnsweredAt = laterDate(state.lastAnsweredAt, at);
  } else if (status === "SKIPPED") {
    data.skipCount = { increment: 1 };
    data.lastSkippedAt = laterDate(state.lastSkippedAt, at);
  }
  if (outcome === "CORRECT") {
    data.objectiveCorrectCount = { increment: 1 };
  } else if (outcome === "INCORRECT") {
    data.objectiveIncorrectCount = { increment: 1 };
  } else if (outcome === "SELF_REPORTED_HARD") {
    data.selfReportedHardCount = { increment: 1 };
  } else if (outcome === "SELF_REPORTED_MEDIUM") {
    data.selfReportedMediumCount = { increment: 1 };
  } else if (outcome === "SELF_REPORTED_EASY") {
    data.selfReportedEasyCount = { increment: 1 };
  }
  await tx.recallItemState.update({ where: { id: state.id }, data });
}

async function expireLockedAttempt(
  tx: RecallTransaction,
  attempt: RecallAttempt,
  at: Date,
  replayed: boolean,
): Promise<PublicRecallTransition> {
  const updated = await tx.recallAttempt.update({
    where: { id: attempt.id },
    data: {
      status: "EXPIRED",
      expiredAt: at,
      answerKind: null,
      answerValue: null,
      outcome: null,
      evidenceClass: "SERVER_VALIDATED",
    },
  });
  await applyTerminalState(tx, updated, "EXPIRED", "EXPIRED", at);
  return publicTransition(updated, replayed);
}

async function lockOwnedAttempt(
  tx: RecallTransaction,
  userId: string,
  attemptId: string,
): Promise<RecallAttempt> {
  const identity = await tx.recallAttempt.findFirst({
    where: { id: attemptId, userId },
    select: { itemType: true, itemId: true },
  });
  if (!identity) {
    throw new RecallError(
      "RECALL_ATTEMPT_NOT_FOUND",
      "Recall attempt not found.",
    );
  }
  await lockRecallScope(tx, "item", [userId, identity.itemType, identity.itemId]);
  const locked = await lockRecallAttempt(tx, userId, attemptId);
  if (!locked) {
    throw new RecallError(
      "RECALL_ATTEMPT_NOT_FOUND",
      "Recall attempt not found.",
    );
  }
  const attempt = await tx.recallAttempt.findFirst({
    where: { id: attemptId, userId },
  });
  if (!attempt) {
    throw new RecallError(
      "RECALL_ATTEMPT_NOT_FOUND",
      "Recall attempt not found.",
    );
  }
  return attempt;
}

async function withTransaction<T>(
  database: PrismaClient,
  tx: RecallTransaction | undefined,
  operation: (transaction: RecallTransaction) => Promise<T>,
): Promise<T> {
  if (tx) return operation(tx);
  return database.$transaction(operation, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5_000,
    timeout: 15_000,
  });
}

function validateIssueInput(input: IssueRecallAttemptInput): void {
  if (
    !input ||
    typeof input.userId !== "string" ||
    input.userId.length === 0 ||
    !RECALL_ITEM_TYPES.includes(input.itemType) ||
    typeof input.itemId !== "string" ||
    input.itemId.length === 0 ||
    input.itemId.length > 200 ||
    typeof input.issuanceIdempotencyKey !== "string" ||
    input.issuanceIdempotencyKey.length < 8 ||
    input.issuanceIdempotencyKey.length > 200 ||
    (input.lectureId !== undefined &&
      (typeof input.lectureId !== "string" || input.lectureId.length === 0)) ||
    (input.presentedAt !== undefined && !isValidDate(input.presentedAt)) ||
    (input.expiresAt !== undefined &&
      input.expiresAt !== null &&
      !isValidDate(input.expiresAt))
  ) {
    throw new RecallError("INVALID_RECALL_INPUT", "Invalid Recall issuance input.");
  }
}

function validatePathIdentity(userId: string, attemptId: string): void {
  if (
    typeof userId !== "string" ||
    userId.length === 0 ||
    typeof attemptId !== "string" ||
    attemptId.length === 0 ||
    attemptId.length > 200
  ) {
    throw new RecallError("INVALID_RECALL_INPUT", "Invalid Recall attempt identity.");
  }
}

function validateAnswer(answer: RecallAttemptAnswer): void {
  if (
    !answer ||
    (answer.kind === "MCQ_OPTION" &&
      RECALL_MCQ_OPTIONS.includes(answer.value)) ||
    (answer.kind === "FLASHCARD_RECALL_RATING" &&
      RECALL_FLASHCARD_RATINGS.includes(answer.value))
  ) {
    return;
  }
  throw new RecallError("INVALID_RECALL_INPUT", "Invalid Recall answer.");
}

function sameAnswer(
  attempt: RecallAttempt,
  answer: RecallAttemptAnswer,
): boolean {
  return (
    attempt.answerKind === answer.kind &&
    attempt.answerValue === answer.value
  );
}

function publicTransition(
  attempt: RecallAttempt,
  replayed: boolean,
): PublicRecallTransition {
  return {
    attemptId: attempt.id,
    status: attempt.status as RecallAttemptStatus,
    outcome: attempt.outcome as PublicRecallTransition["outcome"],
    evidenceClass: attempt.evidenceClass as EvidenceClass,
    replayed,
  };
}

function hasExpired(attempt: RecallAttempt, at: Date): boolean {
  return Boolean(attempt.expiresAt && attempt.expiresAt.getTime() <= at.getTime());
}

function assertNotBeforePresentation(attempt: RecallAttempt, at: Date): void {
  if (at.getTime() < attempt.presentedAt.getTime()) {
    throw new RecallError(
      "INVALID_RECALL_INPUT",
      "Recall server time precedes the attempt presentation.",
    );
  }
}

function validNow(now: () => Date): Date {
  const value = now();
  if (!isValidDate(value)) {
    throw new RecallError("INVALID_RECALL_INPUT", "Recall server clock is invalid.");
  }
  return value;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function laterDate(current: Date | null, candidate: Date): Date {
  return !current || candidate.getTime() > current.getTime() ? candidate : current;
}

function assertCanIncrement(
  state: RecallItemState,
  fields: readonly (keyof RecallItemState)[],
): void {
  for (const field of fields) {
    const current = state[field];
    if (
      typeof current !== "number" ||
      !Number.isSafeInteger(current) ||
      current < 0 ||
      current >= MAX_DATABASE_INT
    ) {
      throw new RecallError(
        "RECALL_COUNTER_OVERFLOW",
        `Recall state field ${String(field)} cannot be incremented safely.`,
      );
    }
  }
}
