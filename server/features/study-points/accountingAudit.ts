import type { StudyPointsLedgerEntry } from "@prisma/client";
import {
  GROUP_FOCUS_SOCIAL_BONUS_MAX_AWARDS_PER_DAY,
  GROUP_FOCUS_SOCIAL_BONUS_MAX_POINTS_PER_DAY,
} from "./awardRules.js";
import {
  STUDY_POINTS_CATEGORY_DAILY_CAPS,
  STUDY_POINTS_TOTAL_DAILY_CAP,
  studyPointsBaghdadDate,
} from "./caps.js";
import { STUDY_POINTS_CATEGORIES } from "./constants.js";
import { safeStudyPointsSum } from "./aggregate.js";

export type StudyPointsAuditCheck = {
  code: string;
  status: "PASS" | "FAIL";
  occurrences: number;
};

export type StudyPointsAccountingAudit = {
  checks: StudyPointsAuditCheck[];
  anomalyCodes: string[];
  blockingCodes: string[];
  legacyBaselineCount: number;
  legacyBaselinePoints: number;
};

export type StudyPointsAuditEntry = Pick<
  StudyPointsLedgerEntry,
  | "id"
  | "userId"
  | "amount"
  | "category"
  | "reasonCode"
  | "sourceType"
  | "sourceId"
  | "ruleVersion"
  | "effectiveAt"
  | "reversalOfEntryId"
>;

const STRUCTURAL_CODES = new Set([
  "ZERO_VALUE_LEDGER_ENTRY",
  "INVALID_LEDGER_CATEGORY",
  "INVALID_REVERSAL_RELATION",
]);

export function auditStudyPointsLedger(
  entries: readonly StudyPointsAuditEntry[],
  reversalTargets: ReadonlyMap<string, StudyPointsAuditEntry>,
): StudyPointsAccountingAudit {
  const counts = new Map<string, number>();
  const add = (code: string, count = 1) => {
    counts.set(code, (counts.get(code) ?? 0) + count);
  };
  const validCategories = new Set<string>(STUDY_POINTS_CATEGORIES);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const reversalsByOriginal = new Map<string, StudyPointsAuditEntry[]>();
  const sourceAwards = new Map<string, number>();
  const consistencyAwards = new Map<string, number>();
  const dailyCategoryNet = new Map<string, number>();
  const socialBonusAwards = new Map<string, number>();
  const socialBonusNet = new Map<string, number>();
  let baselineCount = 0;
  let baselinePoints = 0;

  for (const entry of entries) {
    if (entry.amount === 0) add("ZERO_VALUE_LEDGER_ENTRY");
    if (!validCategories.has(entry.category)) add("INVALID_LEDGER_CATEGORY");

    if (entry.reversalOfEntryId !== null) {
      const siblings = reversalsByOriginal.get(entry.reversalOfEntryId) ?? [];
      siblings.push(entry);
      reversalsByOriginal.set(entry.reversalOfEntryId, siblings);
      const original = reversalTargets.get(entry.reversalOfEntryId);
      if (
        entry.sourceType !== "REVERSAL"
        || !original
        || original.id !== entry.reversalOfEntryId
        || original.userId !== entry.userId
        || original.sourceType === "REVERSAL"
        || original.sourceType === "LEGACY_POINTS_LOG"
        || original.reversalOfEntryId !== null
        || entry.category !== original.category
        || entry.amount !== -original.amount
        || entry.sourceId !== original.id
      ) {
        add("INVALID_REVERSAL_RELATION");
      }
    } else if (entry.sourceType === "REVERSAL") {
      add("INVALID_REVERSAL_RELATION");
    }

    if (entry.amount < 0 && entry.reversalOfEntryId === null) {
      add("INVALID_REVERSAL_RELATION");
    }

    if (
      entry.sourceType === "LEGACY_POINTS_LOG"
      && entry.reasonCode === "legacy.baseline_import"
    ) {
      baselineCount += 1;
      baselinePoints = safeStudyPointsSum(baselinePoints, entry.amount);
    }

    if (entry.amount > 0 && entry.sourceId) {
      const awardableSource =
        entry.sourceType !== "ADMIN_ADJUSTMENT"
        && entry.sourceType !== "LEGACY_POINTS_LOG"
        && entry.sourceType !== "REVERSAL";
      if (awardableSource) {
        const sourceKey = JSON.stringify([
          entry.userId,
          entry.sourceType,
          entry.sourceId,
          entry.reasonCode,
          entry.ruleVersion,
        ]);
        sourceAwards.set(sourceKey, (sourceAwards.get(sourceKey) ?? 0) + 1);
      }
    }

    const baghdadDate = studyPointsBaghdadDate(entry.effectiveAt);
    if (entry.sourceType === "DAILY_CONSISTENCY") {
      const isPrompt20Consistency =
        entry.reasonCode === "consistency.verified_study_day"
        && entry.ruleVersion === "daily-consistency-v1"
        && entry.amount > 0;
      if (isPrompt20Consistency) {
        const key = `${entry.userId}:${baghdadDate}`;
        consistencyAwards.set(key, (consistencyAwards.get(key) ?? 0) + 1);
      }
    }

    if (validCategories.has(entry.category)) {
      const dayCategoryKey = `${baghdadDate}:${entry.category}`;
      dailyCategoryNet.set(
        dayCategoryKey,
        safeStudyPointsSum(dailyCategoryNet.get(dayCategoryKey) ?? 0, entry.amount),
      );
      if (entry.category === "FOCUS"
        && entry.sourceType === "GROUP_FOCUS_RUN"
        && entry.reasonCode === "group_focus.verified_social_bonus") {
        const socialKey = `${entry.userId}:${baghdadDate}`;
        socialBonusNet.set(
          socialKey,
          safeStudyPointsSum(socialBonusNet.get(socialKey) ?? 0, entry.amount),
        );
        if (entry.amount > 0) {
          socialBonusAwards.set(
            socialKey,
            (socialBonusAwards.get(socialKey) ?? 0) + 1,
          );
        }
      }
      if (entry.reversalOfEntryId) {
        const original = reversalTargets.get(entry.reversalOfEntryId);
        if (
          original
          && original.category === "FOCUS"
          && original.sourceType === "GROUP_FOCUS_RUN"
          && original.reasonCode === "group_focus.verified_social_bonus"
          && studyPointsBaghdadDate(original.effectiveAt) === baghdadDate
        ) {
          const socialKey = `${entry.userId}:${baghdadDate}`;
          socialBonusNet.set(
            socialKey,
            safeStudyPointsSum(socialBonusNet.get(socialKey) ?? 0, entry.amount),
          );
        }
      }
    }
  }

  for (const [originalId, reversals] of reversalsByOriginal) {
    const original = byId.get(originalId) ?? reversalTargets.get(originalId);
    if (reversals.length > 1 || !original || original.sourceType === "REVERSAL") {
      add("INVALID_REVERSAL_RELATION");
    }
  }
  for (const occurrences of sourceAwards.values()) {
    if (occurrences > 1) add("DUPLICATE_SOURCE_AWARD", occurrences - 1);
  }
  for (const occurrences of consistencyAwards.values()) {
    if (occurrences > 1) add("DUPLICATE_DAILY_CONSISTENCY_AWARD", occurrences - 1);
  }
  if (baselineCount > 1) add("DUPLICATE_LEGACY_BASELINE", baselineCount - 1);

  for (const [key, net] of dailyCategoryNet) {
    const category = key.slice(key.lastIndexOf(":") + 1);
    if (net > STUDY_POINTS_CATEGORY_DAILY_CAPS[category as keyof typeof STUDY_POINTS_CATEGORY_DAILY_CAPS]) {
      add("CATEGORY_CAP_EXCEEDED");
    }
  }
  const dailyTotals = new Map<string, number>();
  for (const [key, net] of dailyCategoryNet) {
    const separator = key.lastIndexOf(":");
    const date = key.slice(0, separator);
    dailyTotals.set(date, safeStudyPointsSum(dailyTotals.get(date) ?? 0, net));
  }
  for (const total of dailyTotals.values()) {
    if (total > STUDY_POINTS_TOTAL_DAILY_CAP) add("TOTAL_DAILY_CAP_EXCEEDED");
  }
  for (const [key, count] of socialBonusAwards) {
    const net = socialBonusNet.get(key) ?? 0;
    if (
      count > GROUP_FOCUS_SOCIAL_BONUS_MAX_AWARDS_PER_DAY
      || net > GROUP_FOCUS_SOCIAL_BONUS_MAX_POINTS_PER_DAY
    ) {
      add("SOCIAL_BONUS_DAILY_CAP_EXCEEDED");
    }
  }

  const checks = [
    "ZERO_VALUE_LEDGER_ENTRY",
    "INVALID_LEDGER_CATEGORY",
    "INVALID_REVERSAL_RELATION",
    "DUPLICATE_SOURCE_AWARD",
    "DUPLICATE_DAILY_CONSISTENCY_AWARD",
    "DUPLICATE_LEGACY_BASELINE",
    "CATEGORY_CAP_EXCEEDED",
    "TOTAL_DAILY_CAP_EXCEEDED",
    "SOCIAL_BONUS_DAILY_CAP_EXCEEDED",
  ].map((code) => ({
    code,
    status: counts.has(code) ? "FAIL" as const : "PASS" as const,
    occurrences: counts.get(code) ?? 0,
  }));
  const anomalyCodes = checks
    .filter((check) => check.status === "FAIL")
    .map((check) => check.code);
  return {
    checks,
    anomalyCodes,
    blockingCodes: anomalyCodes.filter((code) => STRUCTURAL_CODES.has(code)),
    legacyBaselineCount: baselineCount,
    legacyBaselinePoints: baselinePoints,
  };
}