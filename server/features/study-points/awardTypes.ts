import type { Prisma } from "@prisma/client";
import type {
  StudyPointsCategory,
  StudyPointsSourceType,
} from "./constants.js";
import type { StudyPointsLedgerEntryRecord } from "./types.js";

export type StudyPointsNoAwardReason =
  | "NOT_ELIGIBLE"
  | "INSUFFICIENT_EVIDENCE"
  | "INTEGRITY_BLOCKED"
  | "BELOW_MINIMUM"
  | "CAP_REACHED"
  | "ALREADY_REWARDED"
  | "UNSUPPORTED_SOURCE";

export type SafePointsMetadata = Readonly<Record<
  string,
  string | number | boolean | null
>>;

export type StudyPointsAwardDecision =
  | {
      outcome: "AWARD";
      amount: number;
      category: StudyPointsCategory;
      reasonCode: string;
      ruleVersion: string;
      sourceType: StudyPointsSourceType;
      sourceId: string;
      idempotencyKey: string;
      effectiveAt: Date;
      metadata: SafePointsMetadata;
    }
  | {
      outcome: "NO_AWARD";
      reason: StudyPointsNoAwardReason;
    };

export type StudyPointsAwardAttempt =
  | {
      decision: Extract<StudyPointsAwardDecision, { outcome: "AWARD" }>;
      entry: StudyPointsLedgerEntryRecord;
      replayed: boolean;
    }
  | {
      decision: Extract<StudyPointsAwardDecision, { outcome: "NO_AWARD" }>;
      replayed: false;
    };

export type StudyPointsAwardSourceInput = {
  userId: string;
  sourceType: StudyPointsSourceType;
  sourceId: string;
  now?: Date;
  tx?: Prisma.TransactionClient;
};

export type StudyPointsAwardSourceResult = {
  sourceType: StudyPointsSourceType;
  sourceId: string;
  attempts: StudyPointsAwardAttempt[];
};

export type StudyPointsAwarder = {
  awardStudyPointsForSource(
    input: StudyPointsAwardSourceInput,
  ): Promise<StudyPointsAwardSourceResult>;
};

export type StudyPointsAwardRuleStatus =
  | "ACTIVE"
  | "INACTIVE_UNSUPPORTED"
  | "INACTIVE_LEGACY_CONFLICT";

export type StudyPointsAwardRuleDescriptor = {
  ruleVersion: string;
  category: StudyPointsCategory;
  reasonCode: string;
  sourceType: StudyPointsSourceType;
  status: StudyPointsAwardRuleStatus;
};