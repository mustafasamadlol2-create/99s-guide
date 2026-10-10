import type { Prisma } from "@prisma/client";
import { INTEGRITY_ACTION_TYPES } from "../../study-integrity/constants.js";

export type VerifiedLearningActivity = {
  userId: string;
  sourceId: string;
  effectiveAt: Date;
  evidenceClass: string;
  source: "backend";
  actionType: string;
  resource: { kind: "mcq" | "flashcard"; id: string };
};

export type LearningActivityLoadResult =
  | { source: VerifiedLearningActivity }
  | { reason: "NOT_ELIGIBLE" | "INSUFFICIENT_EVIDENCE" };

type StudyEventReader = {
  studyEvent: {
    findFirst(args: unknown): Promise<{
      id: string;
      source: string;
      evidenceClass: string;
      occurredAt: Date;
      payload: unknown;
    } | null>;
  };
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function loadVerifiedEvent(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    sourceId: string;
    kind: "mcq" | "flashcard";
    eventType: "mcq_attempted" | "flashcard_reviewed";
    actionType: string;
  },
): Promise<LearningActivityLoadResult> {
  const field = input.kind === "mcq" ? "mcqId" : "flashcardId";
  const event = await (tx as unknown as StudyEventReader).studyEvent.findFirst({
    where: {
      userId: input.userId,
      [field]: input.sourceId,
      eventType: input.eventType,
      source: "backend",
      evidenceClass: "SERVER_VALIDATED",
      OR: input.kind === "mcq"
        ? [{ payload: { path: ["correct"], equals: true } }]
        : [
            { payload: { path: ["quality"], equals: "GOOD" } },
            { payload: { path: ["quality"], equals: "EASY" } },
          ],
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      source: true,
      evidenceClass: true,
      occurredAt: true,
      payload: true,
    },
  });
  if (!event) return { reason: "NOT_ELIGIBLE" };
  const payload = isObject(event.payload) ? event.payload : null;
  const eligible = input.kind === "mcq"
    ? payload?.correct === true
    : payload?.quality === "GOOD" || payload?.quality === "EASY";
  if (
    !eligible
    || event.source !== "backend"
    || event.evidenceClass !== "SERVER_VALIDATED"
    || !(event.occurredAt instanceof Date)
    || !Number.isFinite(event.occurredAt.getTime())
  ) {
    return { reason: "INSUFFICIENT_EVIDENCE" };
  }
  return {
    source: {
      userId: input.userId,
      sourceId: input.sourceId,
      effectiveAt: event.occurredAt,
      evidenceClass: event.evidenceClass,
      source: "backend",
      actionType: input.actionType,
      resource: { kind: input.kind, id: input.sourceId },
    },
  };
}

export function loadFirstCorrectMcqSource(
  tx: Prisma.TransactionClient,
  userId: string,
  mcqId: string,
): Promise<LearningActivityLoadResult> {
  return loadVerifiedEvent(tx, {
    userId,
    sourceId: mcqId,
    kind: "mcq",
    eventType: "mcq_attempted",
    actionType: INTEGRITY_ACTION_TYPES.MCQ_ANSWER,
  });
}

export function loadFirstRecalledFlashcardSource(
  tx: Prisma.TransactionClient,
  userId: string,
  flashcardId: string,
): Promise<LearningActivityLoadResult> {
  return loadVerifiedEvent(tx, {
    userId,
    sourceId: flashcardId,
    kind: "flashcard",
    eventType: "flashcard_reviewed",
    actionType: INTEGRITY_ACTION_TYPES.FLASHCARD_REVIEW,
  });
}
