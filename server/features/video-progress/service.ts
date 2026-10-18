import crypto from "crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { StudyPointsAwardEngine } from "../study-points/awardEngine.js";
import { notifyStudyPointsPostCommit } from "../study-points/postCommitHooks.js";
import {
  calculateVerifiedPlaybackCredit,
  clampVideoNumber,
  normalizedVideoPlaybackRate,
  VERIFIED_VIDEO_COMPLETION_RATIO,
  VERIFIED_VIDEO_HEARTBEAT_INTERVAL_SECONDS,
  VERIFIED_VIDEO_MAX_DURATION_SECONDS,
  VERIFIED_VIDEO_MIN_DURATION_SECONDS,
  VIDEO_PLAYER_STATES,
  type VideoPlayerState,
} from "./verification.js";

export {
  VERIFIED_VIDEO_COMPLETION_RATIO,
  VERIFIED_VIDEO_HEARTBEAT_INTERVAL_SECONDS,
  VERIFIED_VIDEO_MAX_DURATION_SECONDS,
  VERIFIED_VIDEO_MIN_DURATION_SECONDS,
  VIDEO_PLAYER_STATES,
};
export type { VideoPlayerState };

const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

export type VideoWatchStatus = {
  materialId: string;
  lectureId: string;
  completed: boolean;
  completedAt: string | null;
  durationSeconds: number;
  verifiedSeconds: number;
  completionRatio: number;
};

export type VideoWatchStartResult = VideoWatchStatus & {
  sessionId: string | null;
  heartbeatIntervalSeconds: number;
};

export type VideoWatchHeartbeatResult = VideoWatchStatus & {
  points: {
    awarded: number;
    changed: boolean;
    replayed: boolean;
  };
  lectureVideoCompleted: boolean;
};

function cleanMaterialType(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function toWholeDuration(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const duration = Math.round(parsed);
  if (
    duration < VERIFIED_VIDEO_MIN_DURATION_SECONDS
    || duration > VERIFIED_VIDEO_MAX_DURATION_SECONDS
  ) {
    return null;
  }
  return duration;
}

function toFinitePosition(value: unknown, durationSeconds: number): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return clampVideoNumber(parsed, 0, durationSeconds + 5);
}

function pointsSummary(result: Awaited<ReturnType<StudyPointsAwardEngine["awardServerVerifiedLectureProgress"]>> | null) {
  if (!result) return { awarded: 0, changed: false, replayed: false };
  let awarded = 0;
  let changed = false;
  let replayed = false;
  for (const attempt of result.attempts) {
    if (attempt.decision.outcome !== "AWARD") continue;
    replayed = replayed || attempt.replayed;
    if (!attempt.replayed) {
      awarded += attempt.decision.amount;
      changed = true;
    }
  }
  return { awarded, changed, replayed };
}

function statusFromRow(input: {
  materialId: string;
  lectureId: string;
  durationSeconds: number;
  verifiedMilliseconds: number;
  completedAt: Date | null;
}): VideoWatchStatus {
  const thresholdMs = Math.max(
    1,
    Math.ceil(input.durationSeconds * VERIFIED_VIDEO_COMPLETION_RATIO * 1000),
  );
  return {
    materialId: input.materialId,
    lectureId: input.lectureId,
    completed: !!input.completedAt,
    completedAt: input.completedAt?.toISOString() ?? null,
    durationSeconds: input.durationSeconds,
    verifiedSeconds: Math.floor(input.verifiedMilliseconds / 1000),
    completionRatio: clampVideoNumber(input.verifiedMilliseconds / thresholdMs, 0, 1),
  };
}

async function loadVideoMaterial(
  tx: Prisma.TransactionClient | PrismaClient,
  materialId: string,
) {
  const material = await tx.material.findUnique({
    where: { id: materialId },
    select: { id: true, lectureId: true, type: true },
  });
  if (!material || cleanMaterialType(material.type) !== "VIDEO") return null;
  return material;
}

export class VideoWatchProgressService {
  constructor(private readonly database: PrismaClient = getPrisma() as PrismaClient) {}

  async getLectureStatuses(userId: string, lectureId: string): Promise<VideoWatchStatus[]> {
    const materials = await this.database.material.findMany({
      where: { lectureId },
      select: { id: true, lectureId: true, type: true },
      orderBy: { createdAt: "asc" },
    });
    const videos = materials.filter((material) => cleanMaterialType(material.type) === "VIDEO");
    if (videos.length === 0) return [];
    const rows = await this.database.videoWatchProgress.findMany({
      where: { userId, materialId: { in: videos.map((video) => video.id) } },
    });
    const rowByMaterial = new Map(rows.map((row) => [row.materialId, row]));
    return videos.map((video) => {
      const row = rowByMaterial.get(video.id);
      return statusFromRow({
        materialId: video.id,
        lectureId: video.lectureId,
        durationSeconds: row?.durationSeconds ?? VERIFIED_VIDEO_MIN_DURATION_SECONDS,
        verifiedMilliseconds: row?.verifiedMilliseconds ?? 0,
        completedAt: row?.completedAt ?? null,
      });
    });
  }

  async start(input: {
    userId: string;
    materialId: string;
    durationSeconds: unknown;
    now?: Date;
  }): Promise<VideoWatchStartResult | null> {
    const durationSeconds = toWholeDuration(input.durationSeconds);
    if (!durationSeconds) {
      throw new TypeError(
        `Video duration must be between ${VERIFIED_VIDEO_MIN_DURATION_SECONDS} and ${VERIFIED_VIDEO_MAX_DURATION_SECONDS} seconds.`,
      );
    }
    const now = input.now ?? new Date();
    if (!Number.isFinite(now.getTime())) throw new TypeError("Video watch time is invalid.");

    const material = await loadVideoMaterial(this.database, input.materialId);
    if (!material) return null;

    const sessionId = crypto.randomUUID();
    const progress = await this.database.$transaction(async (tx) => {
      const existing = await tx.videoWatchProgress.findUnique({
        where: { userId_materialId: { userId: input.userId, materialId: input.materialId } },
      });
      const canonicalDuration = existing
        ? Math.max(existing.durationSeconds, durationSeconds)
        : durationSeconds;
      const row = await tx.videoWatchProgress.upsert({
        where: { userId_materialId: { userId: input.userId, materialId: input.materialId } },
        update: existing?.completedAt
          ? { durationSeconds: canonicalDuration }
          : {
              sessionId,
              durationSeconds: canonicalDuration,
              lastPositionSeconds: 0,
              lastHeartbeatAt: now,
              lastPlayerState: "UNSTARTED",
              lastPlaybackRate: 1,
            },
        create: {
          userId: input.userId,
          materialId: input.materialId,
          sessionId,
          durationSeconds: canonicalDuration,
          verifiedMilliseconds: 0,
          lastPositionSeconds: 0,
          lastHeartbeatAt: now,
          lastPlayerState: "UNSTARTED",
          lastPlaybackRate: 1,
        },
      });
      await tx.userProgress.upsert({
        where: { userId_materialId: { userId: input.userId, materialId: input.materialId } },
        update: { hasViewed: true },
        create: {
          userId: input.userId,
          materialId: input.materialId,
          hasViewed: true,
          isCompleted: false,
        },
      });
      return row;
    }, TRANSACTION_OPTIONS);

    const status = statusFromRow({
      materialId: progress.materialId,
      lectureId: material.lectureId,
      durationSeconds: progress.durationSeconds,
      verifiedMilliseconds: progress.verifiedMilliseconds,
      completedAt: progress.completedAt,
    });
    return {
      ...status,
      sessionId: progress.completedAt ? null : progress.sessionId,
      heartbeatIntervalSeconds: VERIFIED_VIDEO_HEARTBEAT_INTERVAL_SECONDS,
    };
  }

  async heartbeat(input: {
    userId: string;
    materialId: string;
    sessionId: string;
    positionSeconds: unknown;
    durationSeconds: unknown;
    playerState: VideoPlayerState;
    playbackRate?: unknown;
    now?: Date;
  }): Promise<VideoWatchHeartbeatResult | { staleSession: true } | null> {
    const reportedDuration = toWholeDuration(input.durationSeconds);
    if (!reportedDuration) throw new TypeError("Video duration is invalid.");
    if (!(VIDEO_PLAYER_STATES as readonly string[]).includes(input.playerState)) {
      throw new TypeError("Video player state is invalid.");
    }
    if (
      typeof input.sessionId !== "string"
      || input.sessionId.length < 8
      || input.sessionId.length > 128
      || input.sessionId.includes("\0")
    ) {
      throw new TypeError("Video watch session is invalid.");
    }
    const now = input.now ?? new Date();
    if (!Number.isFinite(now.getTime())) throw new TypeError("Video heartbeat time is invalid.");

    let pointsChanged = false;
    const result = await this.database.$transaction(async (tx) => {
      const material = await loadVideoMaterial(tx, input.materialId);
      if (!material) return null;
      const current = await tx.videoWatchProgress.findUnique({
        where: { userId_materialId: { userId: input.userId, materialId: input.materialId } },
      });
      if (!current) return { staleSession: true as const };
      if (current.completedAt) {
        const lectureProgress = await tx.lectureProgress.findUnique({
          where: { userId_lectureId: { userId: input.userId, lectureId: material.lectureId } },
          select: { videoCompletedAt: true },
        });
        return {
          ...statusFromRow({
            materialId: current.materialId,
            lectureId: material.lectureId,
            durationSeconds: current.durationSeconds,
            verifiedMilliseconds: current.verifiedMilliseconds,
            completedAt: current.completedAt,
          }),
          points: { awarded: 0, changed: false, replayed: true },
          lectureVideoCompleted: !!lectureProgress?.videoCompletedAt,
        };
      }
      if (current.sessionId !== input.sessionId) return { staleSession: true as const };

      const canonicalDuration = Math.max(current.durationSeconds, reportedDuration);
      const positionSeconds = toFinitePosition(input.positionSeconds, canonicalDuration);
      if (positionSeconds === null) throw new TypeError("Video playback position is invalid.");
      const playbackRate = normalizedVideoPlaybackRate(input.playbackRate);
      const previousHeartbeatAt = current.lastHeartbeatAt;
      const elapsedMs = previousHeartbeatAt
        ? now.getTime() - previousHeartbeatAt.getTime()
        : 0;
      const positionDeltaSeconds = positionSeconds - current.lastPositionSeconds;
      const credit = calculateVerifiedPlaybackCredit({
        elapsedMilliseconds: elapsedMs,
        positionDeltaSeconds,
        previousPlayerState: current.lastPlayerState,
        playerState: input.playerState,
        previousPlaybackRate: current.lastPlaybackRate,
        playbackRate,
      });
      const creditedMs = credit.creditedMilliseconds;
      const maxVideoMs = canonicalDuration * 1000;
      const verifiedMilliseconds = Math.min(
        maxVideoMs,
        current.verifiedMilliseconds + creditedMs,
      );
      const completionThresholdMs = Math.ceil(
        canonicalDuration * VERIFIED_VIDEO_COMPLETION_RATIO * 1000,
      );
      const completesNow = verifiedMilliseconds >= completionThresholdMs;

      const updated = await tx.videoWatchProgress.update({
        where: { id: current.id },
        data: {
          durationSeconds: canonicalDuration,
          verifiedMilliseconds,
          lastPositionSeconds: positionSeconds,
          lastHeartbeatAt: now,
          lastPlayerState: input.playerState,
          lastPlaybackRate: playbackRate,
          ...(completesNow ? { completedAt: now } : {}),
        },
      });

      let pointResult: Awaited<ReturnType<StudyPointsAwardEngine["awardServerVerifiedLectureProgress"]>> | null = null;
      let lectureVideoCompleted = false;
      if (completesNow) {
        await tx.userProgress.upsert({
          where: { userId_materialId: { userId: input.userId, materialId: input.materialId } },
          update: { hasViewed: true, isCompleted: true },
          create: {
            userId: input.userId,
            materialId: input.materialId,
            hasViewed: true,
            isCompleted: true,
          },
        });

        const lectureMaterials = await tx.material.findMany({
          where: { lectureId: material.lectureId },
          select: { id: true, type: true },
        });
        const videoIds = lectureMaterials
          .filter((item) => cleanMaterialType(item.type) === "VIDEO")
          .map((item) => item.id);
        const completedVideoRows = videoIds.length > 0
          ? await tx.videoWatchProgress.count({
              where: {
                userId: input.userId,
                materialId: { in: videoIds },
                completedAt: { not: null },
              },
            })
          : 0;
        lectureVideoCompleted = videoIds.length > 0 && completedVideoRows === videoIds.length;
        const existingLectureProgress = await tx.lectureProgress.findUnique({
          where: { userId_lectureId: { userId: input.userId, lectureId: material.lectureId } },
          select: { videoCompletedAt: true },
        });
        await tx.lectureProgress.upsert({
          where: { userId_lectureId: { userId: input.userId, lectureId: material.lectureId } },
          update: lectureVideoCompleted
            ? {
                videoCompleted: true,
                videoCompletedAt: existingLectureProgress?.videoCompletedAt ?? now,
                lastAccessed: now,
              }
            : { lastAccessed: now },
          create: {
            userId: input.userId,
            lectureId: material.lectureId,
            videoCompleted: lectureVideoCompleted,
            videoCompletedAt: lectureVideoCompleted ? now : null,
            lastAccessed: now,
          },
        });

        const pointsAwarder = new StudyPointsAwardEngine(
          this.database,
          () => now,
          () => true,
          false,
        );
        pointResult = await pointsAwarder.awardServerVerifiedLectureProgress({
          userId: input.userId,
          lectureId: material.lectureId,
          completionType: "VIDEO",
          materialId: input.materialId,
          effectiveAt: now,
          now,
          tx,
        });
      }
      const points = pointsSummary(pointResult);
      pointsChanged = pointsChanged || points.changed;
      return {
        ...statusFromRow({
          materialId: updated.materialId,
          lectureId: material.lectureId,
          durationSeconds: updated.durationSeconds,
          verifiedMilliseconds: updated.verifiedMilliseconds,
          completedAt: updated.completedAt,
        }),
        points,
        lectureVideoCompleted,
      };
    }, TRANSACTION_OPTIONS);

    if (pointsChanged) await notifyStudyPointsPostCommit(input.userId);
    return result;
  }
}
