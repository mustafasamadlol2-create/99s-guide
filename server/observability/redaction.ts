const SENSITIVE_KEY =
  /(?:^|[_-])(authorization|cookie|token|jwt|secret|password|credential|api.?key|capability|resume|interaction|invite|signed.?url|email|phone|ip|ip.?address|forwarded.?for|user.?id|student.?id|session.?id|room.?id|lecture.?id|material.?id|question.?id|question|answer|response|correct.?answer|quick.?note|ai.?prompt|prompt|grounding|response.?text|answer.?text|payload|raw.?body)(?:$|[_-])/iu;

const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/giu;
const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;
const SECRET_ASSIGNMENT =
  /\b(authorization|token|secret|password|apiKey|capability|resumeToken|interactionToken|inviteCode|email|phone(?:Number)?|userId|studentId|sessionId|roomId|lectureId|materialId|questionId|ipAddress|clientIp)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/giu;
const PRIVATE_QUERY_PARAMETER =
  /([?&](?:token|secret|password|api_?key|authorization|code|state|invite|capability|signature|email|phone(?:_?number)?|user_?id|student_?id|session_?id|room_?id|lecture_?id)=)[^&#\s]+/giu;

export function redactText(input: string): string {
  return input
    .slice(0, 2_000)
    .replace(BEARER, "Bearer [REDACTED]")
    .replace(JWT, "[REDACTED_JWT]")
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .replace(IPV4, "[REDACTED_IP]")
    .replace(IPV6, "[REDACTED_IP]")
    .replace(UUID, "[REDACTED_ID]")
    .replace(SECRET_ASSIGNMENT, "$1=[REDACTED]")
    .replace(PRIVATE_QUERY_PARAMETER, "$1[REDACTED]");
}

function normalizeKey(key: string): string {
  return key.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`).toLowerCase();
}

export function redactLogValue(
  value: unknown,
  key = "",
  depth = 0,
): unknown {
  if (key && SENSITIVE_KEY.test(normalizeKey(key))) return "[REDACTED]";
  if (depth > 5) return "[TRUNCATED]";
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactLogValue(item, "", depth + 1));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 40);
    return Object.fromEntries(entries.map(([childKey, childValue]) => [
      redactText(childKey),
      redactLogValue(childValue, childKey, depth + 1),
    ]));
  }
  return "[UNSERIALIZABLE]";
}