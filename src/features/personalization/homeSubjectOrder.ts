import type { Subject } from "../../core/types";
import {
  PERSONALIZATION_SUBJECT_IDS,
  type SubjectId,
} from "../../../shared/personalization";

export const CANONICAL_HOME_SUBJECT_ORDER: readonly SubjectId[] =
  PERSONALIZATION_SUBJECT_IDS;

function isCompleteSubjectOrder(
  value: readonly SubjectId[],
): value is readonly SubjectId[] {
  if (value.length !== CANONICAL_HOME_SUBJECT_ORDER.length) return false;

  const canonicalIds = new Set(CANONICAL_HOME_SUBJECT_ORDER);
  const seen = new Set<SubjectId>();
  return value.every((subjectId) => {
    if (!canonicalIds.has(subjectId) || seen.has(subjectId)) return false;
    seen.add(subjectId);
    return true;
  });
}

function hasCanonicalHomeSubjectSet(subjects: readonly Subject[]): boolean {
  if (subjects.length !== CANONICAL_HOME_SUBJECT_ORDER.length) return false;

  const seen = new Set<SubjectId>();
  return subjects.every((subject) => {
    if (!CANONICAL_HOME_SUBJECT_ORDER.includes(subject.id) || seen.has(subject.id)) {
      return false;
    }
    seen.add(subject.id);
    return true;
  });
}

/**
 * Reorders the existing Home subject entities without changing their data.
 *
 * A malformed preference falls back to the canonical order. An unexpected
 * source set is returned in its original order so no domain entity can be
 * silently hidden while the architecture mismatch is investigated.
 */
export function orderHomeSubjects(
  subjects: readonly Subject[],
  subjectOrder: readonly SubjectId[],
): Subject[] {
  if (!hasCanonicalHomeSubjectSet(subjects)) {
    return [...subjects];
  }

  const order = isCompleteSubjectOrder(subjectOrder)
    ? subjectOrder
    : CANONICAL_HOME_SUBJECT_ORDER;
  const subjectsById = new Map(subjects.map((subject) => [subject.id, subject]));

  return order.map((subjectId) => subjectsById.get(subjectId) as Subject);
}

export function moveSubject(
  subjectOrder: readonly SubjectId[],
  subjectId: SubjectId,
  direction: "up" | "down",
): SubjectId[] {
  if (!isCompleteSubjectOrder(subjectOrder)) return [...subjectOrder];

  const currentIndex = subjectOrder.indexOf(subjectId);
  if (currentIndex < 0) return [...subjectOrder];

  const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= subjectOrder.length) {
    return [...subjectOrder];
  }

  const nextOrder = [...subjectOrder];
  [nextOrder[currentIndex], nextOrder[nextIndex]] = [
    nextOrder[nextIndex],
    nextOrder[currentIndex],
  ];
  return nextOrder;
}