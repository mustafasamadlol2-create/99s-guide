import type {
  STUDY_ANALYZER_FOCUS_DURATION_BUCKETS,
  STUDY_ANALYZER_TIME_BUCKETS,
  STUDY_ANALYZER_VERSION,
  STUDY_ANALYZER_FACT_REGISTRY_VERSION,
} from "./constants.js";

export type AnalyzerTrendState =
  | "IMPROVED"
  | "STABLE"
  | "DECLINED"
  | "INSUFFICIENT_DATA";

export type AnalyzerWindowStatus = "AVAILABLE" | "UNAVAILABLE";
export type StudyAnalyzerWindowName = "last7Days" | "last30Days" | "currentSemester";
export type Windowed<T> = Record<StudyAnalyzerWindowName, T>;
export type FocusDurationBucketId =
  (typeof STUDY_ANALYZER_FOCUS_DURATION_BUCKETS)[number]["id"];
export type StudyTimeBucketId = (typeof STUDY_ANALYZER_TIME_BUCKETS)[number]["id"];

export type StudyAnalyzerWindow = {
  status: AnalyzerWindowStatus;
  from: string | null;
  to: string;
  asOf: string;
  code?: "SEMESTER_CONFIGURATION_UNAVAILABLE";
};

export type StudyAnalyzerSourceQuality = {
  available: boolean;
  collectionEnabled: boolean;
  complete: boolean;
  truncated: boolean;
  coverageStart: string | null;
};

export type StudyAnalyzerDataQuality = {
  trackedLectureCount: number | null;
  masteryRows: number | null;
  retention: {
    freshRows: number | null;
    staleRows: number | null;
    missingRows: number | null;
  };
  mcqDataAvailable: boolean;
  flashcardDataAvailable: boolean;
  recallDataAvailable: boolean;
  focusDataAvailable: boolean;
  groupFocusDataAvailable: boolean;
  masteryDataAvailable: boolean;
  retentionDataAvailable: boolean;
  sources: {
    focus: StudyAnalyzerSourceQuality;
    groupFocus: StudyAnalyzerSourceQuality;
    mcq: StudyAnalyzerSourceQuality;
    flashcards: StudyAnalyzerSourceQuality;
    recall: StudyAnalyzerSourceQuality;
    mastery: StudyAnalyzerSourceQuality;
    retention: StudyAnalyzerSourceQuality;
    lectureSubjects: StudyAnalyzerSourceQuality;
  };
  incompleteWindows: StudyAnalyzerWindowName[];
  insufficientForTimeOfDayPattern: boolean;
  insufficientForSessionLengthPattern: boolean;
  subjectFactsTruncated: boolean;
};

export type ObjectiveMetric = {
  attempts: number | null;
  correct: number | null;
  incorrect: number | null;
  accuracyRateBps: number | null;
};

export type FlashcardMetric = {
  meaningfulReviews: number | null;
  selfReportedRemembered: number | null;
  selfReportedNotRemembered: number | null;
  selfReportedNeutral: number | null;
  selfReportedRememberedRateBps: number | null;
  distinctCardsReviewed: number | null;
};

export type FocusCompletionMetric = {
  completedSessions: number | null;
  terminalSessions: number | null;
  completionRateBps: number | null;
};

export type StudyWeaknessSignalId =
  | "REPEATED_OBJECTIVE_ERRORS"
  | "LOW_RECENT_OBJECTIVE_ACCURACY"
  | "MASTERY_NEEDS_REVIEW"
  | "RETENTION_DUE"
  | "RETENTION_OVERDUE"
  | "FLASHCARD_NOT_REMEMBERED_PATTERN"
  | "FOCUS_FREQUENTLY_UNCOMPLETED"
  | "LOW_RECENT_STUDY_CONSISTENCY";

export type StudyPositiveSignalId =
  | "OBJECTIVE_ACCURACY_IMPROVED"
  | "CONSISTENCY_IMPROVED"
  | "HIGH_FOCUS_COMPLETION";

export type StudySignalScope = "GLOBAL" | "SUBJECT" | "LECTURE" | "ITEM";
export type StudySignalSeverity = "LOW" | "MODERATE" | "HIGH";

export type StudySignalEvidence = {
  metricId: string;
  numerator?: number;
  denominator?: number;
  rateBps?: number;
  count?: number;
  window?: string;
  lastEvidenceAt?: string;
};

export type StudyWeaknessSignal = {
  id: StudyWeaknessSignalId;
  scope: StudySignalScope;
  subjectId?: string;
  lectureId?: string;
  itemId?: string;
  evidence: StudySignalEvidence;
  severity: StudySignalSeverity;
};

export type StudyPositiveSignal = {
  id: StudyPositiveSignalId;
  scope: StudySignalScope;
  evidence: StudySignalEvidence;
};

export type StudyAnalyzerDto = {
  analyzerVersion: typeof STUDY_ANALYZER_VERSION;
  factRegistryVersion: typeof STUDY_ANALYZER_FACT_REGISTRY_VERSION;
  generatedAt: string;
  asOf: string;
  timezone: "Asia/Baghdad";
  windows: Record<StudyAnalyzerWindowName, StudyAnalyzerWindow>;
  dataQuality: StudyAnalyzerDataQuality;
  activity: {
    activeStudyDays: Windowed<number | null>;
    activeDayEvidenceTypes: string[];
    activeDayTimeBasisBySource: {
      soloFocus: "ACTUAL_ENDED_AT";
      groupFocus: "RUNTIME_ENDED_AT";
      studyEvents: "RECEIVED_AT";
      recall: "ANSWERED_AT";
    };
    excludedActivityEvidence: string[];
  };
  focus: {
    meaningfulThresholdSeconds: number;
    meaningfulCompletedSessions: Windowed<number | null>;
    verifiedFocusSeconds: Windowed<number | null>;
    averageMeaningfulSessionSeconds: Windowed<number | null>;
    uncompletedSessionCount: Windowed<number | null>;
    completion: Windowed<FocusCompletionMetric>;
    durationDistributionLast30Days: Array<{
      bucket: FocusDurationBucketId;
      meaningfulSessions: number | null;
      verifiedFocusSeconds: number | null;
    }>;
    completionStatusesIncluded: string[];
    uncompletedStatusesIncluded: string[];
  };
  consistency: {
    activeStudyDays: Windowed<number | null>;
    activeStudyDayRateBpsLast30Days: number | null;
    currentConsistencyStreakDays: number | null;
    streakCappedAtLookback: boolean;
    streakAnchorRule: "TODAY_OR_YESTERDAY";
    currentWeekActiveDays: number | null;
    daysElapsedInCurrentWeek: number;
    completedWeeks: Array<{
      from: string;
      toExclusive: string;
      activeDays: number | null;
      activeDayRateBps: number | null;
    }>;
    trend: {
      state: AnalyzerTrendState;
      latestActiveDays: number | null;
      previousActiveDays: number | null;
      minimumChangeDays: number;
    };
  };
  objectivePractice: {
    normalMcq: Windowed<ObjectiveMetric>;
    recallObjective: Windowed<ObjectiveMetric>;
    combinedObjective: Windowed<ObjectiveMetric>;
    trend: {
      state: AnalyzerTrendState;
      latest: ObjectiveMetric;
      previous: ObjectiveMetric;
      sampleStrategy: "LATEST_20_VS_PREVIOUS_20_OR_EQUAL_HALVES";
      minimumTotalOutcomes: number;
      changeThresholdBps: number;
    };
    repeatedErrors: Array<{
      itemId: string;
      lectureId: string;
      subjectId: string | null;
      recentIncorrectCount: number;
      recentCorrectCount: number;
      lastOutcome: "INCORRECT";
      lastAttemptAt: string;
    }>;
  };
  flashcards: {
    reviews: Windowed<FlashcardMetric>;
  };
  recall: {
    periodicActivityWindowBasis: "PRESENTED_AT";
    periodicActivity: Windowed<{
      presented: number | null;
      answered: number | null;
      skipped: number | null;
      expired: number | null;
    }>;
    answeredOutcomes: Windowed<{
      objectiveCorrect: number | null;
      objectiveIncorrect: number | null;
      flashcardRemembered: number | null;
      flashcardNotRemembered: number | null;
      flashcardNeutral: number | null;
    }>;
    skipAndExpiryAreLearningFailures: false;
  };
  mastery: {
    trackedLectureCount: number | null;
    baseMasteryDistribution: Record<string, number> | null;
    effectiveMasteryDistributionFreshOnly: Record<string, number> | null;
    projectionEvaluatedAt: {
      oldest: string | null;
      newest: string | null;
    };
    historicalImprovementAvailable: false;
  };
  retention: {
    freshRows: number | null;
    staleRows: number | null;
    missingRows: number | null;
    due: number | null;
    overdue: number | null;
    needsReview: number | null;
    dueReviews: Array<{
      lectureId: string;
      subjectId: string | null;
      effectiveMasteryState: string;
      reviewState: string;
      reviewUrgencyScore: number;
      nextReviewAt: string | null;
      hasActiveObjectiveForgetting: boolean;
    }> | null;
    staleRetentionPresentedAsCurrent: false;
  };
  subjects: Array<{
    subjectId: string;
    activeStudyDaysLast30Days: number | null;
    meaningfulFocusSecondsLast30Days: number | null;
    objectiveAttemptsLast30Days: number | null;
    objectiveCorrectLast30Days: number | null;
    objectiveAccuracyRateBpsLast30Days: number | null;
    flashcardReviewsLast30Days: number | null;
    recallAnsweredLast30Days: number | null;
    trackedLectures: number | null;
    effectiveMasteryDistributionFreshOnly: Record<string, number> | null;
    dueReviewCount: number | null;
  }>;
  weaknesses: StudyWeaknessSignal[];
  positives: StudyPositiveSignal[];
  patterns: {
    sessionLength: {
      status: "SUPPORTED_PATTERN" | "INSUFFICIENT_DATA";
      interpretationScope: "OBSERVED_ASSOCIATION";
      window: "LAST_90_DAYS";
      bucket?: FocusDurationBucketId;
      linkedSessions?: number;
      objectiveAttempts?: number;
      objectiveCorrect?: number;
      objectiveCorrectRateBps?: number;
      minimumMeaningfulSessions: number;
      minimumLinkedSessionsPerBucket: number;
      outcomeLinkWindowHours: 24;
      tieBreakOrder: string[];
    };
    timeOfDay: {
      mostUsedTimeOfDay: {
        status: "SUPPORTED_PATTERN" | "INSUFFICIENT_DATA";
        bucket?: StudyTimeBucketId;
        meaningfulSessions?: number;
        minimumSessions: number;
      };
      bestSupportedOutcomeTimeBucket: {
        status: "SUPPORTED_PATTERN" | "INSUFFICIENT_DATA";
        interpretationScope: "OBSERVED_ASSOCIATION";
        window: "LAST_90_DAYS";
        bucket?: StudyTimeBucketId;
        linkedSessions?: number;
        objectiveAttempts?: number;
        objectiveCorrect?: number;
        objectiveCorrectRateBps?: number;
        minimumMeaningfulSessions: number;
        minimumLinkedSessionsPerBucket: number;
        outcomeLinkWindowHours: 24;
        tieBreakOrder: string[];
      };
      bucketBoundariesBaghdad: Record<StudyTimeBucketId, string>;
    };
  };
};

export type StudyAnalyzerEventRow = {
  id: string;
  eventType: string;
  source: string;
  evidenceClass: string;
  privacyClass: string;
  occurredAt: Date;
  receivedAt: Date;
  lectureId: string | null;
  mcqId: string | null;
  flashcardId: string | null;
  payload: unknown;
  mcq?: { lectureId: string; lecture?: { mainSubject: string | null } } | null;
  flashcard?: { lectureId: string; lecture?: { mainSubject: string | null } } | null;
};

export type StudyAnalyzerRecallRow = {
  id: string;
  itemType: string;
  itemId: string;
  lectureId: string;
  status: string;
  presentedAt: Date;
  answeredAt: Date | null;
  skippedAt: Date | null;
  expiredAt: Date | null;
  outcome: string | null;
  issuanceSource: string | null;
  evidenceClass: string;
  privacyClass: string;
};

export type StudyAnalyzerFocusRow = {
  id: string;
  lectureId: string;
  status: string;
  startedAt: Date | null;
  actualEndedAt: Date | null;
  activeSeconds: number;
  lecture?: { mainSubject: string | null } | null;
};

export type StudyAnalyzerGroupFocusRow = {
  id: string;
  effectiveLectureId: string;
  firstConnectedAt: Date;
  verifiedFocusSeconds: number;
  effectiveLecture?: { mainSubject: string | null } | null;
  run: {
    runtimeStartedAt: Date;
    runtimeEndedAt: Date;
    terminalReason: string;
  };
};

export type StudyAnalyzerMasteryRow = {
  lectureId: string;
  state: string;
  revision: number;
  ruleVersion: string;
  lastEvaluatedAt: Date;
  lecture: { mainSubject: string | null };
};

export type StudyAnalyzerRetentionRow = {
  lectureId: string;
  sourceMasteryRevision: number;
  sourceMasteryRuleVersion: string;
  effectiveMasteryState: string;
  reviewState: string;
  reviewUrgencyScore: number;
  nextReviewAt: Date | null;
  nextEvaluationAt: Date | null;
  ruleVersion: string;
  objectiveForgettingItemCount: number;
};

export type StudyAnalyzerSourceSlice<T> = {
  available: boolean;
  complete: boolean;
  truncated: boolean;
  coverageStart: Date | null;
  rows: T[];
};

export type StudyAnalyzerSnapshot = {
  focus: StudyAnalyzerSourceSlice<StudyAnalyzerFocusRow>;
  groupFocus: StudyAnalyzerSourceSlice<StudyAnalyzerGroupFocusRow>;
  mcq: StudyAnalyzerSourceSlice<StudyAnalyzerEventRow>;
  flashcards: StudyAnalyzerSourceSlice<StudyAnalyzerEventRow>;
  recall: StudyAnalyzerSourceSlice<StudyAnalyzerRecallRow>;
  mastery: StudyAnalyzerSourceSlice<StudyAnalyzerMasteryRow> & {
    trackedLectureCount: number | null;
  };
  retention: StudyAnalyzerSourceSlice<StudyAnalyzerRetentionRow>;
  lectureSubjects: StudyAnalyzerSourceSlice<{
    id: string;
    mainSubject: string | null;
  }>;
};