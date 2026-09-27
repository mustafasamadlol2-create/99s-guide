import {
  STUDY_INSIGHT_PROMPT_VERSION,
  type StudyInsightLocale,
} from "../../../shared/studyInsights.js";
import type { StudyInsightGroundingV1 } from "./types.js";

export const GROUNDING_FINGERPRINT_DOMAIN = "99s-guide:study-insight-grounding:v1:";
export const USER_CACHE_HASH_DOMAIN = "99s-guide:study-insight-user:v1:";
export const MODEL_CACHE_HASH_DOMAIN = "99s-guide:study-insight-model:v1:";

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalValue(record[key])]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("Canonical insight JSON cannot include non-finite numbers.");
  }
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError("Canonical insight JSON contains an unsupported value.");
  }
  return value;
}

export function canonicalStudyInsightJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function fingerprintStudyInsightGrounding(
  grounding: StudyInsightGroundingV1,
): Promise<string> {
  return sha256Hex(`${GROUNDING_FINGERPRINT_DOMAIN}${canonicalStudyInsightJson(grounding)}`);
}

export async function buildStudyInsightCacheKey(input: {
  userId: string;
  locale: StudyInsightLocale;
  model: string;
  groundingFingerprint: string;
}): Promise<string> {
  const [userHash, modelHash] = await Promise.all([
    sha256Hex(`${USER_CACHE_HASH_DOMAIN}${input.userId}`),
    sha256Hex(`${MODEL_CACHE_HASH_DOMAIN}${input.model}`),
  ]);
  const key = [
    "study-insight",
    "v1",
    userHash,
    input.locale,
    STUDY_INSIGHT_PROMPT_VERSION,
    modelHash,
    input.groundingFingerprint,
  ].join(":");
  if (key.length > 240) throw new Error("Study insight cache key exceeded its bounded length.");
  return key;
}