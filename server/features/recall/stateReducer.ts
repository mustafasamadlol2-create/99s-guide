import {
  RECALL_ATTEMPT_STATUSES,
  RECALL_FLASHCARD_RATINGS,
  RECALL_ITEM_TYPES,
  RECALL_MCQ_OPTIONS,
  RECALL_PRIVACY_CLASS,
  outcomeForFlashcardRating,
} from "./constants.js";
import type {
  DerivedRecallItemState,
  RecallAttemptFact,
} from "./types.js";
import { RecallError } from "./errors.js";

const MAX_DATABASE_INT = 2_147_483_647;

export function deriveRecallItemState(
  attempts: readonly RecallAttemptFact[],
): DerivedRecallItemState | null {
  if (attempts.length === 0) return null;

  const first = attempts[0];
  const sorted = [...attempts].sort(comparePresentationOrder);
  const identity = `${first.userId}\u0000${first.itemType}\u0000${first.itemId}`;

  let answerCount = 0;
  let skipCount = 0;
  let objectiveCorrectCount = 0;
  let objectiveIncorrectCount = 0;
  let selfReportedHardCount = 0;
  let selfReportedMediumCount = 0;
  let selfReportedEasyCount = 0;
  let terminalCount = 0;
  let lastAnsweredAt: Date | null = null;
  let lastSkippedAt: Date | null = null;
  let lastOutcome: DerivedRecallItemState["lastOutcome"] = null;
  let lastTerminalSortKey: readonly [number, string] | null = null;

  for (const attempt of sorted) {
    if (
      `${attempt.userId}\u0000${attempt.itemType}\u0000${attempt.itemId}` !==
      identity
    ) {
      throw corrupt("The attempt set contains more than one user/item.");
    }
    assertValidAttempt(attempt);

    if (attempt.status === "ANSWERED") {
      answerCount += 1;
      terminalCount += 1;
      lastAnsweredAt = maxDate(lastAnsweredAt, attempt.answeredAt);
      if (attempt.outcome === "CORRECT") objectiveCorrectCount += 1;
      else if (attempt.outcome === "INCORRECT") objectiveIncorrectCount += 1;
      else if (attempt.outcome === "SELF_REPORTED_HARD") selfReportedHardCount += 1;
      else if (attempt.outcome === "SELF_REPORTED_MEDIUM") selfReportedMediumCount += 1;
      else if (attempt.outcome === "SELF_REPORTED_EASY") selfReportedEasyCount += 1;
      else throw corrupt("Answered Recall attempt has no recognized outcome.");
      setLatestTerminal(attempt, attempt.answeredAt, (outcome) => {
        lastOutcome = outcome;
      }, (key) => {
        lastTerminalSortKey = key;
      }, lastTerminalSortKey);
    } else if (attempt.status === "SKIPPED") {
      skipCount += 1;
      terminalCount += 1;
      lastSkippedAt = maxDate(lastSkippedAt, attempt.skippedAt);
      setLatestTerminal(attempt, attempt.skippedAt, (outcome) => {
        lastOutcome = outcome;
      }, (key) => {
        lastTerminalSortKey = key;
      }, lastTerminalSortKey, "SKIPPED");
    } else if (attempt.status === "EXPIRED") {
      terminalCount += 1;
      setLatestTerminal(attempt, attempt.expiredAt, (outcome) => {
        lastOutcome = outcome;
      }, (key) => {
        lastTerminalSortKey = key;
      }, lastTerminalSortKey, "EXPIRED");
    }
  }

  const revision = attempts.length + terminalCount;
  assertDatabaseInt(revision);
  for (const count of [
    answerCount,
    skipCount,
    objectiveCorrectCount,
    objectiveIncorrectCount,
    selfReportedHardCount,
    selfReportedMediumCount,
    selfReportedEasyCount,
  ]) {
    assertDatabaseInt(count);
  }

  return {
    lectureId: sorted[sorted.length - 1].lectureId,
    presentationCount: attempts.length,
    answerCount,
    skipCount,
    objectiveCorrectCount,
    objectiveIncorrectCount,
    selfReportedHardCount,
    selfReportedMediumCount,
    selfReportedEasyCount,
    lastPresentedAt: sorted[sorted.length - 1].presentedAt,
    lastAnsweredAt,
    lastSkippedAt,
    lastOutcome,
    revision,
  };
}

function assertValidAttempt(attempt: RecallAttemptFact): void {
  if (
    !RECALL_ITEM_TYPES.includes(attempt.itemType) ||
    !RECALL_ATTEMPT_STATUSES.includes(attempt.status) ||
    attempt.privacyClass !== RECALL_PRIVACY_CLASS ||
    !validDate(attempt.presentedAt)
  ) {
    throw corrupt("Recall attempt contains an invalid type, status, privacy class, or date.");
  }

  const terminalDates = [
    attempt.answeredAt,
    attempt.skippedAt,
    attempt.expiredAt,
  ];
  if (
    terminalDates.filter((value) => value !== null).length !==
    (attempt.status === "PRESENTED" ? 0 : 1)
  ) {
    throw corrupt("Recall attempt has inconsistent terminal timestamps.");
  }

  if (attempt.status === "PRESENTED") {
    if (
      attempt.answerKind !== null ||
      attempt.answerValue !== null ||
      attempt.outcome !== null ||
      attempt.evidenceClass !== "SERVER_VALIDATED"
    ) {
      throw corrupt("Presented Recall attempt contains answer evidence.");
    }
    return;
  }

  if (attempt.status === "SKIPPED" || attempt.status === "EXPIRED") {
    if (
      attempt.answerKind !== null ||
      attempt.answerValue !== null ||
      attempt.outcome !== null ||
      attempt.evidenceClass !== "SERVER_VALIDATED"
    ) {
      throw corrupt("Skipped or expired Recall attempt contains answer evidence.");
    }
    if (attempt.status === "SKIPPED") {
      if (
        !attempt.skippedAt ||
        attempt.skippedAt.getTime() < attempt.presentedAt.getTime() ||
        (attempt.expiresAt !== null &&
          attempt.skippedAt.getTime() >= attempt.expiresAt.getTime())
      ) {
        throw corrupt("Skipped Recall attempt has inconsistent lifecycle timing.");
      }
    } else if (
      !attempt.expiredAt ||
      !attempt.expiresAt ||
      attempt.expiredAt.getTime() < attempt.presentedAt.getTime() ||
      attempt.expiredAt.getTime() < attempt.expiresAt.getTime()
    ) {
      throw corrupt("Expired Recall attempt has inconsistent lifecycle timing.");
    }
    return;
  }

  if (attempt.status !== "ANSWERED" || !attempt.answeredAt) {
    throw corrupt("Answered Recall attempt has no answer timestamp.");
  }
  if (
    attempt.answeredAt.getTime() < attempt.presentedAt.getTime() ||
    (attempt.expiresAt !== null &&
      attempt.answeredAt.getTime() >= attempt.expiresAt.getTime())
  ) {
    throw corrupt("Answered Recall attempt has inconsistent lifecycle timing.");
  }
  if (attempt.itemType === "MCQ") {
    if (
      attempt.answerKind !== "MCQ_OPTION" ||
      !RECALL_MCQ_OPTIONS.includes(
        attempt.answerValue as (typeof RECALL_MCQ_OPTIONS)[number],
      ) ||
      !["CORRECT", "INCORRECT"].includes(attempt.outcome ?? "") ||
      attempt.evidenceClass !== "SERVER_DERIVED"
    ) {
      throw corrupt("MCQ Recall answer evidence is inconsistent.");
    }
    return;
  }

  if (
    attempt.answerKind !== "FLASHCARD_RECALL_RATING" ||
    !RECALL_FLASHCARD_RATINGS.includes(
      attempt.answerValue as (typeof RECALL_FLASHCARD_RATINGS)[number],
    ) ||
    attempt.outcome !==
      outcomeForFlashcardRating(
        attempt.answerValue as (typeof RECALL_FLASHCARD_RATINGS)[number],
      ) ||
    attempt.evidenceClass !== "CLIENT_OBSERVED"
  ) {
    throw corrupt("Flashcard Recall self-report evidence is inconsistent.");
  }

}

function comparePresentationOrder(
  left: RecallAttemptFact,
  right: RecallAttemptFact,
): number {
  return (
    left.presentedAt.getTime() - right.presentedAt.getTime() ||
    left.id.localeCompare(right.id)
  );
}

function setLatestTerminal(
  attempt: RecallAttemptFact,
  at: Date | null,
  setOutcome: (value: DerivedRecallItemState["lastOutcome"]) => void,
  setKey: (key: readonly [number, string]) => void,
  currentKey: readonly [number, string] | null,
  explicitOutcome?: "SKIPPED" | "EXPIRED",
): void {
  if (!at || !validDate(at)) throw corrupt("Terminal attempt has an invalid timestamp.");
  const key = [at.getTime(), attempt.id] as const;
  if (
    !currentKey ||
    key[0] > currentKey[0] ||
    (key[0] === currentKey[0] && key[1].localeCompare(currentKey[1]) > 0)
  ) {
    setOutcome(explicitOutcome ?? attempt.outcome);
    setKey(key);
  }
}

function maxDate(current: Date | null, candidate: Date | null): Date | null {
  if (!candidate) return current;
  return !current || candidate.getTime() > current.getTime() ? candidate : current;
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function assertDatabaseInt(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_DATABASE_INT) {
    throw new RecallError(
      "RECALL_COUNTER_OVERFLOW",
      "Recall history exceeds the supported state counter range.",
    );
  }
}

function corrupt(message: string): RecallError {
  return new RecallError("RECALL_STATE_CORRUPT", message);
}