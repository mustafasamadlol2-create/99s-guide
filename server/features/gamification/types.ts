import type {
  GamificationRuleSet,
  Prisma,
} from "@prisma/client";
import type { StudyPointsCategory } from "../study-points/constants.js";

export type GamificationPrivacyClass =
  | "PRIVATE_STUDY"
  | "PROFILE_PUBLIC"
  | "SYSTEM_INTERNAL"
  | "ADMIN_SECURITY";

export type GamificationMetricValueType = "INTEGER" | "BOOLEAN";

export type GamificationMetricDefinition = {
  id: string;
  valueType: GamificationMetricValueType;
  aggregation: string;
  sourceAuthority: string;
  privacyClass: GamificationPrivacyClass;
  available: boolean;
  unavailableReason?: string;
};

export type GamificationMetricValue = {
  metricId: string;
  value: number | boolean;
  asOf: Date;
  sourceVersion: string;
};

export type GamificationMetricProvider = {
  readValue(
    userId: string,
    asOf: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<number | boolean>;
};

export type AchievementVisibility = "PRIVATE" | "PROFILE_SAFE";
export type AchievementTier = "BRONZE" | "SILVER" | "GOLD";

export type AchievementDefinition = {
  id: string;
  ruleSetVersion: string;
  metricId: string;
  threshold: number | boolean;
  tier?: AchievementTier;
  titleKey: string;
  descriptionKey: string;
  visibility: AchievementVisibility;
  sortOrder: number;
};

export type LevelDefinition = {
  level: number;
  minimumLifetimePoints: number;
  titleKey?: string;
};

export type ChallengeEnrollmentPolicy = "AUTO" | "MANUAL";
export type ChallengeWindowPolicy = "WEEKLY";
export type ChallengeVisibility = "PRIVATE_STUDY";

export type ChallengeDefinitionContract = {
  id: string;
  ruleSetVersion: string;
  metricId: string;
  target: number;
  enrollmentPolicy: ChallengeEnrollmentPolicy;
  windowPolicy: ChallengeWindowPolicy;
  titleKey: string;
  descriptionKey: string;
  visibility: ChallengeVisibility;
  sortOrder: number;
};

export type GamificationLeaderboardPeriod =
  | "WEEKLY"
  | "MONTHLY"
  | "ALL_TIME";

export type LeaderboardDefinitionContract = {
  id: string;
  ruleSetVersion: string;
  period: GamificationLeaderboardPeriod;
  scoreMetricId: string;
};

export type GamificationDefinitionBundle = {
  version: string;
  schemaVersion: number;
  pointCategories: readonly StudyPointsCategory[];
  achievementDefinitions: readonly AchievementDefinition[];
  levelDefinitions: readonly LevelDefinition[];
  challengeDefinitionContracts: readonly ChallengeDefinitionContract[];
  leaderboardDefinitionContracts: readonly LeaderboardDefinitionContract[];
};

export type GamificationRuleSetWithDefinition = {
  ruleSet: GamificationRuleSet;
  definitions: GamificationDefinitionBundle;
};

export type GamificationMetricDatabase =
  | Prisma.TransactionClient
  | import("@prisma/client").PrismaClient;