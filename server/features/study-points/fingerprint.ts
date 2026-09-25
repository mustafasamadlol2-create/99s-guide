import { canonicalJson } from "../study-core/canonicalJson.js";
import {
  STUDY_POINTS_MAX_METADATA_BYTES,
  type StudyPointsCategory,
  type StudyPointsSourceType,
} from "./constants.js";

export type StudyPointsSemanticInput = {
  userId: string;
  amount: number;
  category: StudyPointsCategory | string;
  reasonCode: string;
  sourceType: StudyPointsSourceType | string;
  sourceId?: string | null;
  ruleVersion: string;
  effectiveAt: Date;
  reversalOfEntryId?: string | null;
  metadata?: unknown;
};

/**
 * Canonical serialized meaning for idempotent replay comparison. The key
 * itself is the lookup identity; generated IDs and server-created timestamps
 * are intentionally excluded.
 */
export function studyPointsSemanticPayload(input: StudyPointsSemanticInput): string {
  return canonicalJson(
    {
      userId: input.userId,
      amount: input.amount,
      category: input.category,
      reasonCode: input.reasonCode,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      ruleVersion: input.ruleVersion,
      effectiveAt: input.effectiveAt,
      reversalOfEntryId: input.reversalOfEntryId ?? null,
      metadata: input.metadata ?? null,
    },
    { maxBytes: STUDY_POINTS_MAX_METADATA_BYTES + 4096 },
  );
}