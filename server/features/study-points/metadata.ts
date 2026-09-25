import { Prisma } from "@prisma/client";
import { canonicalJson } from "../study-core/canonicalJson.js";
import {
  STUDY_POINTS_MAX_METADATA_BYTES,
} from "./constants.js";
import { StudyPointsError } from "./errors.js";

const SENSITIVE_METADATA_KEY =
  /(?:authorization|password|secret|token|invite|capability|quicknote|notetext|pdf.*(?:content|body|data|bytes|text|document|raw)|(?:mcq|flashcard).*(?:content|body|text|answer|question|option|front|back)|^(?:body|content|text|note|payload|event)$)/u;

function assertSafeKeys(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(assertSafeKeys);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_METADATA_KEY.test(key.toLowerCase().replace(/[^a-z0-9]/gu, ""))) {
      throw new StudyPointsError(
        "POINTS_INVALID_METADATA",
        "Study Points metadata contains a sensitive or content-bearing field.",
      );
    }
    assertSafeKeys(item);
  }
}

export function normalizeStudyPointsMetadata(
  value: Readonly<Record<string, unknown>> | undefined,
): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StudyPointsError(
      "POINTS_INVALID_METADATA",
      "Study Points metadata must be a JSON object.",
    );
  }

  try {
    const serialized = canonicalJson(value, {
      maxBytes: STUDY_POINTS_MAX_METADATA_BYTES,
    });
    const normalized = JSON.parse(serialized) as unknown;
    assertSafeKeys(normalized);
    if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
      throw new StudyPointsError(
        "POINTS_INVALID_METADATA",
        "Study Points metadata must be a JSON object.",
      );
    }
    return normalized as Prisma.InputJsonValue;
  } catch (error) {
    if (error instanceof StudyPointsError) throw error;
    throw new StudyPointsError(
      "POINTS_INVALID_METADATA",
      "Study Points metadata is invalid or exceeds 8 KiB.",
    );
  }
}