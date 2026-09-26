import type { Prisma, PrismaClient } from "@prisma/client";
import {
  getActiveGamificationRuleSet,
  getGamificationRuleSetVersion,
} from "./ruleSetService.js";
import { GamificationError } from "./errors.js";

type ReadDatabase = PrismaClient | Prisma.TransactionClient;

function mapMissingChallengeBundle(error: unknown): never {
  if (
    error instanceof GamificationError
    && (
      error.code === "GAMIFICATION_RULE_VERSION_NOT_FOUND"
      || error.code === "GAMIFICATION_DEFINITION_BUNDLE_NOT_FOUND"
    )
  ) {
    throw new GamificationError(
      "GAMIFICATION_CHALLENGE_DEFINITION_VERSION_NOT_FOUND",
      "The Challenge instance references a rule-set version without a source bundle.",
    );
  }
  throw error;
}

export async function getChallengeRuleSetVersion(
  version: string,
  database: ReadDatabase,
) {
  try {
    return await getGamificationRuleSetVersion(version, database);
  } catch (error) {
    return mapMissingChallengeBundle(error);
  }
}

export async function getActiveChallengeRuleSet(
  database: ReadDatabase,
) {
  try {
    return await getActiveGamificationRuleSet(database);
  } catch (error) {
    return mapMissingChallengeBundle(error);
  }
}