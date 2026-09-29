import type { PrismaClient } from "@prisma/client";
import {
  auditAchievementProgressForMaintenance,
  rebuildAchievementProgressForMaintenance,
  type AchievementProgressMaintenanceResult,
} from "../../features/gamification/achievementMaintenance.js";
import type { InspectionResult, MaintenanceAdapter } from "../core/index.js";
import { userDiscoverer, type UserMaintenanceItem } from "./types.js";

type RunAchievementMaintenance = typeof auditAchievementProgressForMaintenance;

export type AchievementMaintenanceDependencies = {
  database: PrismaClient;
  inspect?: RunAchievementMaintenance;
  rebuild?: typeof rebuildAchievementProgressForMaintenance;
};

function classify(result: AchievementProgressMaintenanceResult): {
  progressDrift: boolean;
  unlockReview: boolean;
} {
  return {
    progressDrift: result.snapshot.entries.some(
      ({ progressStatus }) => progressStatus !== "IN_SYNC",
    ),
    unlockReview: result.snapshot.entries.some(
      ({ unlockReviewRequired }) => unlockReviewRequired,
    ),
  };
}

function status(progressDrift: boolean, unlockReview: boolean): string {
  if (progressDrift && unlockReview) return "PROGRESS_DRIFT_UNLOCK_REVIEW";
  if (progressDrift) return "PROGRESS_DRIFT";
  if (unlockReview) return "UNLOCK_REVIEW_REQUIRED";
  return "IN_SYNC";
}

export function createAchievementAdapter({
  database,
  inspect = auditAchievementProgressForMaintenance,
  rebuild = rebuildAchievementProgressForMaintenance,
}: AchievementMaintenanceDependencies): MaintenanceAdapter<UserMaintenanceItem> {
  return {
    discoverBatch: userDiscoverer(database),
    async inspect(item, { asOf }): Promise<InspectionResult> {
      const result = await inspect({
        userId: item.id,
        asOf: new Date(asOf),
        database,
      });
      const state = classify(result);
      return {
        status: status(state.progressDrift, state.unlockReview),
        wouldChange: state.progressDrift,
        skipped: !state.progressDrift && state.unlockReview,
        ...(state.unlockReview ? { code: "HISTORICAL_UNLOCK_REVIEW_REQUIRED" } : {}),
      };
    },
    async apply(item, { asOf }): Promise<InspectionResult> {
      const result = await rebuild({
        userId: item.id,
        asOf: new Date(asOf),
        database,
      });
      const state = classify(result);
      const changed = result.created + result.updated > 0;
      return {
        status: changed
          ? state.unlockReview
            ? "PROGRESS_REBUILT_UNLOCK_REVIEW"
            : "PROGRESS_REBUILT"
          : status(false, state.unlockReview),
        changed,
        skipped: !changed && state.unlockReview,
        ...(state.unlockReview ? { code: "HISTORICAL_UNLOCK_REVIEW_REQUIRED" } : {}),
      };
    },
  };
}