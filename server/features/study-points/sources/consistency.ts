import type { Prisma } from "@prisma/client";
import { INTEGRITY_ACTION_TYPES } from "../../study-integrity/constants.js";
import type { StudyEventSource } from "../../study-core/events.js";
import {
  getStudyPointsBaghdadDayBounds,
  type StudyPointsBaghdadDayBounds,
} from "../caps.js";
import { getStudyPointsIntegrityFailure } from "../integrityGate.js";

type DailyEvidenceEvent = {
  source: string;
  evidenceClass: string;
  occurredAt: Date;
  durationSeconds?: number;
};

function sameTimestamp(left: Date, right: Date): boolean {
  return left.getTime() === right.getTime();
}

async function eligibleFocusSeconds(
  tx: Prisma.TransactionClient,
  userId: string,
  bounds: StudyPointsBaghdadDayBounds,
  now: Date,
): Promise<number> {
  const sessions = await tx.focusSession.findMany({
    where: {
      userId,
      status: "COMPLETED",
      actualEndedAt: { gte: bounds.start, lt: bounds.end },
    },
    select: {
      id: true,
      activeSeconds: true,
      actualEndedAt: true,
    },
  });
  if (sessions.length === 0) return 0;

  const events = await tx.studyEvent.findMany({
    where: {
      userId,
      focusSessionId: { in: sessions.map((session) => session.id) },
      eventType: "focus_session_completed",
      occurredAt: { gte: bounds.start, lt: bounds.end },
    },
    select: {
      focusSessionId: true,
      source: true,
      evidenceClass: true,
      occurredAt: true,
      payload: true,
    },
  });
  const eventBySessionId = new Map<string, DailyEvidenceEvent>();
  for (const event of events) {
    const payload = event.payload;
    const durationSeconds = payload
      && typeof payload === "object"
      && !Array.isArray(payload)
      && "activeSeconds" in payload
      && typeof payload.activeSeconds === "number"
      ? payload.activeSeconds
      : undefined;
    if (event.focusSessionId) {
      eventBySessionId.set(event.focusSessionId, { ...event, durationSeconds });
    }
  }

  let total = 0;
  for (const session of sessions) {
    const event = eventBySessionId.get(session.id);
    if (
      !event
      || !session.actualEndedAt
      || !sameTimestamp(event.occurredAt, session.actualEndedAt)
      || event.durationSeconds !== session.activeSeconds
    ) {
      continue;
    }
    const blocked = await getStudyPointsIntegrityFailure(tx, {
      userId,
      actionType: INTEGRITY_ACTION_TYPES.FOCUS_SESSION_COMPLETE,
      source: event.source as StudyEventSource,
      evidenceClass: event.evidenceClass,
      occurredAt: event.occurredAt,
      now,
      resource: { kind: "focus_session", id: session.id },
    });
    if (blocked) continue;
    if (!Number.isSafeInteger(session.activeSeconds) || session.activeSeconds < 0) {
      throw new Error("Canonical Focus duration is invalid.");
    }
    total += session.activeSeconds;
    if (!Number.isSafeInteger(total)) {
      throw new Error("Daily verified Focus duration exceeds the safe integer range.");
    }
  }
  return total;
}

async function eligibleGroupFocusSeconds(
  tx: Prisma.TransactionClient,
  userId: string,
  bounds: StudyPointsBaghdadDayBounds,
  now: Date,
): Promise<number> {
  const summaries = await tx.groupFocusParticipantSummary.findMany({
    where: {
      userId,
      verifiedFocusSeconds: { gt: 0 },
      run: {
        runtimeStartedAt: { gte: bounds.start, lt: bounds.end },
        runtimeEndedAt: { gte: bounds.start, lt: bounds.end },
      },
    },
    select: {
      id: true,
      runId: true,
      verifiedFocusSeconds: true,
      run: {
        select: {
          id: true,
          roomId: true,
          summaryId: true,
          runtimeEndedAt: true,
        },
      },
    },
  });
  if (summaries.length === 0) return 0;

  const events = await tx.studyEvent.findMany({
    where: {
      userId,
      groupFocusRoomId: { in: summaries.map((summary) => summary.run.roomId) },
      eventType: "group_focus_summary_completed",
      occurredAt: { gte: bounds.start, lt: bounds.end },
    },
    select: {
      groupFocusRoomId: true,
      source: true,
      evidenceClass: true,
      occurredAt: true,
      payload: true,
    },
  });
  const eventByRoomId = new Map<string, DailyEvidenceEvent>();
  for (const event of events) {
    const payload = event.payload;
    const durationSeconds = payload
      && typeof payload === "object"
      && !Array.isArray(payload)
      && "verifiedFocusSeconds" in payload
      && typeof payload.verifiedFocusSeconds === "number"
      ? payload.verifiedFocusSeconds
      : undefined;
    if (event.groupFocusRoomId) {
      eventByRoomId.set(event.groupFocusRoomId, { ...event, durationSeconds });
    }
  }

  let total = 0;
  for (const summary of summaries) {
    const event = eventByRoomId.get(summary.run.roomId);
    if (
      !event
      || !sameTimestamp(event.occurredAt, summary.run.runtimeEndedAt)
      || event.durationSeconds !== summary.verifiedFocusSeconds
    ) {
      continue;
    }
    const blocked = await getStudyPointsIntegrityFailure(tx, {
      userId,
      actionType: INTEGRITY_ACTION_TYPES.GROUP_FOCUS_SUMMARY_COMPLETE,
      source: event.source as StudyEventSource,
      evidenceClass: event.evidenceClass,
      occurredAt: event.occurredAt,
      now,
      resource: { kind: "group_focus_room", id: summary.run.roomId },
    });
    if (blocked) continue;
    if (!Number.isSafeInteger(summary.verifiedFocusSeconds) || summary.verifiedFocusSeconds < 0) {
      throw new Error("Canonical Group Focus duration is invalid.");
    }
    total += summary.verifiedFocusSeconds;
    if (!Number.isSafeInteger(total)) {
      throw new Error("Daily verified Focus duration exceeds the safe integer range.");
    }
  }
  return total;
}

export async function getEligibleBaghdadDayFocusSeconds(
  tx: Prisma.TransactionClient,
  userId: string,
  baghdadDate: string,
  now: Date,
): Promise<number> {
  const bounds = await getStudyPointsBaghdadDayBounds(tx, baghdadDate);
  const [solo, group] = await Promise.all([
    eligibleFocusSeconds(tx, userId, bounds, now),
    eligibleGroupFocusSeconds(tx, userId, bounds, now),
  ]);
  return solo + group;
}