import {
  Prisma,
  type PrismaClient,
  type StudyPointsLedgerEntry as DbStudyPointsLedgerEntry,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import {
  STUDY_POINTS_CATEGORIES,
  STUDY_POINTS_DEFAULT_HISTORY_LIMIT,
  STUDY_POINTS_MAX_METADATA_BYTES,
  STUDY_POINTS_MAX_HISTORY_LIMIT,
  type StudyPointsCategory,
} from "./constants.js";
import { safeStudyPointsAggregate, safeStudyPointsSum } from "./aggregate.js";
import {
  decodeStudyPointsHistoryCursor,
  encodeStudyPointsHistoryCursor,
} from "./cursor.js";
import { StudyPointsError } from "./errors.js";
import { studyPointsSemanticPayload } from "./fingerprint.js";
import {
  studyPointsBalanceProjectionLockKey,
  lockStudyPointsKeys,
  studyPointsIdempotencyLockKey,
  studyPointsReversalLockKey,
} from "./locks.js";
import { updateStudyPointsBalanceProjectionAfterAppend } from "./balanceProjection.js";
import {
  normalizeStudyPointsLedgerInput,
  assertValidStudyPointsUserId,
  type NormalizedStudyPointsLedgerInput,
} from "./validation.js";
import type {
  AppendStudyPointsLedgerEntryInput,
  ListStudyPointsLedgerEntriesInput,
  ReverseStudyPointsLedgerEntryInput,
  StudyPointsCategoryBalances,
  StudyPointsLedgerEntryHistoryEntry,
  StudyPointsLedgerPage,
  StudyPointsMutationResult,
} from "./types.js";

const HISTORY_SELECT = {
  id: true,
  userId: true,
  amount: true,
  category: true,
  reasonCode: true,
  sourceType: true,
  sourceId: true,
  ruleVersion: true,
  effectiveAt: true,
  createdAt: true,
  reversalOfEntryId: true,
} satisfies Prisma.StudyPointsLedgerEntrySelect;

function semanticInput(
  entry: Pick<
    DbStudyPointsLedgerEntry,
    | "userId"
    | "amount"
    | "category"
    | "reasonCode"
    | "sourceType"
    | "sourceId"
    | "ruleVersion"
    | "effectiveAt"
    | "reversalOfEntryId"
    | "metadata"
  >,
): string {
  return studyPointsSemanticPayload(entry);
}

function assertReplayMatches(
  existing: DbStudyPointsLedgerEntry,
  requested: NormalizedStudyPointsLedgerInput,
  reversalOfEntryId: string | null = null,
): StudyPointsMutationResult {
  const existingSemantic = semanticInput(existing);
  const requestedSemantic = studyPointsSemanticPayload({
    ...requested,
    reversalOfEntryId,
  });
  if (existingSemantic !== requestedSemantic) {
    throw new StudyPointsError(
      "POINTS_IDEMPOTENCY_CONFLICT",
      "Study Points idempotency key was reused with a different semantic payload.",
    );
  }
  return { entry: existing, replayed: true };
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2002";
}

function normalizeReversalRequest(
  input: ReverseStudyPointsLedgerEntryInput,
): NormalizedStudyPointsLedgerInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new StudyPointsError(
      "POINTS_INVALID_REVERSAL",
      "Study Points reversal input is invalid.",
    );
  }
  return normalizeStudyPointsLedgerInput({
    userId: input.userId,
    amount: 1,
    category: STUDY_POINTS_CATEGORIES[0],
    reasonCode: input.reasonCode,
    sourceType: "ADMIN_ADJUSTMENT",
    sourceId: input.entryId,
    ruleVersion: input.ruleVersion,
    idempotencyKey: input.idempotencyKey,
    effectiveAt: input.effectiveAt,
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  });
}

function createRowData(
  input: NormalizedStudyPointsLedgerInput,
  overrides: Partial<{
    amount: number;
    category: StudyPointsCategory;
    sourceType: NormalizedStudyPointsLedgerInput["sourceType"];
    sourceId: string | null;
    reversalOfEntryId: string | null;
  }> = {},
) {
  return {
    userId: input.userId,
    amount: overrides.amount ?? input.amount,
    category: overrides.category ?? input.category,
    reasonCode: input.reasonCode,
    sourceType: overrides.sourceType ?? input.sourceType,
    sourceId: overrides.sourceId === undefined ? input.sourceId : overrides.sourceId,
    ruleVersion: input.ruleVersion,
    idempotencyKey: input.idempotencyKey,
    effectiveAt: input.effectiveAt,
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    ...(overrides.reversalOfEntryId !== undefined
      ? { reversalOfEntryId: overrides.reversalOfEntryId }
      : {}),
  };
}

async function assertMetadataStorageSize(
  tx: Prisma.TransactionClient,
  metadata: Prisma.InputJsonValue | undefined,
): Promise<void> {
  if (metadata === undefined) return;
  const serialized = JSON.stringify(metadata);
  if (serialized === undefined) {
    throw new StudyPointsError(
      "POINTS_INVALID_METADATA",
      "Study Points metadata is invalid or exceeds 8 KiB.",
    );
  }
  const [result] = await tx.$queryRaw<{ withinLimit: boolean }[]>`
    SELECT octet_length(${serialized}::jsonb::text)
      <= ${STUDY_POINTS_MAX_METADATA_BYTES} AS "withinLimit"
  `;
  if (!result?.withinLimit) {
    throw new StudyPointsError(
      "POINTS_INVALID_METADATA",
      "Study Points metadata is invalid or exceeds 8 KiB.",
    );
  }
}

export class StudyPointsLedgerService {
  constructor(
    private readonly database: PrismaClient = getPrisma() as PrismaClient,
  ) {}

  async appendStudyPointsLedgerEntry(
    input: AppendStudyPointsLedgerEntryInput,
    callerTransaction?: Prisma.TransactionClient,
  ): Promise<StudyPointsMutationResult> {
    const normalized = normalizeStudyPointsLedgerInput(input);
    const where = {
      userId_idempotencyKey: {
        userId: normalized.userId,
        idempotencyKey: normalized.idempotencyKey,
      },
    };

    const appendWithinTransaction = async (
      tx: Prisma.TransactionClient,
    ): Promise<StudyPointsMutationResult> => {
      await lockStudyPointsKeys(tx, [
        studyPointsBalanceProjectionLockKey(normalized.userId),
        studyPointsIdempotencyLockKey(
          normalized.userId,
          normalized.idempotencyKey,
        ),
      ]);

      const existing = await tx.studyPointsLedgerEntry.findUnique({ where });
      if (existing) return assertReplayMatches(existing, normalized);

      const user = await tx.user.findUnique({
        where: { id: normalized.userId },
        select: { id: true },
      });
      if (!user) {
        throw new StudyPointsError(
          "POINTS_USER_NOT_FOUND",
          "Study Points user does not exist.",
        );
      }

      await assertMetadataStorageSize(tx, normalized.metadata);
      const entry = await tx.studyPointsLedgerEntry.create({
        data: createRowData(normalized),
      });
      await updateStudyPointsBalanceProjectionAfterAppend(
        tx,
        normalized.userId,
        normalized.category,
        normalized.amount,
      );
      return { entry, replayed: false };
    };

    if (callerTransaction) return appendWithinTransaction(callerTransaction);

    try {
      return await this.database.$transaction(
        appendWithinTransaction,
        { maxWait: 5_000, timeout: 15_000 },
      );
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
      const existing = await this.database.studyPointsLedgerEntry.findUnique({ where });
      if (!existing) throw error;
      return assertReplayMatches(existing, normalized);
    }
  }

  async reverseStudyPointsLedgerEntry(
    input: ReverseStudyPointsLedgerEntryInput,
  ): Promise<StudyPointsMutationResult> {
    const normalized = normalizeReversalRequest(input);
    if (!input.entryId || input.entryId.length > 128 || input.entryId.includes("\0")) {
      throw new StudyPointsError(
        "POINTS_INVALID_REVERSAL",
        "Study Points reversal target is invalid.",
      );
    }

    const idempotencyWhere = {
      userId_idempotencyKey: {
        userId: normalized.userId,
        idempotencyKey: normalized.idempotencyKey,
      },
    };
    const reverseKeys = [
      studyPointsBalanceProjectionLockKey(normalized.userId),
      studyPointsIdempotencyLockKey(normalized.userId, normalized.idempotencyKey),
      studyPointsReversalLockKey(input.entryId),
    ];

    try {
      return await this.database.$transaction(async (tx) => {
        await lockStudyPointsKeys(tx, reverseKeys);
        const original = await tx.studyPointsLedgerEntry.findFirst({
          where: { id: input.entryId, userId: normalized.userId },
        });
        if (!original) {
          throw new StudyPointsError(
            "POINTS_ENTRY_NOT_FOUND",
            "Study Points reversal target was not found for this user.",
          );
        }
        if (
          original.sourceType === "REVERSAL"
          || original.reversalOfEntryId !== null
          || original.sourceType === "LEGACY_POINTS_LOG"
        ) {
          throw new StudyPointsError(
            "POINTS_INVALID_REVERSAL",
            "This Study Points entry cannot be reversed.",
          );
        }

        const existingByKey = await tx.studyPointsLedgerEntry.findUnique({
          where: idempotencyWhere,
        });
        if (existingByKey) {
          const expected = createRowData(normalized, {
            amount: -original.amount,
            category: original.category as StudyPointsCategory,
            sourceType: "REVERSAL",
            sourceId: original.id,
            reversalOfEntryId: original.id,
          });
          return assertReplayMatches(existingByKey, {
            ...normalized,
            amount: expected.amount,
            category: expected.category,
            sourceType: "REVERSAL",
            sourceId: original.id,
          }, original.id);
        }

        const existingReversal = await tx.studyPointsLedgerEntry.findUnique({
          where: { reversalOfEntryId: original.id },
        });
        if (existingReversal) {
          throw new StudyPointsError(
            "POINTS_ALREADY_REVERSED",
            "Study Points entry already has a full reversal.",
          );
        }

        await assertMetadataStorageSize(tx, normalized.metadata);
        const reversal = await tx.studyPointsLedgerEntry.create({
          data: createRowData(normalized, {
            amount: -original.amount,
            category: original.category as StudyPointsCategory,
            sourceType: "REVERSAL",
            sourceId: original.id,
            reversalOfEntryId: original.id,
          }),
        });
        await updateStudyPointsBalanceProjectionAfterAppend(
          tx,
          normalized.userId,
          original.category as StudyPointsCategory,
          -original.amount,
        );
        return { entry: reversal, replayed: false };
      }, { maxWait: 5_000, timeout: 15_000 });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
      const existingReversal = await this.database.studyPointsLedgerEntry.findUnique({
        where: { reversalOfEntryId: input.entryId },
      });
      if (existingReversal) {
        if (
          existingReversal.userId === normalized.userId
          && existingReversal.idempotencyKey === normalized.idempotencyKey
        ) {
          const original = await this.database.studyPointsLedgerEntry.findFirst({
            where: { id: input.entryId, userId: normalized.userId },
          });
          if (!original) throw error;
          const replayInput = {
            ...normalized,
            amount: -original.amount,
            category: original.category as StudyPointsCategory,
            sourceType: "REVERSAL" as const,
            sourceId: original.id,
          };
          return assertReplayMatches(existingReversal, replayInput, original.id);
        }
        throw new StudyPointsError(
          "POINTS_ALREADY_REVERSED",
          "Study Points entry already has a full reversal.",
        );
      }
      const existingByKey = await this.database.studyPointsLedgerEntry.findUnique({
        where: idempotencyWhere,
      });
      if (existingByKey) {
        throw new StudyPointsError(
          "POINTS_IDEMPOTENCY_CONFLICT",
          "Study Points idempotency key was reused with a different semantic payload.",
        );
      }
      throw error;
    }
  }

  async getStudyPointsBalance(userId: string): Promise<number> {
    assertValidStudyPointsUserId(userId);
    const result = await this.database.studyPointsLedgerEntry.aggregate({
      where: { userId },
      _sum: { amount: true },
    });
    return safeStudyPointsAggregate(result._sum.amount);
  }

  async getStudyPointsBalancesByCategory(
    userId: string,
  ): Promise<StudyPointsCategoryBalances> {
    assertValidStudyPointsUserId(userId);
    const balances: StudyPointsCategoryBalances = {
      FOCUS: 0,
      MASTERY: 0,
      PROGRESS: 0,
      CONSISTENCY: 0,
      total: 0,
    };
    const grouped = await this.database.studyPointsLedgerEntry.groupBy({
      by: ["category"],
      where: { userId },
      _sum: { amount: true },
    });
    for (const row of grouped) {
      if (!(STUDY_POINTS_CATEGORIES as readonly string[]).includes(row.category)) {
        throw new StudyPointsError(
          "POINTS_INVALID_CATEGORY",
          "Stored Study Points category is invalid.",
        );
      }
      const category = row.category as StudyPointsCategory;
      balances[category] = safeStudyPointsAggregate(row._sum.amount);
      balances.total = safeStudyPointsSum(
        balances.total,
        balances[category],
      );
    }
    return balances;
  }

  async listStudyPointsLedgerEntries(
    input: ListStudyPointsLedgerEntriesInput,
  ): Promise<StudyPointsLedgerPage> {
    assertValidStudyPointsUserId(input.userId);
    const limit = input.limit ?? STUDY_POINTS_DEFAULT_HISTORY_LIMIT;
    if (
      !Number.isSafeInteger(limit)
      || limit < 1
      || limit > STUDY_POINTS_MAX_HISTORY_LIMIT
    ) {
      throw new StudyPointsError(
        "POINTS_INVALID_HISTORY_LIMIT",
        `Study Points history limit must be between 1 and ${STUDY_POINTS_MAX_HISTORY_LIMIT}.`,
      );
    }

    const cursor = decodeStudyPointsHistoryCursor(input.cursor);
    const where: Prisma.StudyPointsLedgerEntryWhereInput = {
      userId: input.userId,
    };
    if (cursor) {
      where.OR = [
        { effectiveAt: { lt: cursor.effectiveAt } },
        {
          effectiveAt: cursor.effectiveAt,
          id: { lt: cursor.id },
        },
      ];
    }
    const rows = await this.database.studyPointsLedgerEntry.findMany({
      where,
      orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: HISTORY_SELECT,
    });
    const hasMore = rows.length > limit;
    const entries: StudyPointsLedgerEntryHistoryEntry[] = rows
      .slice(0, limit)
      .map((entry) => ({ ...entry, recordKind: "LEDGER" }));
    const last = entries.at(-1);
    return {
      entries,
      nextCursor: hasMore && last
        ? encodeStudyPointsHistoryCursor({
          effectiveAt: last.effectiveAt,
          id: last.id,
        })
        : null,
    };
  }
}