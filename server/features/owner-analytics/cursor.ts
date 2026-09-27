const MAX_OWNER_ANALYTICS_CURSOR_LENGTH = 1024;
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

export type OwnerAnalyticsLectureCursor = {
  subjectId: string;
  lectureId: string;
};

export class OwnerAnalyticsCursorError extends Error {
  constructor() {
    super("Lecture cursor is invalid.");
    this.name = "OwnerAnalyticsCursorError";
  }
}

function validSubjectOrderKey(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 255
    && value.trim() === value
    && !hasControlCharacters(value);
}

export function isCanonicalLectureId(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_UUID.test(value);
}

export function encodeOwnerAnalyticsLectureCursor(
  cursor: OwnerAnalyticsLectureCursor,
): string {
  if (!validSubjectOrderKey(cursor.subjectId) || !isCanonicalLectureId(cursor.lectureId)) {
    throw new OwnerAnalyticsCursorError();
  }
  return Buffer.from(JSON.stringify({
    version: 1,
    subjectId: cursor.subjectId,
    lectureId: cursor.lectureId,
  }), "utf8").toString("base64url");
}

export function decodeOwnerAnalyticsLectureCursor(value: unknown): OwnerAnalyticsLectureCursor {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_OWNER_ANALYTICS_CURSOR_LENGTH
    || !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new OwnerAnalyticsCursorError();
  }
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) throw new OwnerAnalyticsCursorError();
    const parsed: unknown = JSON.parse(decoded.toString("utf8"));
    if (
      !parsed
      || typeof parsed !== "object"
      || Array.isArray(parsed)
      || Object.keys(parsed).length !== 3
      || !("version" in parsed)
      || !("subjectId" in parsed)
      || !("lectureId" in parsed)
      || parsed.version !== 1
      || !validSubjectOrderKey(parsed.subjectId)
      || !isCanonicalLectureId(parsed.lectureId)
    ) {
      throw new OwnerAnalyticsCursorError();
    }
    return { subjectId: parsed.subjectId, lectureId: parsed.lectureId };
  } catch (error) {
    if (error instanceof OwnerAnalyticsCursorError) throw error;
    throw new OwnerAnalyticsCursorError();
  }
}