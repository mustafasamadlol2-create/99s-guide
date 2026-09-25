import type { Prisma, PrismaClient } from "@prisma/client";
import type { EvidenceClass } from "../study-core/evidence.js";
import type { StudyEventSource } from "../study-core/events.js";
import { isEvidenceClass } from "../study-integrity/evidence.js";
import { isEvidenceEligibleForReward } from "../study-integrity/evidence.js";
import { IntegritySignalQueries } from "../study-integrity/persistence/queries.js";
import type { StudyPointsNoAwardReason } from "./awardTypes.js";

export type StudyPointsIntegrityScope = {
  userId: string;
  actionType: string;
  source: StudyEventSource;
  evidenceClass: unknown;
  occurredAt: Date;
  now: Date;
  resource: { kind: string; id: string };
};

export async function getStudyPointsIntegrityFailure(
  tx: Prisma.TransactionClient,
  scope: StudyPointsIntegrityScope,
): Promise<StudyPointsNoAwardReason | null> {
  if (
    !(scope.occurredAt instanceof Date)
    || !Number.isFinite(scope.occurredAt.getTime())
    || scope.occurredAt > scope.now
  ) {
    return "NOT_ELIGIBLE";
  }
  if (!isEvidenceClass(scope.evidenceClass)) {
    return "INSUFFICIENT_EVIDENCE";
  }
  const decision = {
    outcome: "ALLOW" as const,
    effectiveEvidenceClass: scope.evidenceClass as EvidenceClass,
  };
  const evidence = isEvidenceEligibleForReward({
    actionType: scope.actionType,
    source: scope.source,
    decision,
  });
  if (!evidence.eligible) return "INSUFFICIENT_EVIDENCE";

  const oldestAllowed = scope.now.getTime() - 365 * 24 * 60 * 60 * 1000;
  const since = scope.occurredAt.getTime() < oldestAllowed
    ? new Date(oldestAllowed)
    : scope.occurredAt;
  const signals = new IntegritySignalQueries(
    tx as unknown as PrismaClient,
    () => scope.now,
  );
  const blocking = await signals.hasBlockingIntegritySignal({
    userId: scope.userId,
    actionType: scope.actionType,
    resource: scope.resource,
    since,
  });
  return blocking.blocked ? "INTEGRITY_BLOCKED" : null;
}