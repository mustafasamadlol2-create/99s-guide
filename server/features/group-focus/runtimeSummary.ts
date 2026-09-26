import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import {
  GROUP_FOCUS_SUMMARY_MAX_BODY_BYTES,
  GROUP_FOCUS_SUMMARY_TERMINAL_REASONS,
  GROUP_FOCUS_SUMMARY_VERSION,
  type GroupFocusMyRuntimeSummary,
  type GroupFocusRuntimeSnapshotResponse,
  type GroupFocusRuntimeSummary,
  type GroupFocusRuntimeSummaryAck,
} from "../../../shared/group-focus-reconciliation/contract.js";
import { getPrisma } from "../../services/prismaClient.js";
import { ingestStudyEvent } from "../study-events/service.js";
import { StudyEventError } from "../study-events/errors.js";
import type { StudyEventTransaction } from "../study-events/types.js";
import { StudyPointsAwardEngine } from "../study-points/awardEngine.js";
import type { StudyPointsAwarder } from "../study-points/awardTypes.js";

const UUID = z.string().uuid();
const runtimeId = z.string().regex(/^[A-Za-z0-9_-]{22}$/u);
const isoTimestamp = z.string().refine((value) => {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
});

const participantSchema = z.object({
  userId: UUID,
  membershipId: UUID,
  role: z.enum(["HOST", "MEMBER"]),
  effectiveLectureId: UUID,
  firstConnectedAt: isoTimestamp,
  lastDisconnectedAt: isoTimestamp.optional(),
  reconnectCount: z.number().int().min(0).max(10_000),
  verifiedFocusSeconds: z.number().int().min(0).max(20 * 6 * 60 * 60),
  rounds: z.array(z.object({
    roundNumber: z.number().int().min(1).max(20),
    verifiedFocusSeconds: z.number().int().min(0).max(6 * 60 * 60),
  }).strict()).max(20),
}).strict();

const runtimeSummarySchema = z.object({
  summaryVersion: z.literal(GROUP_FOCUS_SUMMARY_VERSION),
  summaryId: runtimeId,
  runtimeInstanceId: runtimeId,
  roomId: UUID,
  mode: z.enum(["SHARED_LECTURE", "STUDY_TOGETHER"]),
  focusDurationSeconds: z.number().int().min(60).max(6 * 60 * 60),
  breakDurationSeconds: z.number().int().min(0).max(3 * 60 * 60),
  roundCount: z.number().int().min(1).max(20),
  runtimeStartedAt: isoTimestamp,
  runtimeEndedAt: isoTimestamp,
  terminalReason: z.enum(GROUP_FOCUS_SUMMARY_TERMINAL_REASONS),
  completedRounds: z.number().int().min(0).max(20),
  finalRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  participants: z.array(participantSchema).max(25),
}).strict().superRefine((summary, context) => {
  if (Date.parse(summary.runtimeEndedAt) < Date.parse(summary.runtimeStartedAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["runtimeEndedAt"],
      message: "End time must not precede start time.",
    });
  }
  if (summary.completedRounds > summary.roundCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["completedRounds"],
      message: "Completed rounds exceed the configured round count.",
    });
  }
  const users = new Set<string>();
  const memberships = new Set<string>();
  for (const participant of summary.participants) {
    if (users.has(participant.userId) || memberships.has(participant.membershipId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["participants"],
        message: "Participant identities must be unique.",
      });
    }
    users.add(participant.userId);
    memberships.add(participant.membershipId);
    if (participant.rounds.length !== summary.roundCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["participants"],
        message: "Each participant must include one entry per configured round.",
      });
    }
    participant.rounds.forEach((round, index) => {
      if (
        round.roundNumber !== index + 1
        || round.verifiedFocusSeconds > summary.focusDurationSeconds
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["participants"],
          message: "Round participation is out of range or out of order.",
        });
      }
    });
    if (
      participant.verifiedFocusSeconds
      > summary.roundCount * summary.focusDurationSeconds
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["participants"],
        message: "Total verified participation exceeds the configured maximum.",
      });
    }
  }
});

export class GroupFocusRuntimeSummaryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = "Group Focus runtime summary was rejected.",
  ) {
    super(message);
    this.name = "GroupFocusRuntimeSummaryError";
  }
}

function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) =>
      `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readSummary(value: unknown): GroupFocusRuntimeSummary {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > GROUP_FOCUS_SUMMARY_MAX_BODY_BYTES) {
    throw new GroupFocusRuntimeSummaryError(413, "SUMMARY_TOO_LARGE");
  }
  const parsed = runtimeSummarySchema.safeParse(value);
  if (!parsed.success) {
    throw new GroupFocusRuntimeSummaryError(400, "INVALID_SUMMARY");
  }
  return parsed.data as GroupFocusRuntimeSummary;
}

export function buildGroupFocusParticipantStudyEvents(
  summary: GroupFocusRuntimeSummary,
  runId: string,
  participant: GroupFocusRuntimeSummary["participants"][number],
): Array<Parameters<typeof ingestStudyEvent>[0]> {
  const participantEnd = participant.lastDisconnectedAt ?? summary.runtimeEndedAt;
  const eventBase = {
    userId: participant.userId,
    source: "backend" as const,
    groupFocusRoomId: summary.roomId,
    evidenceClass: "REALTIME_VERIFIED" as const,
    privacyClass: "PRIVATE_STUDY" as const,
  };
  const identity = {
    roomId: summary.roomId,
    runId,
    mode: summary.mode,
    role: participant.role,
    effectiveLectureId: participant.effectiveLectureId,
  };
  const events: Array<Parameters<typeof ingestStudyEvent>[0]> = [
    {
      ...eventBase,
      eventType: "group_focus_joined",
      occurredAt: participant.firstConnectedAt,
      idempotencyKey: `gf:${summary.summaryId}:${participant.userId}:joined`,
      payload: identity,
    },
    ...participant.rounds
      .filter((round) =>
        round.verifiedFocusSeconds >= Math.max(0, summary.focusDurationSeconds - 2))
      .map((round) => ({
        ...eventBase,
        eventType: "group_focus_round_completed" as const,
        occurredAt: participantEnd,
        idempotencyKey:
          `gf:${summary.summaryId}:${participant.userId}:round:${round.roundNumber}`,
        payload: {
          ...identity,
          roundNumber: round.roundNumber,
          verifiedFocusSeconds: round.verifiedFocusSeconds,
          plannedFocusSeconds: summary.focusDurationSeconds,
        },
      })),
    {
      ...eventBase,
      eventType: "group_focus_left",
      occurredAt: participantEnd,
      idempotencyKey: `gf:${summary.summaryId}:${participant.userId}:left`,
      payload: identity,
    },
  ];
  if (participant.verifiedFocusSeconds > 0) {
    events.push({
      ...eventBase,
      eventType: "group_focus_summary_completed",
      occurredAt: summary.runtimeEndedAt,
      idempotencyKey: `gf:${summary.summaryId}:${participant.userId}:summary`,
      payload: {
        ...identity,
        verifiedFocusSeconds: participant.verifiedFocusSeconds,
        roundsCompleted: participant.rounds.filter((round) =>
          round.verifiedFocusSeconds
            >= Math.max(0, summary.focusDurationSeconds - 2)).length,
        reconnectCount: participant.reconnectCount,
        terminalReason: summary.terminalReason,
      },
    });
  }
  return events;
}

export function createGroupFocusRuntimeSummaryService(options: {
  prisma?: ReturnType<typeof getPrisma>;
  ingestEvent?: typeof ingestStudyEvent;
  studyPointsAwarder?: StudyPointsAwarder;
  postCommitAchievementRefresh?: (userId: string) => Promise<unknown>;
  postCommitChallengeRefresh?: (
    userId: string,
    metricIds: readonly string[],
  ) => Promise<unknown>;
} = {}) {
  const prisma = options.prisma ?? getPrisma();
  const ingestEvent = options.ingestEvent ?? ingestStudyEvent;
  const studyPointsAwarder = options.studyPointsAwarder
    ?? new StudyPointsAwardEngine(prisma);

  async function getCanonicalSnapshot(
    roomId: string,
    userIds: readonly string[],
  ): Promise<GroupFocusRuntimeSnapshotResponse> {
    const room = await prisma.groupFocusRoom.findUnique({
      where: { id: roomId },
      select: {
        id: true,
        status: true,
        mode: true,
        visibility: true,
        sharedLectureId: true,
        focusDurationSeconds: true,
        breakDurationSeconds: true,
        roundCount: true,
        maxParticipants: true,
        updatedAt: true,
        memberships: {
          where: { userId: { in: [...userIds] } },
          select: {
            id: true,
            userId: true,
            status: true,
            role: true,
            selectedLectureId: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!room) throw new GroupFocusRuntimeSummaryError(404, "ROOM_NOT_FOUND");
    return {
      room: {
        roomId: room.id,
        status: room.status as "OPEN" | "CLOSED",
        mode: room.mode as "SHARED_LECTURE" | "STUDY_TOGETHER",
        visibility: room.visibility as "PUBLIC" | "PRIVATE",
        sharedLectureId: room.sharedLectureId,
        focusDurationSeconds: room.focusDurationSeconds,
        breakDurationSeconds: room.breakDurationSeconds,
        roundCount: room.roundCount,
        maxParticipants: room.maxParticipants,
        updatedAt: room.updatedAt.toISOString(),
      },
      memberships: room.memberships.map((membership) => ({
        userId: membership.userId,
        membershipId: membership.id,
        status: membership.status as "ACTIVE" | "LEFT" | "REMOVED",
        role: membership.role as "HOST" | "MEMBER",
        effectiveLectureId: room.mode === "SHARED_LECTURE"
          ? room.sharedLectureId
          : membership.selectedLectureId,
        updatedAt: membership.updatedAt.toISOString(),
      })),
    };
  }

  async function persistTerminalSummary(input: unknown): Promise<GroupFocusRuntimeSummaryAck> {
    const summary = readSummary(input);
    const canonicalBody = canonicalJson(summary);
    const summaryHash = sha256(canonicalBody);
    try {
      const acknowledgement = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ locked: boolean }>>`
          SELECT TRUE AS locked
          FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`group-focus-summary:${summary.summaryId}`}, 0))) AS acquired
        `;

        const existing = await tx.groupFocusRun.findFirst({
          where: {
            OR: [
              { summaryId: summary.summaryId },
              { roomId: summary.roomId },
              { runtimeInstanceId: summary.runtimeInstanceId },
            ],
          },
          select: {
            id: true,
            roomId: true,
            summaryId: true,
            runtimeInstanceId: true,
            summaryHash: true,
          },
        });
        if (existing) {
          if (
            existing.summaryId === summary.summaryId
            && existing.runtimeInstanceId === summary.runtimeInstanceId
            && existing.roomId === summary.roomId
            && existing.summaryHash === summaryHash
          ) {
            return { summaryId: summary.summaryId, status: "REPLAY", runId: existing.id };
          }
          throw new GroupFocusRuntimeSummaryError(409, "SUMMARY_CONFLICT");
        }

        const room = await tx.groupFocusRoom.findUnique({
          where: { id: summary.roomId },
          select: {
            id: true,
            status: true,
            mode: true,
            focusDurationSeconds: true,
            breakDurationSeconds: true,
            roundCount: true,
            memberships: {
              where: { id: { in: summary.participants.map((participant) => participant.membershipId) } },
              select: { id: true, userId: true },
            },
          },
        });
        if (!room) throw new GroupFocusRuntimeSummaryError(404, "ROOM_NOT_FOUND");
        if (
          room.mode !== summary.mode
          || room.focusDurationSeconds !== summary.focusDurationSeconds
          || room.breakDurationSeconds !== summary.breakDurationSeconds
          || room.roundCount !== summary.roundCount
        ) {
          throw new GroupFocusRuntimeSummaryError(409, "ROOM_CONFIGURATION_MISMATCH");
        }

        const membershipById = new Map(room.memberships.map((membership) => [
          membership.id,
          membership.userId,
        ]));
        for (const participant of summary.participants) {
          if (membershipById.get(participant.membershipId) !== participant.userId) {
            throw new GroupFocusRuntimeSummaryError(409, "PARTICIPANT_MEMBERSHIP_MISMATCH");
          }
          const lecture = await tx.lecture.findUnique({
            where: { id: participant.effectiveLectureId },
            select: { id: true },
          });
          if (!lecture) {
            throw new GroupFocusRuntimeSummaryError(409, "PARTICIPANT_LECTURE_NOT_FOUND");
          }
        }

        const run = await tx.groupFocusRun.create({
          data: {
            roomId: summary.roomId,
            summaryId: summary.summaryId,
            runtimeInstanceId: summary.runtimeInstanceId,
            summaryVersion: summary.summaryVersion,
            summaryHash,
            mode: summary.mode,
            focusDurationSeconds: summary.focusDurationSeconds,
            breakDurationSeconds: summary.breakDurationSeconds,
            roundCount: summary.roundCount,
            runtimeStartedAt: new Date(summary.runtimeStartedAt),
            runtimeEndedAt: new Date(summary.runtimeEndedAt),
            terminalReason: summary.terminalReason,
            completedRounds: summary.completedRounds,
            finalRevision: summary.finalRevision,
          },
          select: { id: true },
        });

        for (const participant of summary.participants) {
          const participantEnd = participant.lastDisconnectedAt ?? summary.runtimeEndedAt;
          await tx.groupFocusParticipantSummary.create({
            data: {
              runId: run.id,
              userId: participant.userId,
              membershipId: participant.membershipId,
              role: participant.role,
              effectiveLectureId: participant.effectiveLectureId,
              firstConnectedAt: new Date(participant.firstConnectedAt),
              lastDisconnectedAt: participant.lastDisconnectedAt
                ? new Date(participant.lastDisconnectedAt)
                : null,
              reconnectCount: participant.reconnectCount,
              verifiedFocusSeconds: participant.verifiedFocusSeconds,
              rounds: participant.rounds,
            },
          });
          for (const event of buildGroupFocusParticipantStudyEvents(
            summary,
            run.id,
            participant,
          )) {
            const result = await ingestEvent(event, {
              transaction: tx as unknown as StudyEventTransaction,
            });
            if (result.status === "FEATURE_DISABLED") {
              throw new GroupFocusRuntimeSummaryError(503, "STUDY_EVENTS_DISABLED");
            }
          }
        }

        for (const participant of [...summary.participants].sort((left, right) =>
          left.userId.localeCompare(right.userId)
        )) {
          if (participant.verifiedFocusSeconds === 0) continue;
          await studyPointsAwarder.awardStudyPointsForSource({
            userId: participant.userId,
            sourceType: "GROUP_FOCUS_RUN",
            sourceId: run.id,
            tx: tx as unknown as Prisma.TransactionClient,
          });
        }

        await tx.groupFocusRoom.update({
          where: { id: summary.roomId },
          data: {
            status: "CLOSED",
            closedAt: new Date(summary.runtimeEndedAt),
            inviteTokenHash: null,
          },
        });
        await tx.groupFocusMembership.updateMany({
          where: {
            roomId: summary.roomId,
            status: "ACTIVE",
          },
          data: {
            status: "LEFT",
            leftAt: new Date(summary.runtimeEndedAt),
            updatedAt: new Date(summary.runtimeEndedAt),
          },
        });
        return { summaryId: summary.summaryId, status: "APPLIED", runId: run.id };
      });
      if (
        acknowledgement.status === "APPLIED"
        && (
          options.postCommitAchievementRefresh
          || options.postCommitChallengeRefresh
        )
      ) {
        const userIds = new Set(
          summary.participants
            .filter((participant) => participant.verifiedFocusSeconds > 0)
            .map((participant) => participant.userId),
        );
        for (const userId of userIds) {
          if (options.postCommitAchievementRefresh) {
            try {
              await options.postCommitAchievementRefresh(userId);
            } catch (error) {
              const reason = error instanceof Error ? error.message : "unknown error";
              console.warn(`[Group Focus] Post-commit Achievement refresh failed: ${reason}`);
            }
          }
          if (options.postCommitChallengeRefresh) {
            try {
              await options.postCommitChallengeRefresh(userId, [
                "group_focus.completed_runs",
                "consistency.qualifying_days",
              ]);
            } catch (error) {
              const reason = error instanceof Error ? error.message : "unknown error";
              console.warn(`[Group Focus] Post-commit Challenge refresh failed: ${reason}`);
            }
          }
        }
      }
      return acknowledgement;
    } catch (error) {
      if (error instanceof GroupFocusRuntimeSummaryError) throw error;
      if (error instanceof StudyEventError && error.code === "IDEMPOTENCY_CONFLICT") {
        throw new GroupFocusRuntimeSummaryError(409, "SUMMARY_CONFLICT");
      }
      const candidate = error as { code?: unknown };
      if (candidate?.code === "P2002") {
        throw new GroupFocusRuntimeSummaryError(409, "SUMMARY_CONFLICT");
      }
      throw error;
    }
  }

  async function getMySummary(
    userId: string,
    roomId: string,
  ): Promise<GroupFocusMyRuntimeSummary | null> {
    const run = await prisma.groupFocusRun.findUnique({
      where: { roomId },
      select: {
        id: true,
        summaryId: true,
        roomId: true,
        mode: true,
        focusDurationSeconds: true,
        breakDurationSeconds: true,
        roundCount: true,
        runtimeStartedAt: true,
        runtimeEndedAt: true,
        terminalReason: true,
        completedRounds: true,
        participants: {
          where: { userId },
          take: 1,
          select: {
            userId: true,
            membershipId: true,
            role: true,
            effectiveLectureId: true,
            firstConnectedAt: true,
            lastDisconnectedAt: true,
            reconnectCount: true,
            verifiedFocusSeconds: true,
            rounds: true,
          },
        },
      },
    });
    const participant = run?.participants[0];
    if (!run || !participant || !Array.isArray(participant.rounds)) return null;
    return {
      run: {
        runId: run.id,
        summaryId: run.summaryId,
        roomId: run.roomId,
        mode: run.mode as "SHARED_LECTURE" | "STUDY_TOGETHER",
        focusDurationSeconds: run.focusDurationSeconds,
        breakDurationSeconds: run.breakDurationSeconds,
        roundCount: run.roundCount,
        runtimeStartedAt: run.runtimeStartedAt.toISOString(),
        runtimeEndedAt: run.runtimeEndedAt.toISOString(),
        terminalReason: run.terminalReason as GroupFocusRuntimeSummary["terminalReason"],
        completedRounds: run.completedRounds,
      },
      participant: {
        userId: participant.userId,
        membershipId: participant.membershipId,
        role: participant.role as "HOST" | "MEMBER",
        effectiveLectureId: participant.effectiveLectureId,
        firstConnectedAt: participant.firstConnectedAt.toISOString(),
        ...(participant.lastDisconnectedAt
          ? { lastDisconnectedAt: participant.lastDisconnectedAt.toISOString() }
          : {}),
        reconnectCount: participant.reconnectCount,
        verifiedFocusSeconds: participant.verifiedFocusSeconds,
        rounds: participant.rounds as GroupFocusRuntimeSummary["participants"][number]["rounds"],
      },
    };
  }

  return { getCanonicalSnapshot, persistTerminalSummary, getMySummary };
}

export type GroupFocusRuntimeSummaryService =
  ReturnType<typeof createGroupFocusRuntimeSummaryService>;