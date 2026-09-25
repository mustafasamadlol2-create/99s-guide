import type {
  PointsLog,
  StudyPointsLedgerEntry as DbStudyPointsLedgerEntry,
} from "@prisma/client";
import type {
  StudyPointsCategory,
  StudyPointsSourceType,
} from "./constants.js";

export type StudyPointsLedgerEntryRecord = DbStudyPointsLedgerEntry;

export type AppendStudyPointsLedgerEntryInput = {
  userId: string;
  amount: number;
  category: StudyPointsCategory;
  reasonCode: string;
  sourceType: StudyPointsSourceType;
  sourceId?: string | null;
  ruleVersion: string;
  idempotencyKey: string;
  effectiveAt: Date;
  metadata?: Readonly<Record<string, unknown>>;
};

export type ReverseStudyPointsLedgerEntryInput = {
  userId: string;
  entryId: string;
  reasonCode: string;
  ruleVersion: string;
  idempotencyKey: string;
  effectiveAt: Date;
  metadata?: Readonly<Record<string, unknown>>;
};

export type StudyPointsMutationResult = {
  entry: StudyPointsLedgerEntryRecord;
  replayed: boolean;
};

export type StudyPointsLedgerEntryHistoryEntry = Pick<
  StudyPointsLedgerEntryRecord,
  | "id"
  | "userId"
  | "amount"
  | "category"
  | "reasonCode"
  | "sourceType"
  | "sourceId"
  | "ruleVersion"
  | "effectiveAt"
  | "createdAt"
  | "reversalOfEntryId"
> & {
  recordKind: "LEDGER";
};

export type StudyPointsLedgerPage = {
  entries: StudyPointsLedgerEntryHistoryEntry[];
  nextCursor: string | null;
};

export type StudyPointsCategoryBalances = Record<
  StudyPointsCategory,
  number
> & {
  total: number;
};

export type StudyPointsCompatibilityMode =
  | "LEGACY_ONLY"
  | "LEGACY_PLUS_LEDGER"
  | "LEDGER_ONLY";

export type CompatibleStudyPointsBalance = {
  legacyPoints: number;
  ledgerPoints: number;
  totalPoints: number;
  compatibilityMode: StudyPointsCompatibilityMode;
};

export type StudyPointsBalanceReadModel = {
  focusPoints: number;
  masteryPoints: number;
  progressPoints: number;
  consistencyPoints: number;
  ledgerPoints: number;
  legacyPoints: number;
  totalPoints: number;
  compatibilityMode: StudyPointsCompatibilityMode;
  source: "PROJECTION" | "LEDGER_FALLBACK";
  projectionVersion?: number;
};

export type NormalizedLegacyStudyPointsEntry = {
  recordKind: "LEGACY";
  legacyId: string;
  userId: string;
  amount: number;
  category: typeof import("./constants.js").LEGACY_POINTS_CATEGORY;
  reasonCode: "legacy.points_log";
  legacyReason: string;
  sourceType: "LEGACY_POINTS_LOG";
  sourceId: string;
  ruleVersion: typeof import("./constants.js").LEGACY_POINTS_RULE_VERSION;
  effectiveAt: Date;
  createdAt: Date;
};

export type LegacyPointsLogRow = Pick<
  PointsLog,
  "id" | "userId" | "points" | "reason" | "createdAt"
>;

export type ListStudyPointsLedgerEntriesInput = {
  userId: string;
  cursor?: string | null;
  limit?: number;
};