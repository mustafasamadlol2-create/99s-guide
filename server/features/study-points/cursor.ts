import { Buffer } from "node:buffer";
import { StudyPointsError } from "./errors.js";

export type StudyPointsHistoryCursor = {
  effectiveAt: Date;
  id: string;
};

export function encodeStudyPointsHistoryCursor(
  cursor: StudyPointsHistoryCursor,
): string {
  return Buffer.from(
    JSON.stringify({
      effectiveAt: cursor.effectiveAt.toISOString(),
      id: cursor.id,
    }),
    "utf8",
  ).toString("base64url");
}

export function decodeStudyPointsHistoryCursor(
  value: string | null | undefined,
): StudyPointsHistoryCursor | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 512
    || !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new StudyPointsError(
      "POINTS_INVALID_CURSOR",
      "Study Points history cursor is invalid.",
    );
  }

  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) throw new Error("noncanonical");
    const payload = JSON.parse(decoded.toString("utf8")) as Record<string, unknown>;
    if (
      !payload
      || typeof payload !== "object"
      || Array.isArray(payload)
      || Object.keys(payload).length !== 2
      || typeof payload.effectiveAt !== "string"
      || typeof payload.id !== "string"
      || payload.id.length < 1
      || payload.id.length > 128
      || payload.id.includes("\0")
    ) {
      throw new Error("shape");
    }
    const timestamp = Date.parse(payload.effectiveAt);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new Error("date");
    }
    const effectiveAt = new Date(timestamp);
    if (effectiveAt.toISOString() !== payload.effectiveAt) {
      throw new Error("noncanonical-date");
    }
    return { effectiveAt, id: payload.id };
  } catch {
    throw new StudyPointsError(
      "POINTS_INVALID_CURSOR",
      "Study Points history cursor is invalid.",
    );
  }
}