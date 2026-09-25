import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "../../../services/prismaClient.js";
import { toIntegrityReviewActionDto, toIntegritySignalDto } from "./dto.js";
import {
  StudyIntegrityPersistenceError,
  type BlockingIntegritySignalInput,
  type BlockingIntegritySignalResult,
  type IntegrityContextInput,
  type IntegritySignalDto,
  type IntegritySignalListFilters,
  type UserIntegrityContext,
} from "./types.js";

const UNRESOLVED_STATUSES = ["OPEN", "ACKNOWLEDGED"] as const;
const MAX_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_LIST_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_BLOCKING_REASON_ROWS = 20;

function validateWindow(since: Date, now: Date): void {
  if (
    !(since instanceof Date)
    || !Number.isSafeInteger(since.getTime())
    || since.getTime() < 0
    || since.getTime() > now.getTime()
    || now.getTime() - since.getTime() > MAX_LOOKBACK_MS
  ) {
    throw new StudyIntegrityPersistenceError(
      "INVALID_INPUT",
      "Integrity query time window must be within the past 365 days.",
    );
  }
}

function validateIdentifier(value: string, maxLength: number, label: string): void {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    throw new StudyIntegrityPersistenceError(
      "INVALID_INPUT",
      `${label} is invalid.`,
    );
  }
}

function validateListFilters(
  filters: IntegritySignalListFilters,
  now: Date,
): void {
  if (
    !Number.isSafeInteger(filters.limit)
    || filters.limit < 1
    || filters.limit > 100
    || typeof filters.includeAllStatuses !== "boolean"
  ) {
    throw new StudyIntegrityPersistenceError(
      "INVALID_INPUT",
      "Integrity signal page size or status filter is invalid.",
    );
  }
  if (filters.cursor) validateIdentifier(filters.cursor, 128, "Signal cursor");
  if (filters.actionType) validateIdentifier(filters.actionType, 96, "Action type");
  if (filters.userId) validateIdentifier(filters.userId, 128, "User ID");
  if (filters.ruleId) validateIdentifier(filters.ruleId, 128, "Rule ID");
  if (filters.from || filters.to) {
    const upperBound = filters.to ?? now;
    const lowerBound = filters.from ?? new Date(
      Math.max(0, upperBound.getTime() - MAX_LIST_WINDOW_MS),
    );
    if (
      !Number.isSafeInteger(upperBound.getTime())
      || !Number.isSafeInteger(lowerBound.getTime())
      || lowerBound.getTime() < 0
      || upperBound.getTime() > now.getTime()
      || upperBound.getTime() < lowerBound.getTime()
      || upperBound.getTime() - lowerBound.getTime() > MAX_LIST_WINDOW_MS
    ) {
      throw new StudyIntegrityPersistenceError(
        "INVALID_INPUT",
        "Integrity signal list time window must be within the past 90 days.",
      );
    }
  }
}

export class IntegritySignalQueries {
  constructor(
    private readonly database: PrismaClient = getPrisma() as PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listSignals(filters: IntegritySignalListFilters): Promise<{
    items: IntegritySignalDto[];
    nextCursor: string | null;
  }> {
    validateListFilters(filters, this.now());
    const where: Prisma.IntegritySignalWhereInput = {
      ...(filters.includeAllStatuses
        ? {}
        : { status: filters.status ?? "OPEN" }),
      ...(filters.severity ? { severity: filters.severity } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.observationCode
        ? { observationCode: filters.observationCode }
        : {}),
      ...(filters.actionType ? { actionType: filters.actionType } : {}),
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.ruleId ? { ruleId: filters.ruleId } : {}),
      ...(filters.from || filters.to
        ? {
            lastOccurredAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    };
    const rows = await this.database.integritySignal.findMany({
      where,
      orderBy: [{ lastOccurredAt: "desc" }, { id: "desc" }],
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      take: filters.limit + 1,
    });
    const hasMore = rows.length > filters.limit;
    const page = hasMore ? rows.slice(0, filters.limit) : rows;
    return {
      items: page.map(toIntegritySignalDto),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
  }

  async getSignalDetail(signalId: string): Promise<{
    signal: IntegritySignalDto;
    reviewHistory: ReturnType<typeof toIntegrityReviewActionDto>[];
  } | null> {
    validateIdentifier(signalId, 128, "Signal ID");
    const signal = await this.database.integritySignal.findUnique({
      where: { id: signalId },
      include: {
        reviewActions: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!signal) return null;
    return {
      signal: toIntegritySignalDto(signal),
      reviewHistory: signal.reviewActions.map(toIntegrityReviewActionDto),
    };
  }

  async getUserIntegrityContext(
    input: IntegrityContextInput,
  ): Promise<UserIntegrityContext> {
    validateIdentifier(input.userId, 128, "User ID");
    const now = this.now();
    validateWindow(input.since, now);
    if (input.actionType) validateIdentifier(input.actionType, 96, "Action type");
    const baseWhere: Prisma.IntegritySignalWhereInput = {
      userId: input.userId,
      lastOccurredAt: { gte: input.since },
      ...(input.actionType ? { actionType: input.actionType } : {}),
    };
    const unresolved = { in: [...UNRESOLVED_STATUSES] };
    const [
      openBlockSignals,
      openReviewSignals,
      recentIdempotencyConflicts,
      recentRateSignals,
      lastSignal,
    ] = await Promise.all([
      this.database.integritySignal.count({
        where: { ...baseWhere, status: unresolved, severity: "BLOCK" },
      }),
      this.database.integritySignal.count({
        where: { ...baseWhere, status: unresolved, severity: "REVIEW" },
      }),
      this.database.integritySignal.count({
        where: { ...baseWhere, observationCode: "IDEMPOTENCY_CONFLICT" },
      }),
      this.database.integritySignal.count({
        where: { ...baseWhere, observationCode: "RATE_WINDOW_EXCEEDED" },
      }),
      this.database.integritySignal.findFirst({
        where: baseWhere,
        orderBy: [{ lastOccurredAt: "desc" }, { id: "desc" }],
        select: { lastOccurredAt: true },
      }),
    ]);
    return {
      openBlockSignals,
      openReviewSignals,
      recentIdempotencyConflicts,
      recentRateSignals,
      lastSignalAt: lastSignal?.lastOccurredAt ?? null,
    };
  }

  async hasBlockingIntegritySignal(
    input: BlockingIntegritySignalInput,
  ): Promise<BlockingIntegritySignalResult> {
    validateIdentifier(input.userId, 128, "User ID");
    validateIdentifier(input.actionType, 96, "Action type");
    const now = this.now();
    validateWindow(input.since, now);
    if (
      input.resource
      && (
      typeof input.resource.kind !== "string"
      || input.resource.kind.length < 1
        || input.resource.kind.length > 48
      || typeof input.resource.id !== "string"
      || input.resource.id.length < 1
        || input.resource.id.length > 128
      )
    ) {
      throw new StudyIntegrityPersistenceError(
        "INVALID_INPUT",
        "Integrity resource identity is invalid.",
      );
    }

    // Missing resource means the action has no resource scope; it does not
    // match signals belonging to other resources.
    const where: Prisma.IntegritySignalWhereInput = {
      userId: input.userId,
      actionType: input.actionType,
      severity: "BLOCK",
      status: { in: [...UNRESOLVED_STATUSES] },
      lastOccurredAt: { gte: input.since },
      resourceKind: input.resource?.kind ?? null,
      resourceId: input.resource?.id ?? null,
    };
    const [totalMatches, rows] = await Promise.all([
      this.database.integritySignal.count({ where }),
      this.database.integritySignal.findMany({
        where,
        orderBy: [{ lastOccurredAt: "desc" }, { id: "desc" }],
        take: MAX_BLOCKING_REASON_ROWS,
        select: {
          id: true,
          observationCode: true,
          ruleId: true,
        },
      }),
    ]);
    return {
      blocked: totalMatches > 0,
      totalMatches,
      signals: rows.map((signal) => ({
        signalId: signal.id,
        observationCode: signal.observationCode,
        ruleId: signal.ruleId,
        severity: "BLOCK",
      })),
    };
  }
}