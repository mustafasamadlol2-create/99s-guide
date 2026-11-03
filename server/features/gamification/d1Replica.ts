/**
 * Phase 6 — server-owned, private, disposable Gamification read snapshot.
 * PostgreSQL remains canonical for all Study Points, rewards, rule sets, and
 * Challenge enrollment. This module has no browser-facing write endpoint.
 */
import { getPrisma } from "../../services/prismaClient.js";
import {
  enqueuePrivateD1Projection,
} from "../../services/privateD1Sync.js";
import {
  fetchPrivateReadJson,
} from "../../services/privateD1Read.js";
import { getMyGamificationSummary } from "./gamificationRead.js";
import { getMyChallenges } from "./challengeRefresh.js";
import type { MyGamificationSummary } from "./levelTypes.js";
import type { MyChallengesResponse } from "./challengeTypes.js";

export const GAMIFICATION_D1_SNAPSHOT_VERSION = 1;

export type GamificationD1Snapshot = {
  summary: MyGamificationSummary;
  challenges: MyChallengesResponse;
};

function enabled(name: string): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim());
}

function validUserId(userId: string): boolean {
  return typeof userId === "string" && userId.length > 0
    && userId.length <= 128 && userId.trim() === userId;
}

export async function buildCanonicalGamificationD1Snapshot(
  userId: string,
): Promise<GamificationD1Snapshot> {
  if (!validUserId(userId)) throw new Error("Invalid gamification snapshot user scope.");
  // Challenge refresh is an authorized canonical write; it may award a reward.
  // Re-read Points after Challenge refresh, so the snapshot never omits the
  // newly awarded Challenge Points.
  const challenges = await getMyChallenges(userId);
  const afterChallenges = await getMyGamificationSummary(userId);
  if (
    afterChallenges.ruleSetVersion !== challenges.ruleSetVersion ||
    !Array.isArray(afterChallenges.achievements) ||
    afterChallenges.achievements.length === 0 ||
    !Array.isArray(afterChallenges.unlockHistory) ||
    !Array.isArray(challenges.active) ||
    !Array.isArray(challenges.recent) ||
    !Number.isSafeInteger(afterChallenges.points.totalPoints)
  ) {
    throw new Error("Canonical Gamification payload failed Phase 6 validation.");
  }
  return { summary: afterChallenges, challenges };
}

export function gamificationD1Projection(
  userId: string,
  snapshot: GamificationD1Snapshot,
  updatedAt = new Date().toISOString(),
): Record<string, unknown> {
  if (!validUserId(userId)) throw new Error("Invalid gamification snapshot user scope.");
  const endsAt = snapshot.challenges.currentPeriod.endsAt;
  const challengePeriodEndsAt = endsAt instanceof Date
    ? endsAt.toISOString()
    : new Date(String(endsAt)).toISOString();
  const data: Record<string, unknown> = {
    id: userId,
    canonicalId: userId,
    userId,
    userScope: userId,
    ruleSetVersion: snapshot.summary.ruleSetVersion,
    summaryJson: JSON.stringify(snapshot.summary),
    challengesJson: JSON.stringify(snapshot.challenges),
    challengePeriodEndsAt,
    updatedAt,
    projectionVersion: GAMIFICATION_D1_SNAPSHOT_VERSION,
    revision: "0",
    deletedAt: null,
  };
  if (JSON.stringify(data).length > 48 * 1024) {
    throw new Error("Phase 6 projection is too large for the private sync envelope.");
  }
  return data;
}

export async function publishGamificationD1Snapshot(userId: string): Promise<void> {
  if (!enabled("PRIVATE_D1_PHASE6_GAMIFICATION_SYNC_ENABLED")) return;
  const projection = gamificationD1Projection(
    userId, await buildCanonicalGamificationD1Snapshot(userId),
  );
  // Outbox sequencing is PostgreSQL-owned. An older delayed sync cannot
  // overwrite a projection with a newer outbox revision in D1.
  await enqueuePrivateD1Projection(getPrisma(), {
    entity: "GamificationSnapshot",
    key: { id: userId },
    data: projection,
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class Phase6GamificationReadError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "Phase6GamificationReadError";
  }
}

export async function readGamificationD1Snapshot(
  userId: string,
  options: { requireCurrentChallengeWeek?: boolean } = {},
): Promise<GamificationD1Snapshot> {
  if (!validUserId(userId)) throw new Phase6GamificationReadError("PHASE6_INVALID_USER_SCOPE");
  let response: unknown;
  try {
    response = await fetchPrivateReadJson<unknown>(
      "/internal/private-read/gamification-snapshot", { userId }, 2_000,
    );
  } catch {
    // Cutover is strict: never silently query Supabase on a D1 read failure.
    throw new Phase6GamificationReadError("PHASE6_D1_UNAVAILABLE");
  }
  if (!isObject(response) || !isObject(response.row)) {
    throw new Phase6GamificationReadError("PHASE6_D1_MALFORMED");
  }
  const row = response.row;
  if (
    row.id !== userId || row.userId !== userId ||
    row.userScope !== userId || row.canonicalId !== userId ||
    row.projectionVersion !== GAMIFICATION_D1_SNAPSHOT_VERSION ||
    row.deletedAt !== null ||
    typeof row.revision !== "string" || !/^\d+$/.test(row.revision) ||
    typeof row.ruleSetVersion !== "string" ||
    typeof row.summaryJson !== "string" ||
    typeof row.challengesJson !== "string"
  ) throw new Phase6GamificationReadError("PHASE6_D1_MALFORMED");

  let summary: unknown;
  let challenges: unknown;
  try {
    summary = JSON.parse(row.summaryJson);
    challenges = JSON.parse(row.challengesJson);
  } catch {
    throw new Phase6GamificationReadError("PHASE6_D1_MALFORMED");
  }
  if (
    !isObject(summary) || !isObject(summary.points) ||
    !isObject(summary.level) || !Array.isArray(summary.achievements) ||
    !Array.isArray(summary.unlockHistory) ||
    summary.ruleSetVersion !== row.ruleSetVersion ||
    typeof summary.points.totalPoints !== "number" ||
    !Number.isSafeInteger(summary.points.totalPoints) ||
    !isObject(challenges) || !Array.isArray(challenges.active) ||
    !Array.isArray(challenges.recent) ||
    challenges.ruleSetVersion !== row.ruleSetVersion ||
    typeof row.challengePeriodEndsAt !== "string" ||
    !Number.isFinite(Date.parse(row.challengePeriodEndsAt))
  ) throw new Phase6GamificationReadError("PHASE6_D1_MALFORMED");

  if (options.requireCurrentChallengeWeek && Date.now() >= Date.parse(row.challengePeriodEndsAt)) {
    // Weekly Challenge lifecycle may require new enrollment + rewards in PG.
    // This is a hard gate, not an unsafe old-week D1 response or PG fallback.
    throw new Phase6GamificationReadError("PHASE6_WEEKLY_CHALLENGES_EXPIRED");
  }
  return { summary: summary as unknown as MyGamificationSummary, challenges: challenges as unknown as MyChallengesResponse };
}
