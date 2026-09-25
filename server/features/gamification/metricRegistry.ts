import { GamificationError } from "./errors.js";
import { GAMIFICATION_METRIC_IDS } from "./constants.js";
import type { GamificationMetricDefinition } from "./types.js";

const definitions: readonly GamificationMetricDefinition[] = [
  {
    id: GAMIFICATION_METRIC_IDS.pointsTotal,
    valueType: "INTEGER",
    aggregation: "Current canonical Study Points read-model total observed at asOf; not a historical reconstruction.",
    sourceAuthority:
      "Study Points compatibility read model; configured read mode and legacy baseline safety gates apply.",
    privacyClass: "PRIVATE_STUDY",
    available: true,
  },
  {
    id: GAMIFICATION_METRIC_IDS.pointsFocus,
    valueType: "INTEGER",
    aggregation: "Lifetime total of canonical FOCUS category points.",
    sourceAuthority: "Study Points canonical category balance.",
    privacyClass: "PRIVATE_STUDY",
    available: true,
  },
  {
    id: GAMIFICATION_METRIC_IDS.pointsMastery,
    valueType: "INTEGER",
    aggregation: "Lifetime total of canonical MASTERY category points.",
    sourceAuthority: "Study Points canonical category balance.",
    privacyClass: "PRIVATE_STUDY",
    available: true,
  },
  {
    id: GAMIFICATION_METRIC_IDS.pointsProgress,
    valueType: "INTEGER",
    aggregation: "Lifetime total of canonical PROGRESS category points.",
    sourceAuthority: "Study Points canonical category balance.",
    privacyClass: "PRIVATE_STUDY",
    available: true,
  },
  {
    id: GAMIFICATION_METRIC_IDS.pointsConsistency,
    valueType: "INTEGER",
    aggregation: "Lifetime total of canonical CONSISTENCY category points.",
    sourceAuthority: "Study Points canonical category balance.",
    privacyClass: "PRIVATE_STUDY",
    available: true,
  },
  {
    id: GAMIFICATION_METRIC_IDS.focusCompletedSessions,
    valueType: "INTEGER",
    aggregation: "Count of completed personal Focus sessions with positive active time ending by asOf.",
    sourceAuthority:
      "FocusSession rows with COMPLETED status and canonical actual end time.",
    privacyClass: "PRIVATE_STUDY",
    available: true,
  },
  {
    id: GAMIFICATION_METRIC_IDS.focusVerifiedSeconds,
    valueType: "INTEGER",
    aggregation: "Sum of active seconds in completed personal Focus sessions ending by asOf.",
    sourceAuthority:
      "FocusSession.activeSeconds for COMPLETED sessions with canonical actual end time.",
    privacyClass: "PRIVATE_STUDY",
    available: true,
  },
  {
    id: GAMIFICATION_METRIC_IDS.groupFocusCompletedRuns,
    valueType: "INTEGER",
    aggregation: "Count of group runs with positive verified participation ending by asOf.",
    sourceAuthority:
      "GroupFocusParticipantSummary joined to its canonically ended GroupFocusRun.",
    privacyClass: "PRIVATE_STUDY",
    available: true,
  },
  {
    id: GAMIFICATION_METRIC_IDS.groupFocusVerifiedSeconds,
    valueType: "INTEGER",
    aggregation: "Sum of verified participant seconds in group runs ending by asOf.",
    sourceAuthority:
      "GroupFocusParticipantSummary.verifiedFocusSeconds joined to GroupFocusRun.",
    privacyClass: "PRIVATE_STUDY",
    available: true,
  },
  {
    id: GAMIFICATION_METRIC_IDS.consistencyQualifyingDays,
    valueType: "INTEGER",
    aggregation: "Lifetime count of qualifying study days.",
    sourceAuthority:
      "Requires an all-time, integrity-verifiable source spanning personal and Group Focus evidence.",
    privacyClass: "PRIVATE_STUDY",
    available: false,
    unavailableReason:
      "No all-time source currently proves every qualifying day across personal and Group Focus history.",
  },
];
for (const definition of definitions) Object.freeze(definition);
Object.freeze(definitions);

const byId = new Map(definitions.map((definition) => [definition.id, definition]));

export function getGamificationMetricDefinitions():
  readonly GamificationMetricDefinition[] {
  return definitions;
}

export function getGamificationMetricDefinition(
  metricId: string,
): GamificationMetricDefinition {
  const definition = byId.get(metricId);
  if (!definition) {
    throw new GamificationError(
      "GAMIFICATION_METRIC_NOT_FOUND",
      `Unknown gamification metric: ${metricId}`,
    );
  }
  return definition;
}

export function isKnownGamificationMetric(metricId: string): boolean {
  return byId.has(metricId);
}