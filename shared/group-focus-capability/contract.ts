export const GROUP_FOCUS_CAPABILITY_VERSION = 1 as const;
export const GROUP_FOCUS_CAPABILITY_ISSUER = "99s-guide-api";
export const GROUP_FOCUS_CAPABILITY_AUDIENCE = "99s-guide-group-focus-worker";
export const GROUP_FOCUS_CAPABILITY_PURPOSE = "group_focus_room_access";
export const GROUP_FOCUS_CAPABILITY_ALGORITHM = "HS256";
export const GROUP_FOCUS_CAPABILITY_TYP = "GF-CAP";
export const GROUP_FOCUS_CAPABILITY_DEFAULT_TTL_SECONDS = 90;
export const GROUP_FOCUS_CAPABILITY_MAX_TTL_SECONDS = 120;
export const GROUP_FOCUS_CAPABILITY_CLOCK_SKEW_SECONDS = 10;
export const GROUP_FOCUS_CAPABILITY_MAX_TOKEN_BYTES = 8 * 1024;
export const GROUP_FOCUS_CAPABILITY_MAX_KEYS = 4;
export const GROUP_FOCUS_CAPABILITY_MIN_KEY_BYTES = 32;
export const GROUP_FOCUS_CAPABILITY_MAX_KEY_BYTES = 128;

export const GROUP_FOCUS_CAPABILITY_ROLES = ["HOST", "MEMBER"] as const;
export const GROUP_FOCUS_CAPABILITY_MODES = ["SHARED_LECTURE", "STUDY_TOGETHER"] as const;
export const GROUP_FOCUS_CAPABILITY_VISIBILITIES = ["PUBLIC", "PRIVATE"] as const;

export type GroupFocusCapabilityRole = (typeof GROUP_FOCUS_CAPABILITY_ROLES)[number];
export type GroupFocusCapabilityMode = (typeof GROUP_FOCUS_CAPABILITY_MODES)[number];
export type GroupFocusCapabilityVisibility =
  (typeof GROUP_FOCUS_CAPABILITY_VISIBILITIES)[number];

export const GROUP_FOCUS_CAPABILITY_NUMERIC_BOUNDS = {
  focusDurationSeconds: { min: 60, max: 6 * 60 * 60 },
  breakDurationSeconds: { min: 0, max: 3 * 60 * 60 },
  roundCount: { min: 1, max: 20 },
  maxParticipants: { min: 2, max: 25 },
} as const;

export const GROUP_FOCUS_CAPABILITY_CLAIM_KEYS = [
  "version",
  "iss",
  "aud",
  "purpose",
  "sub",
  "roomId",
  "membershipId",
  "role",
  "mode",
  "visibility",
  "effectiveLectureId",
  "focusDurationSeconds",
  "breakDurationSeconds",
  "roundCount",
  "maxParticipants",
  "roomUpdatedAt",
  "membershipUpdatedAt",
  "iat",
  "nbf",
  "exp",
  "jti",
] as const;

export type GroupFocusCapabilityClaims = {
  version: typeof GROUP_FOCUS_CAPABILITY_VERSION;
  iss: typeof GROUP_FOCUS_CAPABILITY_ISSUER;
  aud: typeof GROUP_FOCUS_CAPABILITY_AUDIENCE;
  purpose: typeof GROUP_FOCUS_CAPABILITY_PURPOSE;
  sub: string;
  roomId: string;
  membershipId: string;
  role: GroupFocusCapabilityRole;
  mode: GroupFocusCapabilityMode;
  visibility: GroupFocusCapabilityVisibility;
  effectiveLectureId: string;
  focusDurationSeconds: number;
  breakDurationSeconds: number;
  roundCount: number;
  maxParticipants: number;
  roomUpdatedAt: string;
  membershipUpdatedAt: string;
  iat: number;
  nbf: number;
  exp: number;
  jti: string;
};

export type VerifiedGroupFocusCapability = {
  version: typeof GROUP_FOCUS_CAPABILITY_VERSION;
  userId: string;
  roomId: string;
  membershipId: string;
  role: GroupFocusCapabilityRole;
  mode: GroupFocusCapabilityMode;
  visibility: GroupFocusCapabilityVisibility;
  effectiveLectureId: string;
  focusDurationSeconds: number;
  breakDurationSeconds: number;
  roundCount: number;
  maxParticipants: number;
  roomUpdatedAt: string;
  membershipUpdatedAt: string;
  issuedAt: string;
  expiresAt: string;
  jti: string;
};

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 24) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= min
    && value <= max;
}

export function parseGroupFocusCapabilityClaims(
  value: unknown,
  now: Date = new Date(),
): GroupFocusCapabilityClaims | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, GROUP_FOCUS_CAPABILITY_CLAIM_KEYS)) {
    return null;
  }

  if (
    value.version !== GROUP_FOCUS_CAPABILITY_VERSION
    || value.iss !== GROUP_FOCUS_CAPABILITY_ISSUER
    || value.aud !== GROUP_FOCUS_CAPABILITY_AUDIENCE
    || value.purpose !== GROUP_FOCUS_CAPABILITY_PURPOSE
    || !isUuid(value.sub)
    || !isUuid(value.roomId)
    || !isUuid(value.membershipId)
    || !isUuid(value.effectiveLectureId)
    || !GROUP_FOCUS_CAPABILITY_ROLES.includes(value.role as GroupFocusCapabilityRole)
    || !GROUP_FOCUS_CAPABILITY_MODES.includes(value.mode as GroupFocusCapabilityMode)
    || !GROUP_FOCUS_CAPABILITY_VISIBILITIES.includes(
      value.visibility as GroupFocusCapabilityVisibility,
    )
    || !isIntegerInRange(
      value.focusDurationSeconds,
      GROUP_FOCUS_CAPABILITY_NUMERIC_BOUNDS.focusDurationSeconds.min,
      GROUP_FOCUS_CAPABILITY_NUMERIC_BOUNDS.focusDurationSeconds.max,
    )
    || !isIntegerInRange(
      value.breakDurationSeconds,
      GROUP_FOCUS_CAPABILITY_NUMERIC_BOUNDS.breakDurationSeconds.min,
      GROUP_FOCUS_CAPABILITY_NUMERIC_BOUNDS.breakDurationSeconds.max,
    )
    || !isIntegerInRange(
      value.roundCount,
      GROUP_FOCUS_CAPABILITY_NUMERIC_BOUNDS.roundCount.min,
      GROUP_FOCUS_CAPABILITY_NUMERIC_BOUNDS.roundCount.max,
    )
    || !isIntegerInRange(
      value.maxParticipants,
      GROUP_FOCUS_CAPABILITY_NUMERIC_BOUNDS.maxParticipants.min,
      GROUP_FOCUS_CAPABILITY_NUMERIC_BOUNDS.maxParticipants.max,
    )
    || !isCanonicalIsoTimestamp(value.roomUpdatedAt)
    || !isCanonicalIsoTimestamp(value.membershipUpdatedAt)
    || typeof value.jti !== "string"
    || !/^[A-Za-z0-9_-]{22}$/u.test(value.jti)
    || !Number.isSafeInteger(value.iat)
    || !Number.isSafeInteger(value.nbf)
    || !Number.isSafeInteger(value.exp)
  ) {
    return null;
  }

  const nowMilliseconds = now.getTime();
  if (!Number.isFinite(nowMilliseconds)) return null;
  const nowSeconds = Math.floor(nowMilliseconds / 1000);
  const iat = value.iat as number;
  const nbf = value.nbf as number;
  const exp = value.exp as number;
  const skew = GROUP_FOCUS_CAPABILITY_CLOCK_SKEW_SECONDS;

  if (
    iat < 0
    || nbf < iat
    || exp <= nbf
    || exp - iat > GROUP_FOCUS_CAPABILITY_MAX_TTL_SECONDS
    || iat > nowSeconds + skew
    || nbf > nowSeconds + skew
    || exp <= nowSeconds - skew
  ) {
    return null;
  }

  return value as unknown as GroupFocusCapabilityClaims;
}