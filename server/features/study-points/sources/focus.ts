import type { Prisma } from "@prisma/client";
import { INTEGRITY_ACTION_TYPES } from "../../study-integrity/constants.js";
import type { StudyEventSource } from "../../study-core/events.js";

export type VerifiedFocusSource = {
  userId: string;
  sourceId: string;
  effectiveAt: Date;
  evidenceClass: string;
  source: StudyEventSource;
  activeSeconds: number;
  actionType: string;
  resource: { kind: "focus_session"; id: string };
};

export type FocusSourceLoadResult =
  | { source: VerifiedFocusSource }
  | { reason: "NOT_ELIGIBLE" | "INSUFFICIENT_EVIDENCE" | "BELOW_MINIMUM" };

export async function loadCompletedFocusSource(
  tx: Prisma.TransactionClient,
  userId: string,
  sourceId: string,
): Promise<FocusSourceLoadResult> {
  const session = await tx.focusSession.findFirst({
    where: { id: sourceId, userId },
    select: {
      id: true,
      userId: true,
      status: true,
      activeSeconds: true,
      actualEndedAt: true,
    },
  });
  if (
    !session
    || session.status !== "COMPLETED"
    || !session.actualEndedAt
    || !Number.isSafeInteger(session.activeSeconds)
    || session.activeSeconds < 0
  ) {
    return { reason: "NOT_ELIGIBLE" };
  }

  const event = await tx.studyEvent.findFirst({
    where: {
      userId,
      focusSessionId: session.id,
      eventType: "focus_session_completed",
      source: "backend",
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: {
      source: true,
      evidenceClass: true,
      occurredAt: true,
      payload: true,
    },
  });
  const eventActiveSeconds = event?.payload
    && typeof event.payload === "object"
    && !Array.isArray(event.payload)
    && "activeSeconds" in event.payload
    ? event.payload.activeSeconds
    : undefined;
  if (
    !event
    || event.occurredAt.getTime() !== session.actualEndedAt.getTime()
    || eventActiveSeconds !== session.activeSeconds
  ) {
    return { reason: "INSUFFICIENT_EVIDENCE" };
  }
  return {
    source: {
      userId,
      sourceId: session.id,
      effectiveAt: event.occurredAt,
      evidenceClass: event.evidenceClass,
      source: event.source as StudyEventSource,
      activeSeconds: session.activeSeconds,
      actionType: INTEGRITY_ACTION_TYPES.FOCUS_SESSION_COMPLETE,
      resource: { kind: "focus_session", id: session.id },
    },
  };
}