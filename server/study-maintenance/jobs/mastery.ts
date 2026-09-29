import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { reconcileLectureMastery, type LectureMasteryReconciliation } from "../../features/mastery/reconciliation.js";
import type { MaintenanceAdapter, InspectionResult, MaintenanceItem } from "../core/types.js";
import {
  canonicalMaintenanceScope,
  decodePairCursor,
  encodePairCursor,
  parseMaintenanceScope,
  type MaintenanceScope,
} from "./scope.js";

export type MasteryMaintenanceItem = MaintenanceItem & { userId: string; lectureId: string };
export type MasteryCandidateSource = {
  listCandidates(input: {
    cursor: string | null;
    limit: number;
    scope: MaintenanceScope;
  }): Promise<{ items: MasteryMaintenanceItem[]; nextCursor: string | null }>;
};
export type MasteryReconciler = (input: {
  userId: string;
  lectureId: string;
  repair: boolean;
  asOf: Date;
  database?: PrismaClient;
}) => Promise<LectureMasteryReconciliation>;

function result(reconciliation: LectureMasteryReconciliation, repair: boolean): InspectionResult {
  return {
    status: reconciliation.status,
    changed: repair && reconciliation.repaired,
    wouldChange: !repair && reconciliation.status !== "IN_SYNC",
    skipped: false,
    code: reconciliation.status,
  };
}

export function createMasteryCandidateSource(database: PrismaClient): MasteryCandidateSource {
  return {
    async listCandidates({ cursor, limit, scope }) {
      const after = decodePairCursor(cursor);
      const userFilter = scope.userId ? Prisma.sql`AND "userId" = ${scope.userId}` : Prisma.empty;
      const lectureFilter = scope.lectureId ? Prisma.sql`AND "lectureId" = ${scope.lectureId}` : Prisma.empty;
      const afterFilter = after
        ? Prisma.sql`AND ("userId" > ${after.userId} OR ("userId" = ${after.userId} AND "lectureId" > ${after.lectureId}))`
        : Prisma.empty;
      const rows = await database.$queryRaw<Array<{ userId: string; lectureId: string }>>(Prisma.sql`
        SELECT "userId", "lectureId" FROM (
          SELECT event."userId", mcq."lectureId" FROM "StudyEvent" event
          INNER JOIN "Mcq" mcq ON mcq."id" = event."mcqId"
          WHERE event."eventType" = 'mcq_attempted' AND event."evidenceClass" = 'SERVER_VALIDATED'
          UNION
          SELECT event."userId", flashcard."lectureId" FROM "StudyEvent" event
          INNER JOIN "Flashcard" flashcard ON flashcard."id" = event."flashcardId"
          WHERE event."eventType" = 'flashcard_reviewed' AND event."evidenceClass" = 'SERVER_VALIDATED'
          UNION
          SELECT "userId", "lectureId" FROM "RecallAttempt"
          WHERE "status" = 'ANSWERED' AND "lectureId" IS NOT NULL
          UNION
          SELECT "userId", "lectureId" FROM "FocusSession"
          WHERE "status" = 'COMPLETED' AND "lectureId" IS NOT NULL
          UNION
          SELECT "userId", "effectiveLectureId" FROM "GroupFocusParticipantSummary"
          UNION
          SELECT "userId", "lectureId" FROM "LectureMastery"
          UNION
          SELECT "userId", "lectureId" FROM "LectureRetention"
        ) candidates
        WHERE "userId" IS NOT NULL AND "lectureId" IS NOT NULL
        ${userFilter} ${lectureFilter} ${afterFilter}
        ORDER BY "userId", "lectureId"
        LIMIT ${limit}
      `);
      const items = rows.map((row) => ({ id: encodePairCursor(row.userId, row.lectureId), ...row }));
      return {
        items,
        nextCursor: items.length === limit ? items.at(-1)?.id ?? null : null,
      };
    },
  };
}

export function createMasteryMaintenanceAdapter(input: {
  database?: PrismaClient;
  candidateSource?: MasteryCandidateSource;
  reconcile?: MasteryReconciler;
  scope?: string;
} = {}): MaintenanceAdapter<MasteryMaintenanceItem> {
  const database = input.database ?? getPrisma() as PrismaClient;
  const source = input.candidateSource ?? createMasteryCandidateSource(database);
  const reconcile = input.reconcile ?? ((args) => reconcileLectureMastery({ ...args, database }));
  return {
    async discoverBatch({ cursor, limit, scope }) {
      const parsed = parseMaintenanceScope(scope);
      return source.listCandidates({ cursor, limit, scope: parsed });
    },
    async inspect(item, { asOf }) {
      return result(await reconcile({ userId: item.userId, lectureId: item.lectureId, repair: false, asOf: new Date(asOf), database }), false);
    },
    async apply(item, { asOf }) {
      return result(await reconcile({ userId: item.userId, lectureId: item.lectureId, repair: true, asOf: new Date(asOf), database }), true);
    },
  };
}

export { canonicalMaintenanceScope };