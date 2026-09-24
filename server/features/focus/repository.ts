import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import type { StudyEventTransaction } from "../study-events/types.js";

export type FocusTransaction = Prisma.TransactionClient & StudyEventTransaction;

/**
 * PostgreSQL transaction boundary for Focus. User-scoped transaction locks
 * serialize all session starts, planned-count checks, archive/edit checks, and
 * lifecycle mutations for the same user.
 */
export class FocusRepository {
  constructor(readonly database: PrismaClient = getPrisma()) {}

  transaction<T>(callback: (tx: FocusTransaction) => Promise<T>): Promise<T> {
    return this.database.$transaction(
      (tx) => callback(tx as unknown as FocusTransaction),
      { maxWait: 5_000, timeout: 15_000 },
    );
  }

  async lockUser(tx: FocusTransaction, userId: string): Promise<void> {
    // hashtextextended is deterministic for the same user; a hash collision
    // can only serialize two unrelated users, never weaken a user's lock.
    await tx.$queryRawUnsafe(
      "SELECT TRUE AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended($1, 0))) AS acquired",
      userId,
    );
  }
}