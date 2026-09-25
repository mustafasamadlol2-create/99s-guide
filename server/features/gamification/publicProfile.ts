import type { PrismaClient, UserAchievement } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { assertDefinitionFitsUnlock } from "./achievementValues.js";
import { GamificationError } from "./errors.js";
import { readGamificationLevelView } from "./levelMath.js";
import type {
  PublicGamificationAchievement,
  PublicGamificationProfile,
} from "./levelTypes.js";
import {
  getActiveGamificationRuleSet,
  getGamificationRuleSetVersion,
} from "./ruleSetService.js";
import type { AchievementDefinition } from "./types.js";

const MAX_PUBLIC_ACHIEVEMENTS = 20;

export function isProfileAchievementVisible(
  visibilityAtUnlock: AchievementDefinition["visibility"],
  currentVisibility: AchievementDefinition["visibility"] | undefined,
): boolean {
  return visibilityAtUnlock === "PROFILE_SAFE"
    && (currentVisibility === undefined || currentVisibility === "PROFILE_SAFE");
}

export function projectPublicAchievementUnlocks(
  unlockRows: readonly UserAchievement[],
  historicalRules: ReadonlyMap<
    string,
    Awaited<ReturnType<typeof getGamificationRuleSetVersion>>
  >,
  currentDefinitions: readonly AchievementDefinition[],
): PublicGamificationAchievement[] {
  const currentById = new Map(
    currentDefinitions.map((definition) => [definition.id, definition]),
  );
  const publicAchievements: Array<{
    definition: AchievementDefinition;
    view: PublicGamificationAchievement;
  }> = [];

  for (const unlock of unlockRows) {
    const historical = historicalRules.get(unlock.unlockedUnderRuleSetVersion);
    if (!historical) {
      throw new GamificationError(
        "GAMIFICATION_ACHIEVEMENT_RECORD_INVALID",
        `Unlock ${unlock.achievementId} has no verified rule-set version.`,
      );
    }
    const historicalDefinition = assertDefinitionFitsUnlock(unlock, historical);
    const currentDefinition = currentById.get(unlock.achievementId);
    if (
      !isProfileAchievementVisible(
        historicalDefinition.visibility,
        currentDefinition?.visibility,
      )
    ) {
      continue;
    }
    const displayDefinition = currentDefinition ?? historicalDefinition;
    publicAchievements.push({
      definition: displayDefinition,
      view: {
        achievementId: unlock.achievementId,
        titleKey: displayDefinition.titleKey,
        descriptionKey: displayDefinition.descriptionKey,
        unlockedAt: unlock.unlockedAt.toISOString(),
      },
    });
  }

  publicAchievements.sort((left, right) =>
    left.definition.sortOrder - right.definition.sortOrder
    || left.view.unlockedAt.localeCompare(right.view.unlockedAt)
    || left.view.achievementId.localeCompare(right.view.achievementId)
  );
  return publicAchievements
    .slice(0, MAX_PUBLIC_ACHIEVEMENTS)
    .map(({ view }) => view);
}

export async function getPublicGamificationProfile(
  viewerId: string,
  profileUserId: string,
  database: PrismaClient = getPrisma() as PrismaClient,
): Promise<PublicGamificationProfile | null> {
  if (!viewerId || !profileUserId) {
    throw new GamificationError(
      "GAMIFICATION_INVALID_INPUT",
      "Viewer and profile user IDs are required.",
    );
  }
  const profileUser = await database.user.findUnique({
    where: { id: profileUserId },
    select: { id: true, accountStatus: true },
  });
  if (
    !profileUser
    || String(profileUser.accountStatus).toUpperCase() !== "ACTIVE"
  ) {
    return null;
  }

  const block = await database.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: viewerId, blockedId: profileUserId },
        { blockerId: profileUserId, blockedId: viewerId },
      ],
    },
    select: { id: true },
  });
  if (block) return null;

  const rules = await getActiveGamificationRuleSet(database);
  const levelRow = await database.userGamificationLevel.findUnique({
    where: { userId: profileUserId },
  });
  if (!levelRow) return null;
  const level = readGamificationLevelView(levelRow, rules);
  if (!level) return null;

  const unlockRows = await database.userAchievement.findMany({
    where: { userId: profileUserId },
    orderBy: [{ unlockedAt: "asc" }, { achievementId: "asc" }],
  });
  const versions = [...new Set(
    unlockRows.map((unlock) => unlock.unlockedUnderRuleSetVersion),
  )];
  const historicalRules = new Map<string, Awaited<
    ReturnType<typeof getGamificationRuleSetVersion>
  >>();
  for (const version of versions) {
    historicalRules.set(
      version,
      await getGamificationRuleSetVersion(version, database),
    );
  }

  return {
    level: level.level,
    ...(level.titleKey ? { titleKey: level.titleKey } : {}),
    maxLevelReached: level.maxLevelReached,
    achievements: projectPublicAchievementUnlocks(
      unlockRows,
      historicalRules,
      rules.definitions.achievementDefinitions,
    ),
  };
}

export { MAX_PUBLIC_ACHIEVEMENTS };