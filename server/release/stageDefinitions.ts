import type { StudyFeatureFlag } from "../features/study-core/featureFlags.js";

export type RolloutStage = {
  id: string;
  name: string;
  dependsOn: readonly string[];
  plannedFlags: readonly StudyFeatureFlag[];
  checks: readonly string[];
  healthSignals: readonly string[];
  rollback: string;
  frontendAvailability: "DEV_ONLY" | "NO_FRONTEND";
};

/**
 * This is an operator plan, not an activation mechanism. Each flag is checked
 * against the runtime-enforcement inventory before it can be described as a
 * production kill switch.
 */
export const ROLLOUT_STAGES = [
  {
    id: "dark-deployment",
    name: "Stage 0 — Dark deployment",
    dependsOn: [],
    plannedFlags: [],
    checks: ["Deploy only through the existing approved pipeline with all Study Engine flags OFF."],
    healthSignals: ["Prompt50 health and readiness", "core routes", "old-client contract"],
    rollback: "Stop the existing deployment pipeline; do not mutate canonical data.",
    frontendAvailability: "NO_FRONTEND",
  },
  {
    id: "internal-smoke",
    name: "Stage 1 — Internal smoke",
    dependsOn: ["dark-deployment"],
    plannedFlags: [],
    checks: ["Use existing authorized test accounts only; no arbitrary student-data edits."],
    healthSignals: ["critical errors", "privacy/security alerts", "core app health"],
    rollback: "Keep all new user-facing flags OFF; return to the prior approved release if core behavior regresses.",
    frontendAvailability: "DEV_ONLY",
  },
  {
    id: "solo-focus",
    name: "Stage 2 — Solo Focus",
    dependsOn: ["internal-smoke"],
    plannedFlags: ["STUDY_EVENTS_ENABLED", "FOCUS_HUB_ENABLED"],
    checks: ["Plan/start/pause/resume/complete/history", "resource handoff", "calendar remains uncontaminated"],
    healthSignals: ["transition errors", "duplicate-start protection", "outbox health"],
    rollback: "Disable effective Focus gates where available; preserve Focus history and StudyEvents.",
    frontendAvailability: "DEV_ONLY",
  },
  {
    id: "group-focus",
    name: "Stage 3 — Group Focus",
    dependsOn: ["solo-focus"],
    plannedFlags: ["GROUP_FOCUS_ENABLED"],
    checks: ["Controlled two-account host/join/countdown/reconnect/complete flow"],
    healthSignals: ["Group runtime", "terminal reconciliation", "Solo Focus remains healthy"],
    rollback: "Disable Group Focus; leave Solo Focus and canonical history intact.",
    frontendAvailability: "DEV_ONLY",
  },
  {
    id: "points-gamification",
    name: "Stage 4 — Study Points and Gamification",
    dependsOn: ["solo-focus"],
    plannedFlags: ["STUDY_POINTS_ENABLED", "STUDY_INTEGRITY_ENABLED", "GAMIFICATION_ENABLED"],
    checks: ["Controlled eligible-award audit", "duplicate retry idempotency", "balance/Level/Achievement checks"],
    healthSignals: ["award failures", "duplicate awards", "ledger invariant audit"],
    rollback: "Use a dedicated award kill switch only if one is implemented; do not edit or delete ledger rows.",
    frontendAvailability: "DEV_ONLY",
  },
  {
    id: "leaderboard-projection",
    name: "Stage 5 — Leaderboard projection",
    dependsOn: ["points-gamification"],
    plannedFlags: ["LEADERBOARD_D1_PROJECTION_ENABLED"],
    checks: ["Audit projection drift against PostgreSQL ranking authority"],
    healthSignals: ["outbox backlog", "projection lag", "privacy-safe aggregate errors"],
    rollback: "Disable projection writes through an effective gate; retain PostgreSQL as canonical.",
    frontendAvailability: "NO_FRONTEND",
  },
  {
    id: "leaderboard-d1-read",
    name: "Stage 5a — D1 leaderboard reads",
    dependsOn: ["leaderboard-projection"],
    plannedFlags: ["LEADERBOARD_D1_READ_ENABLED"],
    checks: ["Verify ready snapshots and PostgreSQL fallback before enabling reads."],
    healthSignals: ["D1 read failures", "fallback correctness", "snapshot freshness"],
    rollback: "Turn D1 reads OFF and use PostgreSQL fallback; do not alter canonical rankings.",
    frontendAvailability: "NO_FRONTEND",
  },
  {
    id: "spaced-recall",
    name: "Stage 6 — Spaced Recall",
    dependsOn: ["points-gamification"],
    plannedFlags: ["SPACED_RECALL_ENABLED", "RECALL_POINTS_ENABLED"],
    checks: ["Verify server-authoritative issuance, attempts, cooldowns, and eligible rewards."],
    healthSignals: ["issuance/attempt errors", "duplicate rewards", "privacy signals"],
    rollback: "Disable Recall issuance/frontends and Recall rewards where effective; preserve attempts and evidence.",
    frontendAvailability: "DEV_ONLY",
  },
  {
    id: "mastery-retention",
    name: "Stage 7 — Mastery and Retention",
    dependsOn: ["spaced-recall"],
    plannedFlags: ["MASTERY_ENABLED"],
    checks: ["Verify deterministic canonical evidence and read-only retention evaluation."],
    healthSignals: ["reconciliation errors", "rule-version drift", "canonical evidence integrity"],
    rollback: "Disable the UI/read path through an effective gate; preserve canonical evidence.",
    frontendAvailability: "DEV_ONLY",
  },
  {
    id: "study-analyzer",
    name: "Stage 8 — Study Analyzer",
    dependsOn: ["mastery-retention"],
    plannedFlags: ["STUDY_ANALYZER_ENABLED"],
    checks: ["Verify deterministic/private Analyzer output and calendar isolation."],
    healthSignals: ["Analyzer errors", "privacy regressions", "calendar contamination"],
    rollback: "Disable the Analyzer surface through an effective gate; preserve source records.",
    frontendAvailability: "DEV_ONLY",
  },
  {
    id: "ai-insights-ask-data",
    name: "Stage 9 — AI Study Insights and Ask My Study Data",
    dependsOn: ["study-analyzer"],
    plannedFlags: [
      "AI_STUDY_INSIGHTS_ENABLED",
      "AI_STUDY_INSIGHTS_CACHE_ENABLED",
      "ASK_MY_STUDY_DATA_ENABLED",
      "ASK_MY_STUDY_DATA_AI_ENABLED",
    ],
    checks: ["Verify grounded inputs, privacy boundaries, and Cloudflare Workers AI-only provider behavior."],
    healthSignals: ["provider degradation", "AI errors", "deterministic Analyzer remains available"],
    rollback: "Disable AI paths; keep deterministic Analyzer and canonical study data available.",
    frontendAvailability: "DEV_ONLY",
  },
  {
    id: "owner-analytics",
    name: "Stage 10 — Owner Analytics",
    dependsOn: ["study-analyzer"],
    plannedFlags: ["OWNER_STUDY_ANALYTICS_ENABLED"],
    checks: ["Verify aggregate-only output, minimum population rules, and owner authorization."],
    healthSignals: ["privacy/security signals", "authorization errors", "aggregate query health"],
    rollback: "Disable the Owner Analytics surface through an effective gate; retain canonical data.",
    frontendAvailability: "DEV_ONLY",
  },
  {
    id: "general-availability",
    name: "Stage 11 — General availability",
    dependsOn: ["ai-insights-ask-data", "owner-analytics", "leaderboard-d1-read"],
    plannedFlags: [],
    checks: ["Require separate human approval after all relevant stage observations and certification pass."],
    healthSignals: ["critical errors = 0", "privacy regressions = 0", "canonical invariant failures = 0"],
    rollback: "Disable the affected feature first; do not delete canonical history or reverse ledgers en masse.",
    frontendAvailability: "DEV_ONLY",
  },
] as const satisfies readonly RolloutStage[];

/**
 * These flags are read by feature services/routes as runtime controls today.
 * The rest of the declared STUDY_FEATURE_FLAGS are not treated as effective
 * kill switches in release planning.
 */
export const RUNTIME_ENFORCED_STUDY_FLAGS: readonly StudyFeatureFlag[] = [
  "STUDY_EVENTS_ENABLED",
  "FOCUS_HUB_ENABLED",
  "GROUP_FOCUS_ENABLED",
  "STUDY_ANALYZER_ENABLED",
  "SPACED_RECALL_ENABLED",
  "RECALL_POINTS_ENABLED",
  "LEADERBOARD_D1_PROJECTION_ENABLED",
  "LEADERBOARD_D1_READ_ENABLED",
  "AI_STUDY_INSIGHTS_ENABLED",
  "AI_STUDY_INSIGHTS_CACHE_ENABLED",
  "ASK_MY_STUDY_DATA_ENABLED",
  "ASK_MY_STUDY_DATA_AI_ENABLED",
];

const runtimeFlagSet = new Set<string>(RUNTIME_ENFORCED_STUDY_FLAGS);

export function isRuntimeEnforcedStudyFlag(flag: StudyFeatureFlag): boolean {
  return runtimeFlagSet.has(flag);
}