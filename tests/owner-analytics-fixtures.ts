import { rateMetric } from "../server/features/owner-analytics/rate.js";
import type {
  OwnerAcademicAggregates,
  OwnerForgettingDistribution,
  OwnerMasteryDistribution,
  OwnerReviewDistribution,
} from "../server/features/owner-analytics/types.js";

function emptyMastery(): OwnerMasteryDistribution {
  return {
    NOT_STARTED: 0,
    STARTED: 0,
    LEARNING: 0,
    NEEDS_REVIEW: 0,
    GOOD: 0,
    MASTERED: 0,
  };
}

function emptyReview(): OwnerReviewDistribution {
  return {
    INSUFFICIENT_EVIDENCE: 0,
    FRESH: 0,
    DUE_SOON: 0,
    DUE: 0,
    OVERDUE: 0,
  };
}

function emptyForgetting(): OwnerForgettingDistribution {
  return {
    OBJECTIVE: 0,
    SELF_REPORTED: 0,
    MIXED: 0,
    NONE: 0,
  };
}

export function createOwnerAcademicAggregateFixture(): OwnerAcademicAggregates {
  const asOf = new Date("2026-09-27T12:00:00.000Z");
  return {
    analyticsVersion: "owner-academic-analytics-v1",
    window: {
      from: "2026-09-21T21:00:00.000Z",
      to: asOf.toISOString(),
      asOf: asOf.toISOString(),
    },
    population: {
      eligibleStudents: 100,
      activeStudyUsers: 0,
      activeStudyRate: rateMetric(0, 100),
    },
    participationRates: {
      activeStudyUsers: rateMetric(0, 100),
      meaningfulFocusUsers: rateMetric(0, 100),
      normalMcqUsers: rateMetric(0, 100),
      flashcardUsers: rateMetric(0, 100),
      periodicRecallUsers: rateMetric(0, 100),
    },
    activityWindowMetrics: {
      focus: {
        meaningfulSessionCount: 0,
        verifiedStudySeconds: 0,
        uniqueUsers: 0,
        averageMeaningfulSessionSeconds: null,
        averageMeaningfulSessionSecondsDenominator: 0,
      },
      groupFocus: {
        completedRuns: 0,
        verifiedParticipantSessions: 0,
        verifiedFocusSeconds: 0,
        uniqueParticipants: 0,
      },
      mcq: {
        objectiveAttempts: 0,
        objectiveCorrect: 0,
        objectiveIncorrect: 0,
        uniqueUsers: 0,
        distinctItemsAttempted: 0,
        accuracyRate: rateMetric(0, 0),
      },
      flashcards: {
        meaningfulReviews: 0,
        selfReportedRemembered: 0,
        selfReportedNotRemembered: 0,
        selfReportedOutcomeCount: 0,
        uniqueUsers: 0,
        distinctCardsReviewed: 0,
        selfReportedRememberedRate: rateMetric(0, 0),
      },
      recall: {
        periodicPresented: 0,
        periodicAnswered: 0,
        periodicSkipped: 0,
        periodicExpired: 0,
        objectiveMcqAnswered: 0,
        objectiveMcqCorrect: 0,
        objectiveMcqIncorrect: 0,
        objectiveMcqAccuracyRate: rateMetric(0, 0),
        flashcardRemembered: 0,
        flashcardNotRemembered: 0,
        uniqueUsers: 0,
      },
      resources: {
        resourceLaunches: null,
        resourceHandoffs: 0,
        uniqueUsersWithResourceHandoffs: 0,
        handoffsByType: { PDF: 0, VIDEO: 0 },
        launchMetricsAvailable: false,
        handoffMetricsAvailable: true,
      },
    },
    currentStateMetrics: {
      mastery: {
        trackedUserLecturePairs: 0,
        baseDistribution: emptyMastery(),
        freshEffectiveDistribution: emptyMastery(),
        freshRetentionRows: 0,
        staleRetentionRows: 0,
        missingRetentionRows: 0,
      },
      retention: {
        reviewDistribution: emptyReview(),
        forgettingEvidenceDistribution: emptyForgetting(),
        freshRows: 0,
        staleRows: 0,
        missingRows: 0,
      },
    },
    freshness: {
      asOf: asOf.toISOString(),
      masteryRows: 0,
      retention: { freshRows: 0, staleRows: 0, missingRows: 0 },
      resourceMetricsAvailable: true,
    },
    subjects: [],
    lectures: [],
    privacyMetadata: {
      cohort: {
        activity: {
          activeStudyUsers: 0,
          focusUsers: 0,
          groupFocusUsers: 0,
          mcqUsers: 0,
          flashcardUsers: 0,
          recallPresentedUsers: 0,
          recallAnsweredUsers: 0,
          recallSkippedUsers: 0,
          recallExpiredUsers: 0,
          recallObjectiveMcqUsers: 0,
          recallFlashcardRememberedUsers: 0,
          recallFlashcardNotRememberedUsers: 0,
          resourceUsers: 0,
          resourcePdfUsers: 0,
          resourceVideoUsers: 0,
        },
        currentState: {
          trackedUsers: 0,
          baseMasteryBucketUsers: emptyMastery(),
          effectiveMasteryBucketUsers: emptyMastery(),
          freshRetentionUsers: 0,
          staleRetentionUsers: 0,
          missingRetentionUsers: 0,
          reviewBucketUsers: emptyReview(),
          forgettingBucketUsers: emptyForgetting(),
        },
      },
      subjects: {},
      lectures: {},
    },
  };
}