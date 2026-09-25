import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { createGamificationMetricProviders, assertMetricProviderValue } from "./metricProviders.js";
import { GAMIFICATION_METRIC_SOURCE_VERSIONS } from "./constants.js";
import { getGamificationMetricDefinition } from "./metricRegistry.js";
import { GamificationError } from "./errors.js";
import type {
  GamificationMetricValue,
} from "./types.js";
import { assertValidStudyPointsUserId } from "../study-points/validation.js";

export async function getGamificationMetricValue(input: {
  userId: string;
  metricId: string;
  asOf: Date;
}, database: PrismaClient = getPrisma() as PrismaClient): Promise<GamificationMetricValue> {
  assertValidStudyPointsUserId(input.userId);
  if (!(input.asOf instanceof Date) || !Number.isSafeInteger(input.asOf.getTime())) {
    throw new GamificationError(
      "GAMIFICATION_INVALID_INPUT",
      "asOf must be a valid Date.",
    );
  }
  const asOf = new Date(input.asOf.getTime());

  const definition = getGamificationMetricDefinition(input.metricId);
  if (!definition.available) {
    throw new GamificationError(
      "GAMIFICATION_METRIC_PROVIDER_UNAVAILABLE",
      definition.unavailableReason
        ?? `No provider is available for ${definition.id}.`,
    );
  }
  const provider = createGamificationMetricProviders(database).get(definition.id);
  if (!provider) {
    throw new GamificationError(
      "GAMIFICATION_METRIC_PROVIDER_UNAVAILABLE",
      `No provider is registered for ${definition.id}.`,
    );
  }
  const value = await provider.readValue(input.userId, asOf);
  assertMetricProviderValue(value, definition.valueType, definition.id);
  return {
    metricId: definition.id,
    value,
    asOf,
    sourceVersion: definition.id.startsWith("points.")
      ? GAMIFICATION_METRIC_SOURCE_VERSIONS.studyPoints
      : definition.id.startsWith("focus.")
        ? GAMIFICATION_METRIC_SOURCE_VERSIONS.focusSession
        : GAMIFICATION_METRIC_SOURCE_VERSIONS.groupFocus,
  };
}