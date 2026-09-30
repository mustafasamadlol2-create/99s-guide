import {
  ROLLOUT_STAGES,
  isRuntimeEnforcedStudyFlag,
  type RolloutStage,
} from "./stageDefinitions.js";
import type { StudyFeatureFlag } from "../features/study-core/featureFlags.js";

export type CertificationStatus =
  | "PASS"
  | "FAIL"
  | "NOT_RUN"
  | "BLOCKED"
  | "NOT_APPLICABLE";

export type CertificationResult = {
  platform: string;
  scenario: string;
  status: CertificationStatus;
};

export type Prompt51Manifest = {
  schemaVersion?: number;
  overallStatus?: string;
  manualGate?: string;
  allRequiredDeviceChecksPassed?: boolean;
  productionRolloutAllowed?: boolean;
  environment?: {
    safeDisposableDatabase?: boolean;
  };
  testCaseTotals?: {
    blockedOrSkippedForMissingDisposableDatabase?: number;
  };
  results?: CertificationResult[];
};

export type CertificationSummary = {
  valid: boolean;
  counts: Record<CertificationStatus, number>;
  notRunClassification: Array<{
    platform: string;
    scenario: string;
    classification: "REQUIRED_BEFORE_ROLLOUT" | "OPTIONAL_ENVIRONMENT_LIMITATION";
  }>;
  blockers: string[];
};

export type ReleaseGateStatus =
  | "READY"
  | "READY_WITH_WARNINGS"
  | "FAIL"
  | "NOT_RUN";

const REQUIRED_DEVICE_PLATFORMS = new Set(["iPhone", "iPad", "PWA"]);
const CERTIFICATION_STATUSES = new Set<CertificationStatus>([
  "PASS",
  "FAIL",
  "NOT_RUN",
  "BLOCKED",
  "NOT_APPLICABLE",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function summarizePrompt51Manifest(input: unknown): CertificationSummary {
  const counts: Record<CertificationStatus, number> = {
    PASS: 0,
    FAIL: 0,
    NOT_RUN: 0,
    BLOCKED: 0,
    NOT_APPLICABLE: 0,
  };
  const blockers: string[] = [];

  if (!isRecord(input) || !Array.isArray(input.results) || input.schemaVersion !== 1) {
    return {
      valid: false,
      counts,
      notRunClassification: [],
      blockers: ["PROMPT51_MANIFEST_INVALID_OR_MISSING"],
    };
  }

  const results: CertificationResult[] = [];
  for (const rawResult of input.results) {
    if (
      !isRecord(rawResult)
      || typeof rawResult.platform !== "string"
      || typeof rawResult.scenario !== "string"
      || typeof rawResult.status !== "string"
      || !CERTIFICATION_STATUSES.has(rawResult.status as CertificationStatus)
    ) {
      return {
        valid: false,
        counts,
        notRunClassification: [],
        blockers: ["PROMPT51_MANIFEST_CONTAINS_INVALID_RESULT"],
      };
    }
    const result = rawResult as CertificationResult;
    results.push(result);
    counts[result.status] += 1;
  }

  const notRunClassification = results
    .filter((result) => result.status === "NOT_RUN")
    .map((result) => ({
      platform: result.platform,
      scenario: result.scenario,
      classification:
        REQUIRED_DEVICE_PLATFORMS.has(result.platform)
        || /database|disposable.schema/iu.test(result.scenario)
          ? "REQUIRED_BEFORE_ROLLOUT" as const
          : "OPTIONAL_ENVIRONMENT_LIMITATION" as const,
    }));

  if (input.productionRolloutAllowed !== true) {
    blockers.push("PROMPT51_PRODUCTION_ROLLOUT_NOT_ALLOWED");
  }
  if (input.allRequiredDeviceChecksPassed !== true) {
    blockers.push("REQUIRED_DEVICE_CERTIFICATION_INCOMPLETE");
  }
  if (counts.FAIL > 0) blockers.push("PROMPT51_HAS_FAILED_CHECKS");

  for (const platform of REQUIRED_DEVICE_PLATFORMS) {
    const platformResults = results.filter((result) => result.platform === platform);
    if (
      platformResults.length === 0
      || platformResults.some((result) => result.status !== "PASS" && result.status !== "NOT_APPLICABLE")
    ) {
      blockers.push(`${platform.toUpperCase()}_CERTIFICATION_INCOMPLETE`);
    }
  }

  const environment = isRecord(input.environment) ? input.environment : {};
  const testCaseTotals = isRecord(input.testCaseTotals) ? input.testCaseTotals : {};
  const blockedDatabaseTests = testCaseTotals.blockedOrSkippedForMissingDisposableDatabase;
  if (
    environment.safeDisposableDatabase !== true
    || (typeof blockedDatabaseTests === "number" && blockedDatabaseTests > 0)
  ) {
    blockers.push("DATABASE_GATED_CERTIFICATION_INCOMPLETE");
  }

  return {
    valid: true,
    counts,
    notRunClassification,
    blockers: [...new Set(blockers)],
  };
}

export type StageReview = {
  stageId: string;
  readyForOperatorReview: boolean;
  executed: false;
  writesPerformed: 0;
  blockers: string[];
  flags: Array<{
    name: StudyFeatureFlag;
    runtimeEnforced: boolean;
  }>;
};

export function reviewRolloutStage(input: {
  stageId: string;
  completedStages?: readonly string[];
  prompt51: CertificationSummary;
  releaseGateStatus: ReleaseGateStatus;
  nonCriticalWarningsReviewed?: boolean;
}): StageReview {
  const stage: RolloutStage | undefined = ROLLOUT_STAGES.find(
    (candidate) => candidate.id === input.stageId,
  );
  if (!stage) {
    return {
      stageId: input.stageId,
      readyForOperatorReview: false,
      executed: false,
      writesPerformed: 0,
      blockers: ["UNKNOWN_ROLLOUT_STAGE"],
      flags: [],
    };
  }

  const completed = new Set(input.completedStages ?? []);
  const blockers = [...input.prompt51.blockers];
  if (!input.prompt51.valid) blockers.push("PROMPT51_MANIFEST_INVALID_OR_MISSING");

  if (input.releaseGateStatus === "FAIL") {
    blockers.push("PROMPT50_RELEASE_GATE_FAILED");
  } else if (input.releaseGateStatus === "NOT_RUN") {
    blockers.push("PROMPT50_RELEASE_GATE_NOT_RUN");
  } else if (
    input.releaseGateStatus === "READY_WITH_WARNINGS"
    && input.nonCriticalWarningsReviewed !== true
  ) {
    blockers.push("PROMPT50_WARNINGS_NOT_REVIEWED_AS_NON_CRITICAL");
  }

  for (const dependency of stage.dependsOn) {
    if (!completed.has(dependency)) blockers.push(`STAGE_DEPENDENCY_INCOMPLETE:${dependency}`);
  }

  return {
    stageId: stage.id,
    readyForOperatorReview: blockers.length === 0,
    executed: false,
    writesPerformed: 0,
    blockers: [...new Set(blockers)],
    flags: stage.plannedFlags.map((name) => ({
      name,
      runtimeEnforced: isRuntimeEnforcedStudyFlag(name),
    })),
  };
}

export function buildRolloutStatus(input: {
  prompt51: CertificationSummary;
  releaseGateStatus: ReleaseGateStatus;
}): {
  mode: "PREPARE_ONLY";
  status: "READY_FOR_OPERATOR_REVIEW" | "BLOCKED — REQUIRED DEVICE CERTIFICATION INCOMPLETE" | "BLOCKED — RELEASE GATE NOT READY";
  prompt51: CertificationSummary;
  releaseGateStatus: ReleaseGateStatus;
  productionExecutionSupported: false;
  writesPerformed: 0;
  stages: Array<{
    id: string;
    name: string;
    status: "BLOCKED" | "WAITING_ON_DEPENDENCIES" | "AWAITING_EXPLICIT_OPERATOR_REVIEW";
    dependencies: readonly string[];
    flags: Array<{ name: StudyFeatureFlag; runtimeEnforced: boolean }>;
    checks: readonly string[];
    healthSignals: readonly string[];
    rollback: string;
    frontendAvailability: RolloutStage["frontendAvailability"];
  }>;
  blockers: string[];
} {
  const firstStageId = ROLLOUT_STAGES[0]?.id ?? "";
  const firstStage = reviewRolloutStage({
    stageId: firstStageId,
    prompt51: input.prompt51,
    releaseGateStatus: input.releaseGateStatus,
  });
  const blockers = [...firstStage.blockers];
  const deviceBlocked = blockers.some((blocker) =>
    blocker.includes("DEVICE_CERTIFICATION")
    || blocker.includes("IPHONE")
    || blocker.includes("IPAD")
    || blocker.includes("_PWA_")
    || blocker === "PROMPT51_PRODUCTION_ROLLOUT_NOT_ALLOWED");
  const status = deviceBlocked
    ? "BLOCKED — REQUIRED DEVICE CERTIFICATION INCOMPLETE"
    : blockers.length > 0
      ? "BLOCKED — RELEASE GATE NOT READY"
      : "READY_FOR_OPERATOR_REVIEW";

  return {
    mode: "PREPARE_ONLY",
    status,
    prompt51: input.prompt51,
    releaseGateStatus: input.releaseGateStatus,
    productionExecutionSupported: false,
    writesPerformed: 0,
    stages: ROLLOUT_STAGES.map((stage) => ({
      id: stage.id,
      name: stage.name,
      status: blockers.length > 0
        ? "BLOCKED"
        : stage.dependsOn.length > 0
          ? "WAITING_ON_DEPENDENCIES"
          : "AWAITING_EXPLICIT_OPERATOR_REVIEW",
      dependencies: stage.dependsOn,
      flags: stage.plannedFlags.map((name) => ({
        name,
        runtimeEnforced: isRuntimeEnforcedStudyFlag(name),
      })),
      checks: stage.checks,
      healthSignals: stage.healthSignals,
      rollback: stage.rollback,
      frontendAvailability: stage.frontendAvailability,
    })),
    blockers,
  };
}