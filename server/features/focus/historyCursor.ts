import { FocusError } from "./errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface FocusHistoryCursor {
  startedAt: Date;
  sessionId: string;
}

export function encodeFocusHistoryCursor(cursor: FocusHistoryCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.startedAt.toISOString(), cursor.sessionId]),
    "utf8",
  ).toString("base64url");
}

export function decodeFocusHistoryCursor(value: string): FocusHistoryCursor {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[0] !== "string" ||
      typeof decoded[1] !== "string" ||
      !UUID.test(decoded[1])
    ) {
      throw new Error("Invalid cursor payload.");
    }
    const startedAt = new Date(decoded[0]);
    if (!Number.isFinite(startedAt.getTime()) || startedAt.toISOString() !== decoded[0]) {
      throw new Error("Invalid cursor timestamp.");
    }
    return { startedAt, sessionId: decoded[1] };
  } catch {
    throw new FocusError("INVALID_REQUEST", "Focus history cursor is invalid.");
  }
}