import type { StudyEventType } from "../study-core/events.js";
import { getMetricDelta } from "./eventPolicy.js";
import type { MetricDelta } from "./types.js";

export function reduceStudyDailyMetric(
  eventType: StudyEventType,
  payload: unknown,
): MetricDelta | null {
  return getMetricDelta(eventType, payload);
}