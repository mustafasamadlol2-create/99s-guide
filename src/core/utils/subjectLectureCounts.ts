/**
 * Subject lecture counting with server-merged deduplication.
 *
 * The backend `/api/materials` endpoint already merges database lectures into
 * each subject's `modules`. Counting `subject.modules` lectures AND
 * `dbLectures` separately therefore double-counts any lecture that exists in
 * both places (it is in the merged module tree, and its row is also in
 * `dbLectures`). Every device must agree on the same number, so this helper is
 * the single source of truth: unique lectures by `id` across the merged module
 * tree plus any DB lectures that belong to the subject.
 */
import type { Subject } from "../types";

function subjectMatches(dbMainSubject: string | null | undefined, subject: Subject): boolean {
  const main = String(dbMainSubject ?? "").trim().toLowerCase();
  const id = String(subject.id).trim().toLowerCase();
  const name = String(subject.name ?? "").trim().toLowerCase();
  return main === id || main === name;
}

/**
 * Unique lectures (by id) belonging to a subject: the merged module tree plus
 * any database lectures that match the subject (by id or name).
 */
export function getUniqueSubjectLectures(subject: Subject, dbLectures: readonly any[] | undefined | null): any[] {
  const byId = new Map<string, any>();
  const modules = subject?.modules;
  if (Array.isArray(modules)) {
    for (let m = 0; m < modules.length; m++) {
      const lectures = modules[m]?.lectures;
      if (!Array.isArray(lectures)) continue;
      for (let l = 0; l < lectures.length; l++) {
        const lecture = lectures[l];
        if (lecture && lecture.id != null) byId.set(String(lecture.id), lecture);
      }
    }
  }
  if (Array.isArray(dbLectures)) {
    for (let i = 0; i < dbLectures.length; i++) {
      const lecture = dbLectures[i];
      if (lecture && lecture.id != null && subjectMatches(lecture.mainSubject, subject)) {
        byId.set(String(lecture.id), lecture);
      }
    }
  }
  return Array.from(byId.values());
}

/** Number of unique lectures belonging to a subject. */
export function countUniqueSubjectLectures(subject: Subject, dbLectures: readonly any[] | undefined | null): number {
  return getUniqueSubjectLectures(subject, dbLectures).length;
}
