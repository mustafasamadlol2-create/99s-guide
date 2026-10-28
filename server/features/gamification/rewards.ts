import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { StudyPointsLedgerService } from "../study-points/ledger.js";
import type {
  AchievementDefinition,
  ChallengeDefinitionContract,
} from "./types.js";

const ACHIEVEMENT_REWARD_REASON = "gamification.achievement_reward";
const CHALLENGE_REWARD_REASON = "gamification.challenge_reward";

export type GamificationRewardResult = {
  rewardPoints: number;
  awardedNow: boolean;
};

function safeRewardPoints(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : 0;
}

export async function awardAchievementRewardInTransaction(input: {
  userId: string;
  definition: AchievementDefinition;
  effectiveAt: Date;
  tx: Prisma.TransactionClient;
  database?: PrismaClient;
}): Promise<GamificationRewardResult> {
  const rewardPoints = safeRewardPoints(input.definition.rewardPoints);
  if (rewardPoints === 0) return { rewardPoints: 0, awardedNow: false };

  const ledger = new StudyPointsLedgerService(
    input.database ?? getPrisma() as PrismaClient,
  );
  const result = await ledger.appendStudyPointsLedgerEntry({
    userId: input.userId,
    amount: rewardPoints,
    category: "PROGRESS",
    reasonCode: ACHIEVEMENT_REWARD_REASON,
    sourceType: "GAMIFICATION_REWARD",
    sourceId: input.definition.id,
    ruleVersion: input.definition.ruleSetVersion,
    idempotencyKey: `gamification:achievement:${input.definition.ruleSetVersion}:${input.definition.id}`,
    effectiveAt: input.effectiveAt,
    metadata: {
      rewardKind: "ACHIEVEMENT",
      achievementId: input.definition.id,
      rewardPoints,
    },
  }, input.tx);
  return { rewardPoints, awardedNow: !result.replayed };
}

export async function awardChallengeRewardInTransaction(input: {
  userId: string;
  challengeInstanceId: string;
  definition: ChallengeDefinitionContract;
  effectiveAt: Date;
  tx: Prisma.TransactionClient;
  database?: PrismaClient;
}): Promise<GamificationRewardResult> {
  const rewardPoints = safeRewardPoints(input.definition.rewardPoints);
  if (rewardPoints === 0) return { rewardPoints: 0, awardedNow: false };

  const ledger = new StudyPointsLedgerService(
    input.database ?? getPrisma() as PrismaClient,
  );
  const result = await ledger.appendStudyPointsLedgerEntry({
    userId: input.userId,
    amount: rewardPoints,
    category: "PROGRESS",
    reasonCode: CHALLENGE_REWARD_REASON,
    sourceType: "GAMIFICATION_REWARD",
    sourceId: input.challengeInstanceId,
    ruleVersion: input.definition.ruleSetVersion,
    idempotencyKey: `gamification:challenge:${input.challengeInstanceId}`,
    effectiveAt: input.effectiveAt,
    metadata: {
      rewardKind: "CHALLENGE",
      challengeDefinitionId: input.definition.id,
      challengeInstanceId: input.challengeInstanceId,
      rewardPoints,
    },
  }, input.tx);
  return { rewardPoints, awardedNow: !result.replayed };
}
