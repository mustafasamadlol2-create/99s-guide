export type OwnerAcademicWindow = {
  from: Date;
  to: Date;
};

export type OwnerAcademicAggregateInput = {
  window: OwnerAcademicWindow;
  asOf: Date;
  subjectIds?: readonly string[];
  lectureIds?: readonly string[];
};

export type OwnerAnalyticsRate = {
  numerator: number;
  denominator: number;
  /** Integer basis points in the inclusive range 0..10000; null when denominator is zero. */
  rateBps: number | null;
};

export type OwnerAnalyticsScope = "COHORT" | "SUBJECT" | "LECTURE";

export type OwnerAnalyticsSourceFilter = {
  /** Narrows returned subject rows and, when supplied, lecture rows; cohort scope remains global. */
  subjectIds?: readonly string[];
  /** Narrows returned lecture rows only; omitted to avoid an unbounded lecture result. */
  lectureIds?: readonly string[];
};

export type OwnerFocusMetrics = {
  meaningfulSessionCount: number;
  verifiedStudySeconds: number;
  uniqueUsers: number;
  averageMeaningfulSessionSeconds: number | null;
  averageMeaningfulSessionSecondsDenominator: number;
};

export type OwnerGroupFocusMetrics = {
  completedRuns: number;
  verifiedParticipantSessions: number;
  verifiedFocusSeconds: number;
  uniqueParticipants: number;
};

export type OwnerMcqMetrics = {
  objectiveAttempts: number;
  objectiveCorrect: number;
  objectiveIncorrect: number;
  uniqueUsers: number;
  distinctItemsAttempted: number;
  accuracyRate: OwnerAnalyticsRate;
};

export type OwnerFlashcardMetrics = {
  meaningfulReviews: number;
  selfReportedRemembered: number;
  selfReportedNotRemembered: number;
  selfReportedOutcomeCount: number;
  uniqueUsers: number;
  distinctCardsReviewed: number;
  selfReportedRememberedRate: OwnerAnalyticsRate;
};

export type OwnerRecallMetrics = {
  periodicPresented: number;
  periodicAnswered: number;
  periodicSkipped: number;
  periodicExpired: number;
  objectiveMcqAnswered: number;
  objectiveMcqCorrect: number;
  objectiveMcqIncorrect: number;
  objectiveMcqAccuracyRate: OwnerAnalyticsRate;
  flashcardRemembered: number;
  flashcardNotRemembered: number;
  uniqueUsers: number;
};

export type OwnerResourceMetrics = {
  /** No producer currently writes a reliable lecture_resource_launched event. */
  resourceLaunches: null;
  /** Counts validated Focus handoff starts only; it does not mean reading or viewing. */
  resourceHandoffs: number;
  uniqueUsersWithResourceHandoffs: number;
  handoffsByType: {
    PDF: number;
    VIDEO: number;
  };
  launchMetricsAvailable: false;
  handoffMetricsAvailable: true;
};

export type OwnerActivityWindowMetrics = {
  focus: OwnerFocusMetrics;
  groupFocus: OwnerGroupFocusMetrics;
  /** Normal objective MCQ only; Recall objective answers are separate below. */
  mcq: OwnerMcqMetrics;
  flashcards: OwnerFlashcardMetrics;
  recall: OwnerRecallMetrics;
  resources: OwnerResourceMetrics;
};

export type OwnerMasteryDistribution = {
  NOT_STARTED: number;
  STARTED: number;
  LEARNING: number;
  NEEDS_REVIEW: number;
  GOOD: number;
  MASTERED: number;
};

export type OwnerReviewDistribution = {
  INSUFFICIENT_EVIDENCE: number;
  FRESH: number;
  DUE_SOON: number;
  DUE: number;
  OVERDUE: number;
};

export type OwnerForgettingDistribution = {
  OBJECTIVE: number;
  SELF_REPORTED: number;
  MIXED: number;
  NONE: number;
};

export type OwnerCurrentStateMetrics = {
  mastery: {
    trackedUserLecturePairs: number;
    baseDistribution: OwnerMasteryDistribution;
    freshEffectiveDistribution: OwnerMasteryDistribution;
    freshRetentionRows: number;
    staleRetentionRows: number;
    missingRetentionRows: number;
  };
  retention: {
    reviewDistribution: OwnerReviewDistribution;
    forgettingEvidenceDistribution: OwnerForgettingDistribution;
    freshRows: number;
    staleRows: number;
    missingRows: number;
  };
};

export type OwnerAnalyticsFreshness = {
  asOf: string;
  masteryRows: number;
  retention: {
    freshRows: number;
    staleRows: number;
    missingRows: number;
  };
  resourceMetricsAvailable: boolean;
};

export type OwnerParticipationRates = {
  activeStudyUsers: OwnerAnalyticsRate;
  meaningfulFocusUsers: OwnerAnalyticsRate;
  normalMcqUsers: OwnerAnalyticsRate;
  flashcardUsers: OwnerAnalyticsRate;
  periodicRecallUsers: OwnerAnalyticsRate;
};

export type OwnerSubjectAggregate = {
  /** Lecture.mainSubject is the repository's only canonical subject grouping key. */
  subjectId: string;
  lectureCount: number;
  activeStudyUsers: number;
  activityWindowMetrics: OwnerActivityWindowMetrics;
  currentStateMetrics: OwnerCurrentStateMetrics;
};

export type OwnerLectureAggregate = {
  lectureId: string;
  subjectId: string | null;
  samples: {
    /** Distinct eligible users with a tracked LectureMastery row for this lecture. */
    trackedUsers: number;
    activeStudyUsers: number;
  };
  activityWindowMetrics: OwnerActivityWindowMetrics;
  currentStateMetrics: OwnerCurrentStateMetrics;
};

export type OwnerAcademicAggregates = {
  analyticsVersion: "owner-academic-analytics-v1";
  window: {
    from: string;
    to: string;
    asOf: string;
  };
  population: {
    eligibleStudents: number;
    activeStudyUsers: number;
    activeStudyRate: OwnerAnalyticsRate;
  };
  participationRates: OwnerParticipationRates;
  /** All activity metrics use the bounded window; current states use asOf. */
  activityWindowMetrics: OwnerActivityWindowMetrics;
  currentStateMetrics: OwnerCurrentStateMetrics;
  freshness: OwnerAnalyticsFreshness;
  subjects: OwnerSubjectAggregate[];
  /** Empty unless a bounded lectureIds filter was supplied. */
  lectures: OwnerLectureAggregate[];
};

export type OwnerMetricSourceDefinition = {
  metricId: string;
  canonicalSource: string;
  timeField?: string;
  aggregation: string;
  semanticNotes: string;
};