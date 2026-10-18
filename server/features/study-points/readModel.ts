import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { aggregateCanonicalStudyPointsLedgerBalance } from "./balanceProjection.js";
import { assertValidStudyPointsUserId } from "./validation.js";
import type {
  StudyPointsBalanceReadModel,
  StudyPointsCompatibilityMode,
} from "./types.js";

/**
 * Points V2 is ledger-only. The legacy User.totalPoints / PointsLog system is
 * deliberately never consulted by runtime reads anymore.
 */
export function resolveStudyPointsReadMode(
  _configured?: string,
): StudyPointsCompatibilityMode {
  return "LEDGER_ONLY";
}

export function resolveUnifiedStudyPointsReadMode(
  _configured?: string,
): "LEDGER_ONLY" {
  return "LEDGER_ONLY";
}

type StudyPointsReadDatabase = PrismaClient | Prisma.TransactionClient;

function isPrismaTransactionClient(
  database: StudyPointsReadDatabase,
): database is Prisma.TransactionClient {
  return !("$transaction" in database);
}

export async function getStudyPointsReadModel(
  input: {
    userId: string;
    compatibilityMode?: StudyPointsCompatibilityMode;
  },
  database: StudyPointsReadDatabase = getPrisma() as PrismaClient,
): Promise<StudyPointsBalanceReadModel> {
  assertValidStudyPointsUserId(input.userId);

  const ledger = isPrismaTransactionClient(database)
    ? await aggregateCanonicalStudyPointsLedgerBalance(database, input.userId)
    : await database.$transaction((tx) =>
        aggregateCanonicalStudyPointsLedgerBalance(tx, input.userId));

  return {
    focusPoints: ledger.focusPoints,
    masteryPoints: ledger.masteryPoints,
    progressPoints: ledger.progressPoints,
    consistencyPoints: ledger.consistencyPoints,
    // Retained as zero-valued response fields for temporary API shape
    // compatibility. No legacy source is read or included in Points V2.
    legacyLedgerPoints: 0,
    ledgerPoints: ledger.totalPoints,
    legacyPoints: 0,
    totalPoints: ledger.totalPoints,
    compatibilityMode: "LEDGER_ONLY",
    source: "LEDGER_FALLBACK",
  };
}

export async function getUnifiedStudyPointsReadModel(
  input: { userId: string },
  database: StudyPointsReadDatabase = getPrisma() as PrismaClient,
): Promise<StudyPointsBalanceReadModel> {
  return getStudyPointsReadModel({ userId: input.userId }, database);
}
