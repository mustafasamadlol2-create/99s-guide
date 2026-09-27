export type OwnerAnalyticsSnapshot = {
  generatedAt: string;
  cohortScope?: string;
};

export {
  createOwnerAcademicAnalyticsService,
  getOwnerAcademicAggregates,
} from "./aggregateService.js";
export { OWNER_METRIC_SOURCES } from "./metricSources.js";
export { rateBps, rateMetric } from "./rate.js";
export { OWNER_ACADEMIC_ANALYTICS_VERSION } from "./version.js";
export type {
  OwnerAcademicAggregateInput,
  OwnerAcademicAggregates,
  OwnerAcademicWindow,
  OwnerActivityWindowMetrics,
  OwnerAnalyticsFreshness,
  OwnerAnalyticsRate,
  OwnerCurrentStateMetrics,
  OwnerLectureAggregate,
  OwnerParticipationRates,
  OwnerSubjectAggregate,
} from "./types.js";