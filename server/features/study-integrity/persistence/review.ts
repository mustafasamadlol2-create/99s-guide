import {
  Prisma,
  type IntegritySignal as DbIntegritySignal,
  type PrismaClient,
} from "@prisma/client";
import { getPrisma } from "../../../services/prismaClient.js";
import { toIntegrityReviewActionDto, toIntegritySignalDto } from "./dto.js";
import { lockIntegritySignalDedupKey } from "./locks.js";
import {
  StudyIntegrityPersistenceError,
  type IntegrityReviewInput,
  type IntegrityReviewResult,
  type IntegrityReviewActionType,
  type IntegritySignalStatus,
} from "./types.js";

const MAX_POSTGRES_INT = 2_147_483_647;
const STATUS_FOR_ACTION: Record<
  Exclude<IntegrityReviewActionType, "ADD_NOTE">,
  IntegritySignalStatus
> = {
  ACKNOWLEDGE: "ACKNOWLEDGED",
  RESOLVE: "RESOLVED",
  DISMISS: "DISMISSED",
  REOPEN: "OPEN",
};

const ALLOWED_TRANSITIONS: Record<
  IntegritySignalStatus,
  readonly IntegritySignalStatus[]
> = {
  OPEN: ["ACKNOWLEDGED", "RESOLVED", "DISMISSED"],
  ACKNOWLEDGED: ["OPEN", "RESOLVED", "DISMISSED"],
  RESOLVED: ["OPEN"],
  DISMISSED: ["OPEN"],
};

function validateNote(input: IntegrityReviewInput): string | null {
  if (input.note === undefined) {
    if (input.action === "ADD_NOTE") {
      throw new StudyIntegrityPersistenceError(
        "INVALID_INPUT",
        "ADD_NOTE requires a non-empty internal note.",
      );
    }
    return null;
  }
  if (
    typeof input.note !== "string"
    || Array.from(input.note).length > 1000
    || /<\/?[A-Za-z][^>]*>/u.test(input.note)
  ) {
    throw new StudyIntegrityPersistenceError(
      "INVALID_INPUT",
      "Review note must be plain text of at most 1000 Unicode characters.",
    );
  }
  const note = input.note.trim();
  if (!note) {
    if (input.action === "ADD_NOTE") {
      throw new StudyIntegrityPersistenceError(
        "INVALID_INPUT",
        "ADD_NOTE requires a non-empty internal note.",
      );
    }
    return null;
  }
  return note;
}

function validateReviewInput(input: IntegrityReviewInput): string | null {
  if (
    typeof input.signalId !== "string"
    || input.signalId.length < 1
    || input.signalId.length > 128
    || typeof input.reviewerUserId !== "string"
    || input.reviewerUserId.length < 1
    || input.reviewerUserId.length > 128
    || !Number.isSafeInteger(input.expectedReviewVersion)
    || input.expectedReviewVersion < 0
    || input.expectedReviewVersion >= MAX_POSTGRES_INT
    || !["ACKNOWLEDGE", "RESOLVE", "DISMISS", "REOPEN", "ADD_NOTE"].includes(input.action)
  ) {
    throw new StudyIntegrityPersistenceError(
      "INVALID_INPUT",
      "Review request fields are invalid.",
    );
  }
  return validateNote(input);
}

export class IntegrityReviewService {
  constructor(
    private readonly database: PrismaClient = getPrisma() as PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reviewSignal(input: IntegrityReviewInput): Promise<IntegrityReviewResult> {
    const note = validateReviewInput(input);
    return this.database.$transaction(async (tx) => {
      const identity = await tx.integritySignal.findUnique({
        where: { id: input.signalId },
        select: {
          userId: true,
          signalFingerprint: true,
          dedupBucket: true,
        },
      });
      if (!identity) {
        throw new StudyIntegrityPersistenceError(
          "SIGNAL_NOT_FOUND",
          "Integrity signal was not found.",
        );
      }

      // Recording and review take the same lock before touching a signal. That
      // ordering prevents a repeat occurrence from reopening finalized history.
      await lockIntegritySignalDedupKey(tx, identity);
      const locked = await tx.$queryRaw<DbIntegritySignal[]>(Prisma.sql`
        SELECT *
        FROM "IntegritySignal"
        WHERE "id" = ${input.signalId}
        FOR UPDATE
      `);
      const current = locked[0];
      if (!current) {
        throw new StudyIntegrityPersistenceError(
          "SIGNAL_NOT_FOUND",
          "Integrity signal was not found.",
        );
      }

      if (current.reviewVersion !== input.expectedReviewVersion) {
        throw new StudyIntegrityPersistenceError(
          "REVIEW_VERSION_CONFLICT",
          "Integrity signal changed after it was loaded. Refresh before reviewing.",
        );
      }

      const fromStatus = current.status as IntegritySignalStatus;
      const toStatus = input.action === "ADD_NOTE"
        ? fromStatus
        : STATUS_FOR_ACTION[input.action];
      if (
        input.action !== "ADD_NOTE"
        && !ALLOWED_TRANSITIONS[fromStatus]?.includes(toStatus)
      ) {
        throw new StudyIntegrityPersistenceError(
          "INVALID_TRANSITION",
          `The ${input.action} review action is not allowed from ${fromStatus}.`,
        );
      }

      const now = this.now();
      if (!(now instanceof Date) || !Number.isSafeInteger(now.getTime()) || now.getTime() < 0) {
        throw new StudyIntegrityPersistenceError(
          "INVALID_INPUT",
          "Review server time is invalid.",
        );
      }
      const resolvedAt = toStatus === "RESOLVED" || toStatus === "DISMISSED"
        ? now
        : toStatus === "OPEN"
          ? null
          : current.resolvedAt;

      const updated = await tx.integritySignal.update({
        where: { id: input.signalId },
        data: {
          status: toStatus,
          reviewVersion: { increment: 1 },
          resolvedAt,
          updatedAt: now,
        },
      });
      const reviewAction = await tx.integrityReviewAction.create({
        data: {
          signalId: current.id,
          reviewerUserId: input.reviewerUserId,
          fromStatus,
          toStatus,
          actionType: input.action,
          note,
          createdAt: now,
        },
      });

      return {
        signal: toIntegritySignalDto(updated),
        reviewAction: toIntegrityReviewActionDto(reviewAction),
      };
    }, { maxWait: 5_000, timeout: 15_000 });
  }
}