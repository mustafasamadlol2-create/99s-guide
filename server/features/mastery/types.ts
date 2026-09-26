export type MasteryEvidenceSource = "MCQ" | "RECALL";

export type ObjectiveOutcome = {
  id: string;
  itemId: string;
  occurredAt: Date;
  correct: boolean;
  source: MasteryEvidenceSource;
};

export type FlashcardOutcome = {
  id: string;
  itemId: string;
  occurredAt: Date;
  remembered: boolean;
  source: MasteryEvidenceSource | "FLASHCARD";
};

export type LectureMasteryEvidence = {
  userId: string;
  lectureId: string;
  asOf: Date;
  availableObjectiveItemCount: number;
  objectiveOutcomes: ObjectiveOutcome[];
  flashcardOutcomes: FlashcardOutcome[];
  lastRecallEvidenceAt: Date | null;
  study: {
    meaningfulFocusSessionCount: number;
    meaningfulFocusSeconds: number;
    lastStudyEvidenceAt: Date | null;
  };
};

export type MasteryComponentScores = {
  objectiveComponent: number;
  flashcardComponent: number;
  studyComponent: number;
};

export type LectureMasteryEvaluation = {
  userId: string;
  lectureId: string;
  state: import("../study-core/constants.js").MasteryState;
  evidenceScore: number;
  evidenceCount: number;
  objectiveAttemptCount: number;
  objectiveCorrectCount: number;
  objectiveIncorrectCount: number;
  flashcardReviewCount: number;
  flashcardRememberedCount: number;
  flashcardNotRememberedCount: number;
  recallObjectiveAttemptCount: number;
  recallObjectiveCorrectCount: number;
  recallObjectiveIncorrectCount: number;
  meaningfulFocusSessionCount: number;
  meaningfulFocusSeconds: number;
  lastStudyEvidenceAt: Date | null;
  lastObjectiveEvidenceAt: Date | null;
  lastRecallEvidenceAt: Date | null;
  ruleVersion: "mastery-v1";
  objectiveAccuracyPercent: number | null;
  distinctObjectiveItems: number;
  availableObjectiveItemCount: number;
  componentScores: MasteryComponentScores;
};