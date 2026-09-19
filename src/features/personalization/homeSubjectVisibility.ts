import type { Subject } from "../../core/types";
import {
  PERSONALIZATION_SUBJECT_IDS,
  type SubjectId,
} from "../../../shared/personalization";
import { orderHomeSubjects } from "./homeSubjectOrder";

export type HomeSubjectVisibilityReason =
  | "visible"
  | "hidden-manually"
  | "hidden-by-semester-1"
  | "hidden-by-semester-2";

export interface SemesterVisibility {
  readonly semester1: boolean;
  readonly semester2: boolean;
}

const SEMESTER_1_SUBJECTS = new Set<SubjectId>(["NT", "RM", "PHC"]);
const SEMESTER_2_SUBJECTS = new Set<SubjectId>(["ImD", "SSC"]);

export function getHomeSubjectVisibilityReason(
  subjectId: SubjectId,
  hiddenSubjectIds: readonly SubjectId[],
  semesterVisibility: SemesterVisibility,
): HomeSubjectVisibilityReason {
  if (hiddenSubjectIds.includes(subjectId)) return "hidden-manually";
  if (SEMESTER_1_SUBJECTS.has(subjectId) && !semesterVisibility.semester1) {
    return "hidden-by-semester-1";
  }
  if (SEMESTER_2_SUBJECTS.has(subjectId) && !semesterVisibility.semester2) {
    return "hidden-by-semester-2";
  }
  return "visible";
}

export function isHomeSubjectEffectivelyVisible(
  subjectId: SubjectId,
  hiddenSubjectIds: readonly SubjectId[],
  semesterVisibility: SemesterVisibility,
): boolean {
  return getHomeSubjectVisibilityReason(subjectId, hiddenSubjectIds, semesterVisibility) === "visible";
}

export function resolveHomeSubjectVisibility(
  subjects: readonly Subject[],
  subjectOrder: readonly SubjectId[],
  hiddenSubjectIds: readonly SubjectId[],
  semesterVisibility: SemesterVisibility,
): {
  orderedSubjects: Subject[];
  visibleSubjects: Subject[];
} {
  const orderedSubjects = orderHomeSubjects(subjects, subjectOrder);
  const visibleSubjects = orderedSubjects.filter((subject) => {
    if (!PERSONALIZATION_SUBJECT_IDS.includes(subject.id)) return true;
    return isHomeSubjectEffectivelyVisible(
      subject.id,
      hiddenSubjectIds,
      semesterVisibility,
    );
  });
  return { orderedSubjects, visibleSubjects };
}