import type { UserGamificationLevel } from "@prisma/client";
import { GamificationError } from "./errors.js";
import type { GamificationLevelView } from "./levelTypes.js";
import type { GamificationRuleSetWithDefinition, LevelDefinition } from "./types.js";
import { assertGamificationLevelDefinitionsChecksum } from "./levelChecksum.js";

export type EvaluatedLifetimeLevel = {
  definition: LevelDefinition;
  nextDefinition: LevelDefinition | null;
  maxLevelReached: boolean;
};

export function evaluateLifetimeLevel(
  lifetimePoints: number,
  definitions: readonly LevelDefinition[],
): EvaluatedLifetimeLevel {
  if (!Number.isSafeInteger(lifetimePoints) || lifetimePoints < 0) {
    throw new GamificationError(
      "GAMIFICATION_LEVEL_POINTS_INVALID",
      "Lifetime Study Points must be a nonnegative safe integer.",
    );
  }
  if (
    definitions.length === 0
    || definitions[0]?.level !== 1
    || definitions[0]?.minimumLifetimePoints !== 0
  ) {
    throw new GamificationError(
      "GAMIFICATION_LEVEL_DEFINITIONS_INVALID",
      "The active rule set must define Level 1 at zero lifetime Points.",
    );
  }
  let currentIndex = 0;
  for (let index = 1; index < definitions.length; index += 1) {
    const definition = definitions[index]!;
    if (definition.minimumLifetimePoints > lifetimePoints) break;
    currentIndex = index;
  }
  const definition = definitions[currentIndex]!;
  const nextDefinition = definitions[currentIndex + 1] ?? null;
  return {
    definition,
    nextDefinition,
    maxLevelReached: nextDefinition === null,
  };
}

function decodeLifetimePoints(value: bigint): number | null {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const decoded = Number(value);
  return Number.isSafeInteger(decoded) ? decoded : null;
}

export function readGamificationLevelView(
  row: UserGamificationLevel,
  rules: GamificationRuleSetWithDefinition,
): GamificationLevelView | null {
  if (
    row.ruleSetVersion !== rules.ruleSet.version
    || row.definitionChecksum !== rules.ruleSet.definitionChecksum
  ) {
    return null;
  }
  try {
    if (
      row.levelDefinitionChecksum
      !== assertGamificationLevelDefinitionsChecksum(
        rules.definitions,
        rules.ruleSet.levelDefinitionChecksum,
      )
    ) {
      return null;
    }
  } catch {
    return null;
  }
  const lifetimePoints = decodeLifetimePoints(row.lifetimePoints);
  if (lifetimePoints === null) return null;
  let evaluated: EvaluatedLifetimeLevel;
  try {
    evaluated = evaluateLifetimeLevel(
      lifetimePoints,
      rules.definitions.levelDefinitions,
    );
  } catch {
    return null;
  }
  if (
    !Number.isSafeInteger(row.level)
    || row.level !== evaluated.definition.level
    || row.maxLevelReached !== evaluated.maxLevelReached
  ) {
    return null;
  }
  return {
    level: evaluated.definition.level,
    ...(evaluated.definition.titleKey
      ? { titleKey: evaluated.definition.titleKey }
      : {}),
    lifetimePoints,
    currentLevelMinimumPoints: evaluated.definition.minimumLifetimePoints,
    nextLevelMinimumPoints:
      evaluated.nextDefinition?.minimumLifetimePoints ?? null,
    pointsIntoLevel:
      lifetimePoints - evaluated.definition.minimumLifetimePoints,
    pointsToNextLevel: evaluated.nextDefinition
      ? evaluated.nextDefinition.minimumLifetimePoints - lifetimePoints
      : null,
    levelProgressRatio: evaluated.nextDefinition
      ? Math.min(
        1,
        Math.max(
          0,
          (lifetimePoints - evaluated.definition.minimumLifetimePoints)
            / (evaluated.nextDefinition.minimumLifetimePoints
              - evaluated.definition.minimumLifetimePoints),
        ),
      )
      : null,
    maxLevelReached: evaluated.maxLevelReached,
    ruleSetVersion: rules.ruleSet.version,
    lastEvaluatedAt: row.lastEvaluatedAt.toISOString(),
  };
}