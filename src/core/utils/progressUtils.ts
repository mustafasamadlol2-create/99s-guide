import { UserProgress } from "../types";

export function getLectureProgressStats(dbLectures: any[], progress: UserProgress[]) {
  let total = 0;
  let completed = 0;
  const progressMap = new Map<string, UserProgress>();
  for (let i = 0; i < progress.length; i++) {
    progressMap.set(progress[i].lectureId, progress[i]);
  }

  for (let i = 0; i < dbLectures.length; i++) {
    const l = dbLectures[i];
    let hasPdf = false;
    let hasNote = false;
    let hasVideo = false;

    if (l.materials) {
      for (let j = 0; j < l.materials.length; j++) {
        const t = l.materials[j].type;
        if (t === "PDF" || t === "pdf") hasPdf = true;
        else if (t === "NOTE" || t === "note") hasNote = true;
        else if (t === "VIDEO" || t === "video") hasVideo = true;
      }
    }

    const hasMcqs = l.mcqs && l.mcqs.length > 0;
    const hasFlashcards = l.flashcards && l.flashcards.length > 0;

    if (hasPdf || hasNote || hasVideo || hasMcqs || hasFlashcards) {
      total++;
      const p = progressMap.get(l.id);
      if (p) {
        let isComplete = true;
        if (hasPdf && !p.pdfCompleted) isComplete = false;
        if (hasNote && !p.notesCompleted) isComplete = false;
        if (hasVideo && !p.videoCompleted) isComplete = false;
        if (hasMcqs && !p.quizCompleted) isComplete = false;
        if (hasFlashcards && !p.flashcardsCompleted) isComplete = false;

        if (isComplete) {
          completed++;
        }
      }
    }
  }

  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    totalLecturesCount: total,
    completedLecturesCount: completed,
    overallCompletionPercentage: percentage
  };
}
