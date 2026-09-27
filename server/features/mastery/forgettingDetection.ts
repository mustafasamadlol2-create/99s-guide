import {
  RETENTION_FORGETTING_MIN_SEPARATION_MS,
  RETENTION_MEMORY_LOOKBACK_DAYS,
} from "./retentionConstants.js";
import type {
  LectureRetentionForgettingSummary,
  LectureRetentionMemoryEvidence,
} from "./retentionTypes.js";

type ForgettingOutcome = {
  id: string;
  itemId: string;
  occurredAt: Date;
  positive: boolean;
};

type ActiveForgettingItem = {
  itemId: string;
  occurredAt: Date;
};

export function detectLectureForgetting(
  evidence: Pick<
    LectureRetentionMemoryEvidence,
    "objectiveOutcomes" | "flashcardOutcomes"
  >,
  asOf: Date,
): LectureRetentionForgettingSummary {
  if (!Number.isFinite(asOf.getTime())) {
    throw new TypeError("Retention forgetting detection requires a valid asOf.");
  }

  const earliestAllowed = asOf.getTime() -
    RETENTION_MEMORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const objective = evidence.objectiveOutcomes
    .filter((outcome) => isValidOutcome(outcome, earliestAllowed, asOf))
    .map((outcome): ForgettingOutcome => ({
      id: outcome.id,
      itemId: outcome.itemId,
      occurredAt: outcome.occurredAt,
      positive: outcome.correct,
    }));
  const flashcards = evidence.flashcardOutcomes
    .filter((outcome) => isValidOutcome(outcome, earliestAllowed, asOf))
    .map((outcome): ForgettingOutcome => ({
      id: outcome.id,
      itemId: outcome.itemId,
      occurredAt: outcome.occurredAt,
      positive: outcome.remembered,
    }));

  const objectiveActive = findActiveForgettingItems(objective);
  const flashcardActive = findActiveForgettingItems(flashcards);
  const allOutcomes = [...objective, ...flashcards];
  const lastForgettingEvidenceAt = latestDate([
    ...objectiveActive.map((item) => item.occurredAt),
    ...flashcardActive.map((item) => item.occurredAt),
  ]);

  let forgettingEvidenceKind: LectureRetentionForgettingSummary["forgettingEvidenceKind"] =
    "NONE";
  if (objectiveActive.length > 0 && flashcardActive.length > 0) {
    forgettingEvidenceKind = "MIXED";
  } else if (objectiveActive.length > 0) {
    forgettingEvidenceKind = "OBJECTIVE";
  } else if (flashcardActive.length > 0) {
    forgettingEvidenceKind = "SELF_REPORTED";
  }

  return {
    retentionAnchorAt: latestDate(allOutcomes.map((item) => item.occurredAt)),
    lastPositiveMemoryEvidenceAt: latestDate(
      allOutcomes.filter((item) => item.positive).map((item) => item.occurredAt),
    ),
    lastNegativeMemoryEvidenceAt: latestDate(
      allOutcomes.filter((item) => !item.positive).map((item) => item.occurredAt),
    ),
    lastForgettingEvidenceAt,
    objectiveForgettingItemCount: objectiveActive.length,
    selfReportedForgettingItemCount: flashcardActive.length,
    forgettingEvidenceKind,
  };
}

function findActiveForgettingItems(
  outcomes: readonly ForgettingOutcome[],
): ActiveForgettingItem[] {
  const byItem = new Map<string, ForgettingOutcome[]>();
  for (const outcome of outcomes) {
    const list = byItem.get(outcome.itemId) ?? [];
    list.push(outcome);
    byItem.set(outcome.itemId, list);
  }

  const active: ActiveForgettingItem[] = [];
  for (const [itemId, itemOutcomes] of byItem) {
    itemOutcomes.sort(compareChronologically);
    let latestPositiveAt: number | null = null;
    let activeForgettingAt: Date | null = null;

    for (const outcome of itemOutcomes) {
      const occurredAt = outcome.occurredAt.getTime();
      if (outcome.positive) {
        latestPositiveAt = occurredAt;
        activeForgettingAt = null;
      } else if (
        latestPositiveAt !== null &&
        occurredAt - latestPositiveAt >= RETENTION_FORGETTING_MIN_SEPARATION_MS
      ) {
        activeForgettingAt = outcome.occurredAt;
      }
    }

    if (activeForgettingAt) {
      active.push({ itemId, occurredAt: activeForgettingAt });
    }
  }
  return active;
}

function compareChronologically(
  left: ForgettingOutcome,
  right: ForgettingOutcome,
): number {
  return left.occurredAt.getTime() - right.occurredAt.getTime() ||
    left.id.localeCompare(right.id);
}

function isValidOutcome(
  outcome: { id: string; itemId: string; occurredAt: Date },
  earliestAllowed: number,
  asOf: Date,
): boolean {
  const occurredAt = outcome.occurredAt;
  return Boolean(
    typeof outcome.id === "string" &&
      outcome.id.length > 0 &&
      typeof outcome.itemId === "string" &&
      outcome.itemId.length > 0 &&
      occurredAt instanceof Date &&
      Number.isFinite(occurredAt.getTime()) &&
      occurredAt.getTime() >= earliestAllowed &&
      occurredAt.getTime() <= asOf.getTime(),
  );
}

function latestDate(values: readonly Date[]): Date | null {
  let latest: Date | null = null;
  for (const value of values) {
    if (!latest || value.getTime() > latest.getTime()) latest = value;
  }
  return latest ? new Date(latest.getTime()) : null;
}