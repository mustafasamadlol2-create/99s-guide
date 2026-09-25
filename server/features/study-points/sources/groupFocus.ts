import type { Prisma } from "@prisma/client";
import { INTEGRITY_ACTION_TYPES } from "../../study-integrity/constants.js";
import type { StudyEventSource } from "../../study-core/events.js";

export type VerifiedGroupFocusSource = {
  userId: string;
  sourceId: string;
  runId: string;
  summaryId: string;
  roomId: string;
  effectiveAt: Date;
  evidenceClass: string;
  source: StudyEventSource;
  verifiedFocusSeconds: number;
  runtimeStartedAt: Date;
  actionType: string;
  resource: { kind: "group_focus_room"; id: string };
};

export type GroupFocusSourceLoadResult =
  | { source: VerifiedGroupFocusSource }
  | { reason: "NOT_ELIGIBLE" | "INSUFFICIENT_EVIDENCE" | "BELOW_MINIMUM" };

export async function loadGroupFocusSource(
  tx: Prisma.TransactionClient,
  userId: string,
  runId: string,
): Promise<GroupFocusSourceLoadResult> {
  const participant = await tx.groupFocusParticipantSummary.findFirst({
    where: { userId, runId },
    select: {
      id: true,
      userId: true,
      runId: true,
      verifiedFocusSeconds: true,
      run: {
        select: {
          id: true,
          roomId: true,
          summaryId: true,
          runtimeStartedAt: true,
          runtimeEndedAt: true,
        },
      },
    },
  });
  if (!participant) return { reason: "NOT_ELIGIBLE" };
  if (
    !Number.isSafeInteger(participant.verifiedFocusSeconds)
    || participant.verifiedFocusSeconds < 0
  ) {
    return { reason: "NOT_ELIGIBLE" };
  }
  if (participant.verifiedFocusSeconds === 0) {
    return { reason: "BELOW_MINIMUM" };
  }

  const idempotencyKey =
    `gf:${participant.run.summaryId}:${userId}:summary`;
  const event = await tx.studyEvent.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    select: {
      source: true,
      evidenceClass: true,
      occurredAt: true,
      groupFocusRoomId: true,
      payload: true,
    },
  });
  const payload = event?.payload;
  const evidenceSeconds = payload
    && typeof payload === "object"
    && !Array.isArray(payload)
    && "verifiedFocusSeconds" in payload
    ? payload.verifiedFocusSeconds
    : undefined;
  if (
    !event
    || event.groupFocusRoomId !== participant.run.roomId
    || event.occurredAt.getTime() !== participant.run.runtimeEndedAt.getTime()
    || evidenceSeconds !== participant.verifiedFocusSeconds
  ) {
    return { reason: "INSUFFICIENT_EVIDENCE" };
  }
  return {
    source: {
      userId,
      sourceId: participant.run.id,
      runId: participant.run.id,
      summaryId: participant.run.summaryId,
      roomId: participant.run.roomId,
      effectiveAt: event.occurredAt,
      evidenceClass: event.evidenceClass,
      source: event.source as StudyEventSource,
      verifiedFocusSeconds: participant.verifiedFocusSeconds,
      runtimeStartedAt: participant.run.runtimeStartedAt,
      actionType: INTEGRITY_ACTION_TYPES.GROUP_FOCUS_SUMMARY_COMPLETE,
      resource: { kind: "group_focus_room", id: participant.run.roomId },
    },
  };
}