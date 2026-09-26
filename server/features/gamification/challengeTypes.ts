import type { ChallengeInstance, UserChallengeProgress } from "@prisma/client";
import type { ChallengePeriod } from "./challengeInstances.js";

export type UserChallengeStatus = "ACTIVE" | "COMPLETED" | "EXPIRED" | "LEFT";
export type ChallengeInstanceStatus =
  | "UPCOMING"
  | "ACTIVE"
  | "ENDED"
  | "CANCELLED";

export type UserChallengeProgressWithInstance = UserChallengeProgress & {
  instance: ChallengeInstance;
};

export type ChallengeSummaryItem = {
  instanceId: string;
  definitionId: string;
  ruleSetVersion: string;
  periodKey: string;
  titleKey: string;
  descriptionKey: string;
  metricId: string;
  current: number;
  target: number;
  progressRatio: number;
  status: UserChallengeStatus;
  startsAt: Date;
  endsAt: Date;
  completedAt: Date | null;
  expiredAt: Date | null;
};

export type MyChallengesResponse = {
  ruleSetVersion: string;
  currentPeriod: ChallengePeriod;
  active: ChallengeSummaryItem[];
  recent: ChallengeSummaryItem[];
};

export type ChallengeReconciliationCheck = {
  status:
    | "MISSING_INSTANCE"
    | "MISSING_PROGRESS"
    | "STALE_PROGRESS"
    | "WRONG_TARGET"
    | "WRONG_METRIC"
    | "WRONG_RULE_VERSION"
    | "INVALID_STATUS"
    | "MISSED_COMPLETION"
    | "MISSED_EXPIRY";
  challengeDefinitionId: string;
  instanceId?: string;
  progressId?: string;
  expected?: string | number;
  stored?: string | number | null;
};