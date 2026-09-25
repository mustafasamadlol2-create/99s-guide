import type { Prisma } from "@prisma/client";
import {
  STUDY_POINTS_CATEGORIES,
  STUDY_POINTS_MAX_ENTRY_AMOUNT,
  STUDY_POINTS_SOURCE_TYPES,
  type StudyPointsCategory,
  type StudyPointsSourceType,
} from "./constants.js";
import { StudyPointsError } from "./errors.js";
import { normalizeStudyPointsMetadata } from "./metadata.js";
import type { AppendStudyPointsLedgerEntryInput } from "./types.js";

export type NormalizedStudyPointsLedgerInput = {
  userId: string;
  amount: number;
  category: StudyPointsCategory;
  reasonCode: string;
  sourceType: StudyPointsSourceType;
  sourceId: string | null;
  ruleVersion: string;
  idempotencyKey: string;
  effectiveAt: Date;
  metadata?: Prisma.InputJsonValue;
};

function assertBoundedString(
  value: unknown,
  maximum: number,
  code: "POINTS_INVALID_SOURCE" | "POINTS_INVALID_REASON_CODE" |
    "POINTS_INVALID_RULE_VERSION" | "POINTS_INVALID_IDEMPOTENCY_KEY",
  message: string,
): asserts value is string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.trim() !== value
    || Array.from(value).length > maximum
    || value.includes("\0")
  ) {
    throw new StudyPointsError(code, message);
  }
}

export function assertValidStudyPointsUserId(userId: unknown): asserts userId is string {
  assertBoundedString(
    userId,
    128,
    "POINTS_INVALID_SOURCE",
    "Study Points user ID is invalid.",
  );
}

export function normalizeStudyPointsLedgerInput(
  input: AppendStudyPointsLedgerEntryInput,
): NormalizedStudyPointsLedgerInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new StudyPointsError(
      "POINTS_INVALID_SOURCE",
      "Study Points ledger entry input is invalid.",
    );
  }

  assertValidStudyPointsUserId(input.userId);
  if (
    !Number.isSafeInteger(input.amount)
    || input.amount === 0
    || Math.abs(input.amount) > STUDY_POINTS_MAX_ENTRY_AMOUNT
  ) {
    throw new StudyPointsError(
      "POINTS_INVALID_AMOUNT",
      `Study Points amount must be a nonzero integer between -${STUDY_POINTS_MAX_ENTRY_AMOUNT} and ${STUDY_POINTS_MAX_ENTRY_AMOUNT}.`,
    );
  }

  if (!(STUDY_POINTS_CATEGORIES as readonly string[]).includes(input.category)) {
    throw new StudyPointsError(
      "POINTS_INVALID_CATEGORY",
      "Study Points category is invalid.",
    );
  }
  assertBoundedString(
    input.reasonCode,
    96,
    "POINTS_INVALID_REASON_CODE",
    "Study Points reason code is invalid.",
  );
  if (!/^[a-z][a-z0-9]*([._-][a-z0-9]+)*$/u.test(input.reasonCode)) {
    throw new StudyPointsError(
      "POINTS_INVALID_REASON_CODE",
      "Study Points reason code must be a stable machine-readable identifier.",
    );
  }
  if (
    !(STUDY_POINTS_SOURCE_TYPES as readonly string[]).includes(input.sourceType)
    || input.sourceType === "REVERSAL"
  ) {
    throw new StudyPointsError(
      "POINTS_INVALID_SOURCE",
      "Study Points source type is invalid for a direct append.",
    );
  }
  const sourceId = input.sourceId ?? null;
  if (sourceId !== null) {
    assertBoundedString(
      sourceId,
      128,
      "POINTS_INVALID_SOURCE",
      "Study Points source ID is invalid.",
    );
  }
  assertBoundedString(
    input.ruleVersion,
    128,
    "POINTS_INVALID_RULE_VERSION",
    "Study Points rule version is invalid.",
  );
  assertBoundedString(
    input.idempotencyKey,
    200,
    "POINTS_INVALID_IDEMPOTENCY_KEY",
    "Study Points idempotency key is invalid.",
  );
  if (
    !(input.effectiveAt instanceof Date)
    || !Number.isSafeInteger(input.effectiveAt.getTime())
    || input.effectiveAt.getTime() < 0
  ) {
    throw new StudyPointsError(
      "POINTS_INVALID_SOURCE",
      "Study Points effective time is invalid.",
    );
  }

  const metadata = normalizeStudyPointsMetadata(input.metadata);
  return {
    userId: input.userId,
    amount: input.amount,
    category: input.category,
    reasonCode: input.reasonCode,
    sourceType: input.sourceType,
    sourceId,
    ruleVersion: input.ruleVersion,
    idempotencyKey: input.idempotencyKey,
    effectiveAt: new Date(input.effectiveAt.getTime()),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}