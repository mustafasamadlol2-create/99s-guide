import { createHash } from "node:crypto";
import { canonicalJson } from "../study-core/canonicalJson.js";
import type { StudyPointsCategory, StudyPointsSourceType } from "./constants.js";

function digest(parts: readonly string[]): string {
  return createHash("sha256")
    .update(canonicalJson(parts), "utf8")
    .digest("hex");
}

export function studyPointsAwardIdempotencyKey(input: {
  userId: string;
  sourceType: StudyPointsSourceType;
  sourceId: string;
  ruleVersion: string;
  reasonCode: string;
}): string {
  return `points:v1:${digest([
    input.userId,
    input.sourceType,
    input.sourceId,
    input.ruleVersion,
    input.reasonCode,
  ])}`;
}

export function studyPointsConsistencyIdempotencyKey(input: {
  userId: string;
  baghdadDate: string;
  ruleVersion: string;
}): string {
  return `points:v1:${digest([
    "daily-consistency",
    input.userId,
    input.baghdadDate,
    input.ruleVersion,
  ])}`;
}

export function studyPointsExistingEntryMatchesRule(
  existing: {
    userId: string;
    category: string;
    reasonCode: string;
    sourceType: string;
    sourceId: string | null;
    ruleVersion: string;
    effectiveAt: Date;
    metadata: unknown;
  },
  expected: {
    userId: string;
    category: StudyPointsCategory;
    reasonCode: string;
    sourceType: StudyPointsSourceType;
    sourceId: string;
    ruleVersion: string;
    effectiveAt: Date;
    baseRuleAmount: number;
    canonicalDurationSeconds?: number;
    baghdadDate: string;
  },
  requireSameEffectiveAt = true,
): boolean {
  if (
    existing.userId !== expected.userId
    || existing.category !== expected.category
    || existing.reasonCode !== expected.reasonCode
    || existing.sourceType !== expected.sourceType
    || existing.sourceId !== expected.sourceId
    || existing.ruleVersion !== expected.ruleVersion
    || (requireSameEffectiveAt
      && existing.effectiveAt.getTime() !== expected.effectiveAt.getTime())
  ) {
    return false;
  }
  if (!existing.metadata || typeof existing.metadata !== "object" || Array.isArray(existing.metadata)) {
    return false;
  }
  const metadata = existing.metadata as Record<string, unknown>;
  const durationMatches =
    expected.sourceType === "DAILY_CONSISTENCY"
    || expected.canonicalDurationSeconds === undefined
    || metadata.canonicalDurationSeconds === expected.canonicalDurationSeconds;
  return metadata.baseRuleAmount === expected.baseRuleAmount
    && metadata.BaghdadDate === expected.baghdadDate
    && durationMatches;
}