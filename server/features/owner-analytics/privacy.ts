import type {
  OwnerAcademicAggregates,
  OwnerAnalyticsRate,
  OwnerAnalyticsScopePrivacyMetadata,
  OwnerForgettingDistribution,
  OwnerMasteryDistribution,
  OwnerReviewDistribution,
} from "./types.js";
import { rateMetric } from "./rate.js";

export const OWNER_ANALYTICS_PRIVACY_VERSION = "owner-analytics-privacy-v1" as const;
export const MIN_OWNER_ANALYTICS_CONTRIBUTORS = 10;
export const MIN_OWNER_ANALYTICS_INTERACTIONS = 20;

export type OwnerAnalyticsSuppressionReason =
  | "LOW_SAMPLE"
  | "LOW_INTERACTION_COUNT"
  | "DISTRIBUTION_PRIVACY";

export type AnalyticsDisclosure<T> =
  | {
      status: "VISIBLE";
      value: T;
      contributingUsers: number;
    }
  | {
      status: "NO_DATA";
      value: T;
      contributingUsers: 0;
    }
  | {
      status: "SUPPRESSED";
      value: null;
      contributingUsers: null;
      reason: OwnerAnalyticsSuppressionReason;
    }
  | {
      status: "UNAVAILABLE";
      value: null;
      contributingUsers: null;
      reason: "SOURCE_UNAVAILABLE";
    };

export type OwnerAnalyticsScopeStatus =
  | "VISIBLE"
  | "PARTIALLY_SUPPRESSED"
  | "LOW_SAMPLE"
  | "LOW_POPULATION"
  | "NO_DATA"
  | "UNAVAILABLE";

type OwnerSafeFocusCounts = {
  meaningfulSessionCount: number;
  verifiedStudySeconds: number;
  uniqueUsers: number;
};

type OwnerSafeRecallObjectiveMetrics = {
  objectiveMcqAnswered: number;
  objectiveMcqCorrect: number;
  objectiveMcqIncorrect: number;
  objectiveMcqAccuracyRate: OwnerAnalyticsRate;
};

type OwnerSafeResourceMetrics = {
  resourceHandoffs: number;
  handoffsByType: {
    PDF: number;
    VIDEO: number;
  };
};

type OwnerSafeSensitiveCurrentState = {
  mastery: {
    trackedUserLecturePairs: number;
    baseDistribution: OwnerMasteryDistribution;
    freshEffectiveDistribution: OwnerMasteryDistribution;
  };
  retention: {
    freshnessDistribution: {
      freshRows: number;
      staleRows: number;
      missingRows: number;
    };
    reviewDistribution: OwnerReviewDistribution;
    forgettingEvidenceDistribution: OwnerForgettingDistribution;
  };
};

export type OwnerSafeActivityWindowMetrics = {
  focus: AnalyticsDisclosure<OwnerSafeFocusCounts>;
  focusAverageMeaningfulSessionSeconds: AnalyticsDisclosure<number | null>;
  groupFocus: AnalyticsDisclosure<{
    completedRuns: number;
    verifiedParticipantSessions: number;
    verifiedFocusSeconds: number;
    uniqueParticipants: number;
  }>;
  mcq: AnalyticsDisclosure<{
    objectiveAttempts: number;
    objectiveCorrect: number;
    objectiveIncorrect: number;
    distinctItemsAttempted: number;
    accuracyRate: OwnerAnalyticsRate;
  }>;
  flashcards: AnalyticsDisclosure<{
    meaningfulReviews: number;
    selfReportedRemembered: number;
    selfReportedNotRemembered: number;
    selfReportedOutcomeCount: number;
    distinctCardsReviewed: number;
    selfReportedRememberedRate: OwnerAnalyticsRate;
  }>;
  recall: {
    periodicPresented: AnalyticsDisclosure<number>;
    periodicAnswered: AnalyticsDisclosure<number>;
    periodicSkipped: AnalyticsDisclosure<number>;
    periodicExpired: AnalyticsDisclosure<number>;
    objectiveMcq: AnalyticsDisclosure<OwnerSafeRecallObjectiveMetrics>;
    flashcardRemembered: AnalyticsDisclosure<number>;
    flashcardNotRemembered: AnalyticsDisclosure<number>;
  };
  resources: {
    handoffs: AnalyticsDisclosure<OwnerSafeResourceMetrics>;
    launches: AnalyticsDisclosure<null>;
  };
};

export type OwnerSafeCurrentStateMetrics =
  AnalyticsDisclosure<OwnerSafeSensitiveCurrentState>;

export type OwnerSafeScopeMetrics = {
  activeStudyUsers: AnalyticsDisclosure<number>;
  activeStudyRate: AnalyticsDisclosure<OwnerAnalyticsRate>;
  participationRates: {
    meaningfulFocusUsers: AnalyticsDisclosure<OwnerAnalyticsRate>;
    normalMcqUsers: AnalyticsDisclosure<OwnerAnalyticsRate>;
    flashcardUsers: AnalyticsDisclosure<OwnerAnalyticsRate>;
    periodicRecallUsers: AnalyticsDisclosure<OwnerAnalyticsRate>;
  };
  activityWindowMetrics: OwnerSafeActivityWindowMetrics;
  currentStateMetrics: OwnerSafeCurrentStateMetrics;
};

export type OwnerSafeScope = OwnerSafeScopeMetrics & {
  analyticsStatus: OwnerAnalyticsScopeStatus;
  eligibleStudents: number;
};

export type OwnerSafeSubject = OwnerSafeScope & {
  subjectId: string;
  lectureCount: number;
};

export type OwnerSafeLecture = OwnerSafeScope & {
  lectureId: string;
  subjectId: string | null;
};

export type OwnerSafeAcademicAnalytics = {
  analyticsVersion: OwnerAcademicAggregates["analyticsVersion"];
  privacy: {
    policyVersion: typeof OWNER_ANALYTICS_PRIVACY_VERSION;
    minimumContributors: number;
    minimumRateInteractions: number;
  };
  window: OwnerAcademicAggregates["window"];
  cohort: OwnerSafeScope;
  subjects: OwnerSafeSubject[];
  lectures: OwnerSafeLecture[];
};

type ScopeAggregate = {
  activeStudyUsers: number;
  activityWindowMetrics: OwnerAcademicAggregates["activityWindowMetrics"];
  currentStateMetrics: OwnerAcademicAggregates["currentStateMetrics"];
};

function suppressed<T>(reason: OwnerAnalyticsSuppressionReason): AnalyticsDisclosure<T> {
  return {
    status: "SUPPRESSED",
    value: null,
    contributingUsers: null,
    reason,
  };
}

function noData<T>(value: T): AnalyticsDisclosure<T> {
  return { status: "NO_DATA", value, contributingUsers: 0 };
}

function unavailable<T>(): AnalyticsDisclosure<T> {
  return {
    status: "UNAVAILABLE",
    value: null,
    contributingUsers: null,
    reason: "SOURCE_UNAVAILABLE",
  };
}

function discloseCount<T>(
  value: T,
  contributingUsers: number,
  isZero: boolean,
  scopePopulation: number,
): AnalyticsDisclosure<T> {
  if (scopePopulation < MIN_OWNER_ANALYTICS_CONTRIBUTORS) {
    return suppressed("LOW_SAMPLE");
  }
  if (isZero && contributingUsers === 0) return noData(value);
  if (contributingUsers < MIN_OWNER_ANALYTICS_CONTRIBUTORS) {
    return suppressed("LOW_SAMPLE");
  }
  return { status: "VISIBLE", value, contributingUsers };
}

function discloseRate(
  value: OwnerAnalyticsRate,
  contributingUsers: number,
  interactions: number,
  scopePopulation: number,
): AnalyticsDisclosure<OwnerAnalyticsRate> {
  if (scopePopulation < MIN_OWNER_ANALYTICS_CONTRIBUTORS) {
    return suppressed("LOW_SAMPLE");
  }
  if (contributingUsers === 0 && interactions === 0) return noData(value);
  if (contributingUsers < MIN_OWNER_ANALYTICS_CONTRIBUTORS) {
    return suppressed("LOW_SAMPLE");
  }
  if (interactions < MIN_OWNER_ANALYTICS_INTERACTIONS) {
    return suppressed("LOW_INTERACTION_COUNT");
  }
  return { status: "VISIBLE", value, contributingUsers };
}

function discloseDerivedRate(
  numerator: number,
  denominator: number,
  contributingUsers: number,
  interactions: number,
  scopePopulation: number,
): AnalyticsDisclosure<OwnerAnalyticsRate> {
  if (scopePopulation < MIN_OWNER_ANALYTICS_CONTRIBUTORS) {
    return suppressed("LOW_SAMPLE");
  }
  if (contributingUsers === 0 && interactions === 0) {
    return noData(rateMetric(numerator, denominator));
  }
  if (contributingUsers < MIN_OWNER_ANALYTICS_CONTRIBUTORS) {
    return suppressed("LOW_SAMPLE");
  }
  if (interactions < MIN_OWNER_ANALYTICS_INTERACTIONS) {
    return suppressed("LOW_INTERACTION_COUNT");
  }
  return {
    status: "VISIBLE",
    value: rateMetric(numerator, denominator),
    contributingUsers,
  };
}

function sumBuckets(value: Record<string, number>): number {
  return Object.values(value).reduce((total, count) => total + count, 0);
}

function distributionIsSafe<T extends Record<string, number>>(
  values: T,
  contributorsByBucket: T,
  totalContributors: number,
): boolean {
  if (totalContributors === 0 && sumBuckets(values) === 0) return true;
  if (totalContributors < MIN_OWNER_ANALYTICS_CONTRIBUTORS) return false;
  return Object.keys(values).every((key) => {
    const count = values[key] ?? 0;
    const contributors = contributorsByBucket[key] ?? 0;
    return count === 0 || contributors >= MIN_OWNER_ANALYTICS_CONTRIBUTORS;
  });
}

function sensitiveStateDisclosure(
  value: OwnerSafeSensitiveCurrentState,
  metadata: OwnerAnalyticsScopePrivacyMetadata["currentState"],
  scopePopulation: number,
): OwnerSafeCurrentStateMetrics {
  if (scopePopulation < MIN_OWNER_ANALYTICS_CONTRIBUTORS) {
    return suppressed("LOW_SAMPLE");
  }

  const hasAnyRows =
    value.mastery.trackedUserLecturePairs > 0
    || value.retention.freshnessDistribution.freshRows > 0
    || value.retention.freshnessDistribution.staleRows > 0
    || value.retention.freshnessDistribution.missingRows > 0;
  if (!hasAnyRows && metadata.trackedUsers === 0) return noData(value);

  if (metadata.trackedUsers < MIN_OWNER_ANALYTICS_CONTRIBUTORS) {
    return suppressed("LOW_SAMPLE");
  }

  const distributionsAreSafe =
    distributionIsSafe(
      value.mastery.baseDistribution,
      metadata.baseMasteryBucketUsers,
      metadata.trackedUsers,
    )
    && distributionIsSafe(
      value.mastery.freshEffectiveDistribution,
      metadata.effectiveMasteryBucketUsers,
      metadata.freshRetentionUsers,
    )
    && distributionIsSafe(
      value.retention.reviewDistribution,
      metadata.reviewBucketUsers,
      metadata.freshRetentionUsers,
    )
    && distributionIsSafe(
      value.retention.forgettingEvidenceDistribution,
      metadata.forgettingBucketUsers,
      metadata.freshRetentionUsers,
    )
    && distributionIsSafe(
      value.retention.freshnessDistribution,
      {
        freshRows: metadata.freshRetentionUsers,
        staleRows: metadata.staleRetentionUsers,
        missingRows: metadata.missingRetentionUsers,
      },
      metadata.trackedUsers,
    );
  if (!distributionsAreSafe) return suppressed("DISTRIBUTION_PRIVACY");

  return {
    status: "VISIBLE",
    value,
    contributingUsers: metadata.trackedUsers,
  };
}

function disclosureStatuses(value: unknown): Array<AnalyticsDisclosure<unknown>["status"]> {
  if (!value || typeof value !== "object") return [];
  if ("status" in value) {
    const status = (value as { status?: unknown }).status;
    if (
      status === "VISIBLE"
      || status === "NO_DATA"
      || status === "SUPPRESSED"
      || status === "UNAVAILABLE"
    ) {
      return [status];
    }
  }
  return Object.values(value).flatMap(disclosureStatuses);
}

function scopeStatus(
  metrics: OwnerSafeScopeMetrics,
  scopePopulation: number,
): OwnerAnalyticsScopeStatus {
  if (scopePopulation < MIN_OWNER_ANALYTICS_CONTRIBUTORS) return "LOW_POPULATION";
  const statuses = disclosureStatuses(metrics)
    .filter((status) => status !== "UNAVAILABLE");
  const hasSuppressed = statuses.includes("SUPPRESSED");
  const hasVisible = statuses.includes("VISIBLE");
  if (hasSuppressed && hasVisible) return "PARTIALLY_SUPPRESSED";
  if (hasVisible) return "VISIBLE";
  if (hasSuppressed) return "LOW_SAMPLE";
  return "NO_DATA";
}

function transformScope(
  scope: ScopeAggregate,
  metadata: OwnerAnalyticsScopePrivacyMetadata,
  eligibleStudents: number,
  scopePopulation: number,
): OwnerSafeScope {
  const activity = scope.activityWindowMetrics;
  const current = scope.currentStateMetrics;
  const privacy = metadata.activity;

  const focusCounts: OwnerSafeFocusCounts = {
    meaningfulSessionCount: activity.focus.meaningfulSessionCount,
    verifiedStudySeconds: activity.focus.verifiedStudySeconds,
    uniqueUsers: activity.focus.uniqueUsers,
  };
  const focusHasNoData = focusCounts.meaningfulSessionCount === 0
    && focusCounts.verifiedStudySeconds === 0;
  const focusDisclosure = discloseCount(
    focusCounts,
    privacy.focusUsers,
    focusHasNoData,
    scopePopulation,
  );
  const focusAverage = discloseRate(
    { numerator: focusCounts.verifiedStudySeconds, denominator: focusCounts.meaningfulSessionCount, rateBps: null },
    privacy.focusUsers,
    focusCounts.meaningfulSessionCount,
    scopePopulation,
  );
  const safeFocusAverage: AnalyticsDisclosure<number | null> = focusAverage.status === "VISIBLE"
    ? {
        status: "VISIBLE",
        value: activity.focus.averageMeaningfulSessionSeconds,
        contributingUsers: focusAverage.contributingUsers,
      }
    : focusAverage.status === "NO_DATA"
      ? noData(null)
      : focusAverage;

  const mcqDisclosure = discloseRate(
    activity.mcq.accuracyRate,
    privacy.mcqUsers,
    activity.mcq.objectiveAttempts,
    scopePopulation,
  );
  const safeMcq: OwnerSafeActivityWindowMetrics["mcq"] = mcqDisclosure.status === "VISIBLE"
    ? {
        status: "VISIBLE",
        value: {
          objectiveAttempts: activity.mcq.objectiveAttempts,
          objectiveCorrect: activity.mcq.objectiveCorrect,
          objectiveIncorrect: activity.mcq.objectiveIncorrect,
          distinctItemsAttempted: activity.mcq.distinctItemsAttempted,
          accuracyRate: activity.mcq.accuracyRate,
        },
        contributingUsers: mcqDisclosure.contributingUsers,
      }
    : mcqDisclosure.status === "NO_DATA"
      ? noData({
          objectiveAttempts: 0,
          objectiveCorrect: 0,
          objectiveIncorrect: 0,
          distinctItemsAttempted: 0,
          accuracyRate: activity.mcq.accuracyRate,
        })
      : mcqDisclosure;

  const flashcardDisclosure = discloseRate(
    activity.flashcards.selfReportedRememberedRate,
    privacy.flashcardUsers,
    activity.flashcards.meaningfulReviews,
    scopePopulation,
  );
  const safeFlashcards: OwnerSafeActivityWindowMetrics["flashcards"] =
    flashcardDisclosure.status === "VISIBLE"
      ? {
          status: "VISIBLE",
          value: {
            meaningfulReviews: activity.flashcards.meaningfulReviews,
            selfReportedRemembered: activity.flashcards.selfReportedRemembered,
            selfReportedNotRemembered: activity.flashcards.selfReportedNotRemembered,
            selfReportedOutcomeCount: activity.flashcards.selfReportedOutcomeCount,
            distinctCardsReviewed: activity.flashcards.distinctCardsReviewed,
            selfReportedRememberedRate: activity.flashcards.selfReportedRememberedRate,
          },
          contributingUsers: flashcardDisclosure.contributingUsers,
        }
      : flashcardDisclosure.status === "NO_DATA"
        ? noData({
            meaningfulReviews: 0,
            selfReportedRemembered: 0,
            selfReportedNotRemembered: 0,
            selfReportedOutcomeCount: 0,
            distinctCardsReviewed: 0,
            selfReportedRememberedRate: activity.flashcards.selfReportedRememberedRate,
          })
        : flashcardDisclosure;

  const recallObjectiveDisclosure = discloseRate(
    activity.recall.objectiveMcqAccuracyRate,
    privacy.recallObjectiveMcqUsers,
    activity.recall.objectiveMcqAnswered,
    scopePopulation,
  );
  const safeRecallObjective: OwnerSafeActivityWindowMetrics["recall"]["objectiveMcq"] =
    recallObjectiveDisclosure.status === "VISIBLE"
      ? {
          status: "VISIBLE",
          value: {
            objectiveMcqAnswered: activity.recall.objectiveMcqAnswered,
            objectiveMcqCorrect: activity.recall.objectiveMcqCorrect,
            objectiveMcqIncorrect: activity.recall.objectiveMcqIncorrect,
            objectiveMcqAccuracyRate: activity.recall.objectiveMcqAccuracyRate,
          },
          contributingUsers: recallObjectiveDisclosure.contributingUsers,
        }
      : recallObjectiveDisclosure.status === "NO_DATA"
        ? noData({
            objectiveMcqAnswered: 0,
            objectiveMcqCorrect: 0,
            objectiveMcqIncorrect: 0,
            objectiveMcqAccuracyRate: activity.recall.objectiveMcqAccuracyRate,
          })
        : recallObjectiveDisclosure;

  const resourceBreakdown = {
    resourceHandoffs: activity.resources.resourceHandoffs,
    handoffsByType: activity.resources.handoffsByType,
  };
  let resourceHandoffs: AnalyticsDisclosure<OwnerSafeResourceMetrics>;
  if (scopePopulation < MIN_OWNER_ANALYTICS_CONTRIBUTORS) {
    resourceHandoffs = suppressed("LOW_SAMPLE");
  } else if (activity.resources.resourceHandoffs === 0 && privacy.resourceUsers === 0) {
    resourceHandoffs = noData(resourceBreakdown);
  } else if (privacy.resourceUsers < MIN_OWNER_ANALYTICS_CONTRIBUTORS) {
    resourceHandoffs = suppressed("LOW_SAMPLE");
  } else if (
    (activity.resources.handoffsByType.PDF > 0
      && privacy.resourcePdfUsers < MIN_OWNER_ANALYTICS_CONTRIBUTORS)
    || (activity.resources.handoffsByType.VIDEO > 0
      && privacy.resourceVideoUsers < MIN_OWNER_ANALYTICS_CONTRIBUTORS)
  ) {
    resourceHandoffs = suppressed("DISTRIBUTION_PRIVACY");
  } else {
    resourceHandoffs = {
      status: "VISIBLE",
      value: resourceBreakdown,
      contributingUsers: privacy.resourceUsers,
    };
  }

  const activeStudyUsers = discloseCount(
    scope.activeStudyUsers,
    privacy.activeStudyUsers,
    scope.activeStudyUsers === 0,
    scopePopulation,
  );
  const activeStudyRate = discloseDerivedRate(
    scope.activeStudyUsers,
    eligibleStudents,
    privacy.activeStudyUsers,
    scope.activeStudyUsers,
    scopePopulation,
  );
  const safeParticipationRates = {
    meaningfulFocusUsers: discloseDerivedRate(
      activity.focus.uniqueUsers,
      eligibleStudents,
      privacy.focusUsers,
      activity.focus.meaningfulSessionCount,
      scopePopulation,
    ),
    normalMcqUsers: discloseDerivedRate(
      activity.mcq.uniqueUsers,
      eligibleStudents,
      privacy.mcqUsers,
      activity.mcq.objectiveAttempts,
      scopePopulation,
    ),
    flashcardUsers: discloseDerivedRate(
      activity.flashcards.uniqueUsers,
      eligibleStudents,
      privacy.flashcardUsers,
      activity.flashcards.meaningfulReviews,
      scopePopulation,
    ),
    periodicRecallUsers: discloseDerivedRate(
      activity.recall.uniqueUsers,
      eligibleStudents,
      privacy.recallPresentedUsers,
      activity.recall.periodicPresented,
      scopePopulation,
    ),
  };

  const safeCurrentState: OwnerSafeSensitiveCurrentState = {
    mastery: {
      trackedUserLecturePairs: current.mastery.trackedUserLecturePairs,
      baseDistribution: current.mastery.baseDistribution,
      freshEffectiveDistribution: current.mastery.freshEffectiveDistribution,
    },
    retention: {
      freshnessDistribution: {
        freshRows: current.retention.freshRows,
        staleRows: current.retention.staleRows,
        missingRows: current.retention.missingRows,
      },
      reviewDistribution: current.retention.reviewDistribution,
      forgettingEvidenceDistribution: current.retention.forgettingEvidenceDistribution,
    },
  };
  const currentStateMetrics = sensitiveStateDisclosure(
    safeCurrentState,
    metadata.currentState,
    scopePopulation,
  );

  const activityWindowMetrics: OwnerSafeActivityWindowMetrics = {
    focus: focusDisclosure,
    focusAverageMeaningfulSessionSeconds: safeFocusAverage,
    groupFocus: discloseCount(
      activity.groupFocus,
      privacy.groupFocusUsers,
      activity.groupFocus.completedRuns === 0
        && activity.groupFocus.verifiedParticipantSessions === 0
        && activity.groupFocus.verifiedFocusSeconds === 0,
      scopePopulation,
    ),
    mcq: safeMcq,
    flashcards: safeFlashcards,
    recall: {
      periodicPresented: discloseCount(
        activity.recall.periodicPresented,
        privacy.recallPresentedUsers,
        activity.recall.periodicPresented === 0,
        scopePopulation,
      ),
      periodicAnswered: discloseCount(
        activity.recall.periodicAnswered,
        privacy.recallAnsweredUsers,
        activity.recall.periodicAnswered === 0,
        scopePopulation,
      ),
      periodicSkipped: discloseCount(
        activity.recall.periodicSkipped,
        privacy.recallSkippedUsers,
        activity.recall.periodicSkipped === 0,
        scopePopulation,
      ),
      periodicExpired: discloseCount(
        activity.recall.periodicExpired,
        privacy.recallExpiredUsers,
        activity.recall.periodicExpired === 0,
        scopePopulation,
      ),
      objectiveMcq: safeRecallObjective,
      flashcardRemembered: discloseCount(
        activity.recall.flashcardRemembered,
        privacy.recallFlashcardRememberedUsers,
        activity.recall.flashcardRemembered === 0,
        scopePopulation,
      ),
      flashcardNotRemembered: discloseCount(
        activity.recall.flashcardNotRemembered,
        privacy.recallFlashcardNotRememberedUsers,
        activity.recall.flashcardNotRemembered === 0,
        scopePopulation,
      ),
    },
    resources: {
      handoffs: resourceHandoffs,
      launches: unavailable(),
    },
  };
  const metrics: OwnerSafeScopeMetrics = {
    activeStudyUsers,
    activeStudyRate,
    participationRates: safeParticipationRates,
    activityWindowMetrics,
    currentStateMetrics,
  };

  return {
    ...metrics,
    analyticsStatus: scopeStatus(metrics, scopePopulation),
    eligibleStudents,
  };
}

export function applyOwnerAnalyticsPrivacy(input: {
  aggregate: OwnerAcademicAggregates;
  policyVersion: typeof OWNER_ANALYTICS_PRIVACY_VERSION;
  scopePopulation: number;
}): OwnerSafeAcademicAnalytics {
  const { aggregate, policyVersion, scopePopulation } = input;
  if (
    !Number.isSafeInteger(scopePopulation)
    || scopePopulation < 0
  ) {
    throw new TypeError("Owner analytics scope population is invalid.");
  }

  const cohort = transformScope({
    activeStudyUsers: aggregate.population.activeStudyUsers,
    activityWindowMetrics: aggregate.activityWindowMetrics,
    currentStateMetrics: aggregate.currentStateMetrics,
  }, aggregate.privacyMetadata.cohort, scopePopulation, scopePopulation);

  const subjects = aggregate.subjects.map((subject) => {
    const metadata = aggregate.privacyMetadata.subjects[subject.subjectId];
    if (!metadata) throw new Error("Subject privacy metadata is unavailable.");
    return {
      subjectId: subject.subjectId,
      lectureCount: subject.lectureCount,
      ...transformScope({
        activeStudyUsers: subject.activeStudyUsers,
        activityWindowMetrics: subject.activityWindowMetrics,
        currentStateMetrics: subject.currentStateMetrics,
      }, metadata, scopePopulation, scopePopulation),
    };
  });

  const lectures = aggregate.lectures.map((lecture) => {
    const metadata = aggregate.privacyMetadata.lectures[lecture.lectureId];
    if (!metadata) throw new Error("Lecture privacy metadata is unavailable.");
    return {
      lectureId: lecture.lectureId,
      subjectId: lecture.subjectId,
      ...transformScope({
        activeStudyUsers: lecture.samples.activeStudyUsers,
        activityWindowMetrics: lecture.activityWindowMetrics,
        currentStateMetrics: lecture.currentStateMetrics,
      }, metadata, scopePopulation, scopePopulation),
    };
  });

  return {
    analyticsVersion: aggregate.analyticsVersion,
    privacy: {
      policyVersion,
      minimumContributors: MIN_OWNER_ANALYTICS_CONTRIBUTORS,
      minimumRateInteractions: MIN_OWNER_ANALYTICS_INTERACTIONS,
    },
    window: aggregate.window,
    cohort,
    subjects,
    lectures,
  };
}