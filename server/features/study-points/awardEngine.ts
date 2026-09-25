import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import type { StudyEventSource } from "../study-core/events.js";
import { INTEGRITY_ACTION_TYPES } from "../study-integrity/constants.js";
import type { StudyPointsCategory, StudyPointsSourceType } from "./constants.js";
import { getStudyPointsBaghdadDayBounds, getStudyPointsDailyUsage, getGroupSocialBonusCount, STUDY_POINTS_CATEGORY_DAILY_CAPS, STUDY_POINTS_TOTAL_DAILY_CAP, studyPointsBaghdadDate, studyPointsDailyCapLockKey } from "./caps.js";
import {
  DAILY_CONSISTENCY_AMOUNT,
  DAILY_CONSISTENCY_MINIMUM_SECONDS,
  DAILY_CONSISTENCY_RULE,
  FOCUS_COMPLETION_RULE,
  GROUP_FOCUS_SOCIAL_BONUS_AMOUNT,
  GROUP_FOCUS_SOCIAL_BONUS_MAX_AWARDS_PER_DAY,
  GROUP_FOCUS_SOCIAL_BONUS_MAX_POINTS_PER_DAY,
  GROUP_FOCUS_SOCIAL_BONUS_MINIMUM_SECONDS,
  GROUP_FOCUS_SOCIAL_BONUS_RULE,
  GROUP_FOCUS_PARTICIPATION_RULE,
  focusCompletionAmount,
} from "./awardRules.js";
import type {
  SafePointsMetadata,
  StudyPointsAwardAttempt,
  StudyPointsAwardDecision,
  StudyPointsAwardRuleDescriptor,
  StudyPointsAwardSourceInput,
  StudyPointsAwardSourceResult,
  StudyPointsNoAwardReason,
} from "./awardTypes.js";
import { studyPointsConsistencyIdempotencyKey, studyPointsAwardIdempotencyKey, studyPointsExistingEntryMatchesRule } from "./idempotency.js";
import { getStudyPointsIntegrityFailure } from "./integrityGate.js";
import { lockStudyPointsKeys } from "./locks.js";
import { StudyPointsLedgerService } from "./ledger.js";
import { StudyPointsError } from "./errors.js";
import { getEligibleBaghdadDayFocusSeconds } from "./sources/consistency.js";
import { loadCompletedFocusSource } from "./sources/focus.js";
import { loadGroupFocusSource } from "./sources/groupFocus.js";
import type { StudyPointsLedgerEntryRecord } from "./types.js";

const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

function noAward(reason: StudyPointsNoAwardReason): StudyPointsAwardAttempt {
  return {
    decision: { outcome: "NO_AWARD", reason },
    replayed: false,
  };
}

function metadataObject(value: unknown): SafePointsMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      item === null
      || typeof item === "string"
      || typeof item === "boolean"
      || (typeof item === "number" && Number.isFinite(item))
    ) {
      safe[key] = item;
    }
  }
  return safe;
}

function decisionFromEntry(
  row: StudyPointsLedgerEntryRecord,
): Extract<StudyPointsAwardDecision, { outcome: "AWARD" }> {
  return {
    outcome: "AWARD",
    amount: row.amount,
    category: row.category as StudyPointsCategory,
    reasonCode: row.reasonCode,
    ruleVersion: row.ruleVersion,
    sourceType: row.sourceType as StudyPointsSourceType,
    sourceId: row.sourceId ?? "",
    idempotencyKey: row.idempotencyKey,
    effectiveAt: row.effectiveAt,
    metadata: metadataObject(row.metadata),
  };
}

type CanonicalRuleSource = {
  userId: string;
  sourceId: string;
  sourceType: "FOCUS_SESSION" | "GROUP_FOCUS_RUN";
  effectiveAt: Date;
  evidenceClass: string;
  source: StudyEventSource;
  actionType: string;
  resource: { kind: string; id: string };
  durationSeconds: number;
};

export class StudyPointsAwardEngine {
  private readonly ledger: StudyPointsLedgerService;

  constructor(
    private readonly database: PrismaClient = getPrisma() as PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.ledger = new StudyPointsLedgerService(database);
  }

  async awardStudyPointsForSource(
    input: StudyPointsAwardSourceInput,
  ): Promise<StudyPointsAwardSourceResult> {
    if (
      !input
      || typeof input.userId !== "string"
      || input.userId.length < 1
      || input.userId.length > 128
      || input.userId.includes("\0")
      || typeof input.sourceId !== "string"
      || input.sourceId.length < 1
      || input.sourceId.length > 128
      || input.sourceId.includes("\0")
    ) {
      throw new TypeError("Study Points source identifiers are invalid.");
    }
    const now = input.now ?? this.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new TypeError("Study Points server time is invalid.");
    }
    const perform = (tx: Prisma.TransactionClient) =>
      this.awardWithinTransaction(tx, input, now);
    const result = input.tx
      ? await perform(input.tx)
      : await this.database.$transaction(perform, TRANSACTION_OPTIONS);
    return result;
  }

  private async awardWithinTransaction(
    tx: Prisma.TransactionClient,
    input: StudyPointsAwardSourceInput,
    now: Date,
  ): Promise<StudyPointsAwardSourceResult> {
    if (input.sourceType === "FOCUS_SESSION") {
      const loaded = await loadCompletedFocusSource(tx, input.userId, input.sourceId);
      if (!("source" in loaded)) {
        return {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          attempts: [noAward(loaded.reason)],
        };
      }
      const source: CanonicalRuleSource = {
        ...loaded.source,
        sourceType: "FOCUS_SESSION",
        durationSeconds: loaded.source.activeSeconds,
      };
      const integrityFailure = await getStudyPointsIntegrityFailure(tx, {
        userId: source.userId,
        actionType: source.actionType,
        source: source.source,
        evidenceClass: source.evidenceClass,
        occurredAt: source.effectiveAt,
        now,
        resource: source.resource,
      });
      if (integrityFailure) {
        return {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          attempts: [noAward(integrityFailure)],
        };
      }

      const amount = focusCompletionAmount(source.durationSeconds);
      const attempts: StudyPointsAwardAttempt[] = [
        amount === null
          ? noAward("BELOW_MINIMUM")
          : await this.appendCappedAward(tx, {
            userId: source.userId,
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            effectiveAt: source.effectiveAt,
            rule: FOCUS_COMPLETION_RULE,
            baseRuleAmount: amount,
            baghdadDate: studyPointsBaghdadDate(source.effectiveAt),
            now,
            canonicalDurationSeconds: source.durationSeconds,
          }),
      ];
      attempts.push(await this.evaluateConsistency(tx, source, now));
      return { sourceType: input.sourceType, sourceId: input.sourceId, attempts };
    }

    if (input.sourceType === "GROUP_FOCUS_RUN") {
      const loaded = await loadGroupFocusSource(tx, input.userId, input.sourceId);
      if (!("source" in loaded)) {
        return {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          attempts: [
            noAward(loaded.reason),
            noAward(loaded.reason),
          ],
        };
      }
      const source: CanonicalRuleSource = {
        userId: loaded.source.userId,
        sourceId: loaded.source.sourceId,
        sourceType: "GROUP_FOCUS_RUN",
        effectiveAt: loaded.source.effectiveAt,
        evidenceClass: loaded.source.evidenceClass,
        source: loaded.source.source,
        actionType: loaded.source.actionType,
        resource: loaded.source.resource,
        durationSeconds: loaded.source.verifiedFocusSeconds,
      };
      const integrityFailure = await getStudyPointsIntegrityFailure(tx, {
        userId: source.userId,
        actionType: source.actionType,
        source: source.source,
        evidenceClass: source.evidenceClass,
        occurredAt: source.effectiveAt,
        now,
        resource: source.resource,
      });
      if (integrityFailure) {
        return {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          attempts: [noAward(integrityFailure), noAward(integrityFailure)],
        };
      }

      const baseAmount = focusCompletionAmount(source.durationSeconds);
      const baghdadDate = studyPointsBaghdadDate(source.effectiveAt);
      const attempts: StudyPointsAwardAttempt[] = [
        baseAmount === null
          ? noAward("BELOW_MINIMUM")
          : await this.appendCappedAward(tx, {
            userId: source.userId,
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            effectiveAt: source.effectiveAt,
            rule: GROUP_FOCUS_PARTICIPATION_RULE,
            baseRuleAmount: baseAmount,
            baghdadDate,
            now,
            canonicalDurationSeconds: source.durationSeconds,
          }),
        source.durationSeconds < GROUP_FOCUS_SOCIAL_BONUS_MINIMUM_SECONDS
          ? noAward("BELOW_MINIMUM")
          : await this.appendCappedAward(tx, {
            userId: source.userId,
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            effectiveAt: source.effectiveAt,
            rule: GROUP_FOCUS_SOCIAL_BONUS_RULE,
            baseRuleAmount: GROUP_FOCUS_SOCIAL_BONUS_AMOUNT,
            baghdadDate,
            now,
            canonicalDurationSeconds: source.durationSeconds,
            maxAwardsPerDay: GROUP_FOCUS_SOCIAL_BONUS_MAX_AWARDS_PER_DAY,
            maxPointsPerDay: GROUP_FOCUS_SOCIAL_BONUS_MAX_POINTS_PER_DAY,
          }),
      ];
      attempts.push(await this.evaluateConsistency(tx, source, now));
      return { sourceType: input.sourceType, sourceId: input.sourceId, attempts };
    }

    return {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      attempts: [noAward("UNSUPPORTED_SOURCE")],
    };
  }

  private async evaluateConsistency(
    tx: Prisma.TransactionClient,
    source: CanonicalRuleSource,
    now: Date,
  ): Promise<StudyPointsAwardAttempt> {
    const baghdadDate = studyPointsBaghdadDate(source.effectiveAt);
    const totalSeconds = await getEligibleBaghdadDayFocusSeconds(
      tx,
      source.userId,
      baghdadDate,
      now,
    );
    if (totalSeconds < DAILY_CONSISTENCY_MINIMUM_SECONDS) {
      return noAward("BELOW_MINIMUM");
    }
    return this.appendCappedAward(tx, {
      userId: source.userId,
      sourceType: "DAILY_CONSISTENCY",
      sourceId: baghdadDate,
      effectiveAt: source.effectiveAt,
      rule: DAILY_CONSISTENCY_RULE,
      baseRuleAmount: DAILY_CONSISTENCY_AMOUNT,
      baghdadDate,
      now,
      canonicalDurationSeconds: totalSeconds,
      consistencyIdempotencyKey: studyPointsConsistencyIdempotencyKey({
        userId: source.userId,
        baghdadDate,
        ruleVersion: DAILY_CONSISTENCY_RULE.ruleVersion,
      }),
      compareEffectiveAtOnReplay: false,
    });
  }

  private async appendCappedAward(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      sourceType: StudyPointsAwardRuleDescriptor["sourceType"];
      sourceId: string;
      effectiveAt: Date;
      rule: StudyPointsAwardRuleDescriptor;
      baseRuleAmount: number;
      baghdadDate: string;
      now: Date;
      canonicalDurationSeconds?: number;
      maxAwardsPerDay?: number;
      maxPointsPerDay?: number;
      consistencyIdempotencyKey?: string;
      compareEffectiveAtOnReplay?: boolean;
    },
  ): Promise<StudyPointsAwardAttempt> {
    if (input.effectiveAt > input.now) return noAward("NOT_ELIGIBLE");
    const idempotencyKey = input.consistencyIdempotencyKey
      ?? studyPointsAwardIdempotencyKey({
        userId: input.userId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        ruleVersion: input.rule.ruleVersion,
        reasonCode: input.rule.reasonCode,
      });
    await lockStudyPointsKeys(tx, [
      studyPointsDailyCapLockKey(input.userId, input.baghdadDate),
    ]);

    const where = {
      userId_idempotencyKey: {
        userId: input.userId,
        idempotencyKey,
      },
    };
    const existing = await tx.studyPointsLedgerEntry.findUnique({ where });
    if (existing) {
      if (!studyPointsExistingEntryMatchesRule(existing, {
        userId: input.userId,
        category: input.rule.category,
        reasonCode: input.rule.reasonCode,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        ruleVersion: input.rule.ruleVersion,
        effectiveAt: input.effectiveAt,
        baseRuleAmount: input.baseRuleAmount,
        ...(input.canonicalDurationSeconds !== undefined
          ? { canonicalDurationSeconds: input.canonicalDurationSeconds }
          : {}),
        baghdadDate: input.baghdadDate,
      }, input.compareEffectiveAtOnReplay !== false)) {
        throw new StudyPointsError(
          "POINTS_IDEMPOTENCY_CONFLICT",
          "Study Points idempotency key conflicts with canonical reward data.",
        );
      }
      return {
        decision: decisionFromEntry(existing),
        entry: existing,
        replayed: true,
      };
    }

    const bounds = await getStudyPointsBaghdadDayBounds(tx, input.baghdadDate);
    if (input.maxAwardsPerDay !== undefined) {
      const count = await getGroupSocialBonusCount(tx, input.userId, bounds);
      if (count >= input.maxAwardsPerDay) return noAward("CAP_REACHED");
    }
    const usage = await getStudyPointsDailyUsage(tx, input.userId, bounds);
    const dailyCap = STUDY_POINTS_CATEGORY_DAILY_CAPS[input.rule.category];
    const categoryRemaining = dailyCap - usage.byCategory[input.rule.category];
    const totalRemaining = STUDY_POINTS_TOTAL_DAILY_CAP - usage.total;
    const specialRemaining = input.maxPointsPerDay === undefined
      ? Number.POSITIVE_INFINITY
      : input.maxPointsPerDay - await this.groupSocialPointsUsed(tx, input.userId, bounds);
    const remainingBeforeAward = Math.min(
      categoryRemaining,
      totalRemaining,
      specialRemaining,
    );
    if (remainingBeforeAward <= 0) return noAward("CAP_REACHED");
    const amount = Math.min(input.baseRuleAmount, remainingBeforeAward);
    const metadata: SafePointsMetadata = {
      baseRuleAmount: input.baseRuleAmount,
      awardedAmount: amount,
      capAdjustedAmount: amount,
      dailyCap,
      remainingBeforeAward,
      totalDailyCap: STUDY_POINTS_TOTAL_DAILY_CAP,
      remainingTotalBeforeAward: totalRemaining,
      BaghdadDate: input.baghdadDate,
      ...(input.canonicalDurationSeconds !== undefined
        ? { canonicalDurationSeconds: input.canonicalDurationSeconds }
        : {}),
    };
    const appended = await this.ledger.appendStudyPointsLedgerEntry({
      userId: input.userId,
      amount,
      category: input.rule.category,
      reasonCode: input.rule.reasonCode,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      ruleVersion: input.rule.ruleVersion,
      idempotencyKey,
      effectiveAt: input.effectiveAt,
      metadata,
    }, tx);
    const decision: StudyPointsAwardDecision = {
      outcome: "AWARD",
      amount,
      category: input.rule.category,
      reasonCode: input.rule.reasonCode,
      ruleVersion: input.rule.ruleVersion,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      idempotencyKey,
      effectiveAt: input.effectiveAt,
      metadata,
    };
    return {
      decision,
      entry: appended.entry,
      replayed: appended.replayed,
    };
  }

  private async groupSocialPointsUsed(
    tx: Prisma.TransactionClient,
    userId: string,
    bounds: { start: Date; end: Date },
  ): Promise<number> {
    const originals = await tx.studyPointsLedgerEntry.findMany({
      where: {
        userId,
        category: "FOCUS",
        reasonCode: GROUP_FOCUS_SOCIAL_BONUS_RULE.reasonCode,
        sourceType: "GROUP_FOCUS_RUN",
        effectiveAt: { gte: bounds.start, lt: bounds.end },
      },
      select: { id: true, amount: true },
    });
    if (originals.length === 0) return 0;
    const reversals = await tx.studyPointsLedgerEntry.findMany({
      where: {
        userId,
        reversalOfEntryId: { in: originals.map((entry) => entry.id) },
        effectiveAt: { gte: bounds.start, lt: bounds.end },
      },
      select: { amount: true },
    });
    let net = 0;
    for (const entry of [...originals, ...reversals]) {
      if (!Number.isSafeInteger(entry.amount)) {
        throw new Error("Group Focus social bonus total is outside the safe integer range.");
      }
      net += entry.amount;
      if (!Number.isSafeInteger(net)) {
        throw new Error("Group Focus social bonus total is outside the safe integer range.");
      }
    }
    return Math.max(0, net);
  }
}