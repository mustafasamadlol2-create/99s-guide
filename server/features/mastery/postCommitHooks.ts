import { Prisma } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { logger } from "../../services/logger.js";
import { isStudyFeatureEnabled } from "../study-core/featureFlags.js";
import { ingestStudyEvent } from "../study-events/service.js";
import type {
  IngestStudyEventInput,
  StudyEventTransaction,
} from "../study-events/types.js";
import {
  refreshLectureMastery,
  refreshUserLectureMastery,
} from "./refresh.js";
import {
  refreshLectureRetention,
  refreshUserLectureRetention,
} from "./retentionRefresh.js";

const EVENT_WRITE_BATCH_SIZE = 100;
const LECTURE_REFRESH_BATCH_SIZE = 100;

export type FlashcardStudyQuality = "AGAIN" | "HARD" | "GOOD" | "EASY";

export function flashcardStudyQualityFromStatus(
  status: string,
): FlashcardStudyQuality | null {
  switch (status.trim().toUpperCase()) {
    case "AGAIN":
    case "NOT_REMEMBERED":
      return "AGAIN";
    case "HARD":
    case "MEDIUM":
      return "HARD";
    case "GOOD":
      return "GOOD";
    case "EASY":
      return "EASY";
    default:
      return null;
  }
}

export async function recordMasteryStudyEventsAndRefreshBestEffort(input: {
  userId: string;
  events: readonly IngestStudyEventInput[];
}): Promise<void> {
  if (input.events.length === 0) return;
  if (!isStudyFeatureEnabled("STUDY_EVENTS_ENABLED")) return;

  const committedLectureIds = new Set<string>();
  const database = getPrisma();
  for (let start = 0; start < input.events.length; start += EVENT_WRITE_BATCH_SIZE) {
    const batch = input.events.slice(start, start + EVENT_WRITE_BATCH_SIZE);
    try {
      await database.$transaction(async (tx) => {
        for (const event of batch) {
          const result = await ingestStudyEvent(event, {
            transaction: tx as unknown as StudyEventTransaction,
          });
          if (result.status === "FEATURE_DISABLED") {
            throw new Error("Study Events became unavailable during ingestion.");
          }
        }
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000,
        timeout: 15_000,
      });
      for (const event of batch) {
        if (event.lectureId) committedLectureIds.add(event.lectureId);
      }
    } catch {
      logger.error("[Mastery]", "Canonical Study Event batch could not be recorded.", {
        errorCode: "STUDY_EVENT_WRITE_FAILED",
      });
    }
  }

  if (committedLectureIds.size === 0) return;
  const lectureIds = [...committedLectureIds];
  for (
    let start = 0;
    start < lectureIds.length;
    start += LECTURE_REFRESH_BATCH_SIZE
  ) {
    const batch = lectureIds.slice(start, start + LECTURE_REFRESH_BATCH_SIZE);
    try {
      try {
        await refreshUserLectureRetention({
          userId: input.userId,
          lectureIds: batch,
        });
      } catch {
        logger.error("[Retention]", "Post-commit projection refresh failed.", {
          errorCode: "RETENTION_REFRESH_FAILED",
        });
        await refreshUserLectureMastery({
          userId: input.userId,
          lectureIds: batch,
        });
      }
    } catch {
      logger.error("[Mastery]", "Post-commit projection refresh failed.", {
        errorCode: "PROJECTION_REFRESH_FAILED",
      });
    }
  }
}

export async function refreshLectureMasteryBestEffort(input: {
  userId: string;
  lectureId: string;
}): Promise<void> {
  try {
    try {
      await refreshLectureRetention(input);
    } catch {
      logger.error("[Retention]", "Post-commit projection refresh failed.", {
        errorCode: "RETENTION_REFRESH_FAILED",
      });
      await refreshLectureMastery(input);
    }
  } catch {
    logger.error("[Mastery]", "Post-commit projection refresh failed.", {
      errorCode: "PROJECTION_REFRESH_FAILED",
    });
  }
}