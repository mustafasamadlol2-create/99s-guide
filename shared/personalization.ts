/**
 * Runtime-safe personalization contracts.
 *
 * This module intentionally has no React, browser, storage, or provider
 * dependencies. It is safe to import from the frontend, backend, and tests.
 */

export const PERSONALIZATION_VERSION = 1 as const;

export const PERSONALIZATION_THEME_IDS = [
  "classic-99",
  "midnight",
  "ocean",
  "emerald",
  "rose",
  "amber",
  "violet",
  "monochrome",
] as const;
export type ThemeId = (typeof PERSONALIZATION_THEME_IDS)[number];

export const PERSONALIZATION_HERO_STYLES = [
  "classic",
  "minimal",
  "night",
  "aurora",
] as const;
export type HeroStyle = (typeof PERSONALIZATION_HERO_STYLES)[number];

export const PERSONALIZATION_GLASS_STYLES = [
  "clear",
  "balanced",
  "frosted",
] as const;
export type GlassStyle = (typeof PERSONALIZATION_GLASS_STYLES)[number];

export const PERSONALIZATION_MOTION_STYLES = [
  "full",
  "subtle",
  "reduced",
] as const;
export type MotionStyle = (typeof PERSONALIZATION_MOTION_STYLES)[number];

export const PERSONALIZATION_READING_SIZES = [
  "small",
  "default",
  "large",
] as const;
export type ReadingSize = (typeof PERSONALIZATION_READING_SIZES)[number];

/**
 * These IDs intentionally match the existing SubjectId union. The order is
 * the current production Home seed order and is the only safe default for a
 * future Home subject-order preference.
 */
export const PERSONALIZATION_SUBJECT_IDS = [
  "ID",
  "NT",
  "RM",
  "CA",
  "PHC",
  "ImD",
  "SSC",
] as const;
export type SubjectId = (typeof PERSONALIZATION_SUBJECT_IDS)[number];

export interface PersonalizationConfigV1 {
  version: typeof PERSONALIZATION_VERSION;
  themeId: ThemeId;
  heroStyle: HeroStyle;
  glassStyle: GlassStyle;
  motionStyle: MotionStyle;
  readingSize: ReadingSize;
  home: {
    readonly subjectOrder: readonly SubjectId[];
  };
}

export interface PersonalizationValidationSuccess {
  success: true;
  data: PersonalizationConfigV1;
}

export interface PersonalizationValidationFailure {
  success: false;
  errors: string[];
}

export type PersonalizationValidationResult =
  | PersonalizationValidationSuccess
  | PersonalizationValidationFailure;

/**
 * Accessibility is a higher-priority contract than personalization:
 * prefers-reduced-motion must override motionStyle = "full", and reduced
 * transparency must override any user-selected glassStyle. Runtime handling
 * belongs to a later integration phase.
 */

export const MAX_PERSONALIZATION_PAYLOAD_BYTES = 16 * 1024;
export const MAX_PERSONALIZATION_LOCAL_ENVELOPE_BYTES = 48 * 1024;
export const MAX_PERSONALIZATION_CLOUD_RECORD_BYTES = 32 * 1024;

export const PERSONALIZATION_SYNC_STATES = [
  "never",
  "clean",
  "retryable-failure",
  "disabled",
  "unsupported",
] as const;
export type PersonalizationSyncState = (typeof PERSONALIZATION_SYNC_STATES)[number];

export interface PersonalizationPendingIntent {
  intentId: string;
  config: PersonalizationConfigV1;
  createdAt: string;
}

export interface PersonalizationLocalEnvelopeV2 {
  cacheVersion: 2;
  savedAt: string;
  config: PersonalizationConfigV1;
  sync: {
    knownCloudRevision: string | null;
    pending: PersonalizationPendingIntent | null;
    lastSyncState: PersonalizationSyncState;
    lastSuccessfulGetAt: string | null;
  };
}

export interface PersonalizationCloudRecord {
  recordVersion: 1;
  config: PersonalizationConfigV1;
  revision: string;
  updatedAt: string;
  lastIntentId: string;
}

export type PersonalizationCloudResponse =
  | { status: "ok"; record: PersonalizationCloudRecord }
  | { status: "empty"; record: null }
  | { status: "disabled"; record: null };

const CLASSIC_99_SUBJECT_ORDER: readonly SubjectId[] = PERSONALIZATION_SUBJECT_IDS;

type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export const DEFAULT_PERSONALIZATION_V1: DeepReadonly<PersonalizationConfigV1> =
  Object.freeze({
    version: PERSONALIZATION_VERSION,
    themeId: "classic-99",
    heroStyle: "classic",
    glassStyle: "balanced",
    motionStyle: "full",
    readingSize: "default",
    home: Object.freeze({
      subjectOrder: Object.freeze([...CLASSIC_99_SUBJECT_ORDER]),
    }),
  });

// Compatibility alias for callers using the original Phase 1 name.
export const DEFAULT_PERSONALIZATION_CONFIG = DEFAULT_PERSONALIZATION_V1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).byteLength;
  }

  let byteLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      } else {
        codePoint = 0xfffd;
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }

    if (codePoint <= 0x7f) byteLength += 1;
    else if (codePoint <= 0x7ff) byteLength += 2;
    else if (codePoint <= 0xffff) byteLength += 3;
    else byteLength += 4;
  }
  return byteLength;
}

/**
 * Returns the UTF-8 byte size of a JSON-serializable payload. A null result
 * means the value could not be serialized safely.
 */
export function personalizationPayloadByteLength(value: unknown): number | null {
  try {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    return serialized === undefined ? null : utf8ByteLength(serialized);
  } catch {
    return null;
  }
}

export function isPersonalizationPayloadWithinLimit(value: unknown): boolean {
  const byteLength = personalizationPayloadByteLength(value);
  return byteLength !== null && byteLength <= MAX_PERSONALIZATION_PAYLOAD_BYTES;
}

function isCompleteSubjectOrder(value: unknown): value is SubjectId[] {
  if (!Array.isArray(value) || value.length !== PERSONALIZATION_SUBJECT_IDS.length) {
    return false;
  }

  const seen = new Set<string>();
  return value.every((subjectId) => {
    if (!isOneOf(PERSONALIZATION_SUBJECT_IDS, subjectId) || seen.has(subjectId)) {
      return false;
    }
    seen.add(subjectId);
    return true;
  });
}

function hasValidV1Fields(value: Record<string, unknown>): boolean {
  return (
    value.version === PERSONALIZATION_VERSION &&
    isOneOf(PERSONALIZATION_THEME_IDS, value.themeId) &&
    isOneOf(PERSONALIZATION_HERO_STYLES, value.heroStyle) &&
    isOneOf(PERSONALIZATION_GLASS_STYLES, value.glassStyle) &&
    isOneOf(PERSONALIZATION_MOTION_STYLES, value.motionStyle) &&
    isOneOf(PERSONALIZATION_READING_SIZES, value.readingSize) &&
    isRecord(value.home) &&
    isCompleteSubjectOrder(value.home.subjectOrder)
  );
}

function cloneDefaultPersonalization(): PersonalizationConfigV1 {
  return {
    version: DEFAULT_PERSONALIZATION_V1.version,
    themeId: DEFAULT_PERSONALIZATION_V1.themeId,
    heroStyle: DEFAULT_PERSONALIZATION_V1.heroStyle,
    glassStyle: DEFAULT_PERSONALIZATION_V1.glassStyle,
    motionStyle: DEFAULT_PERSONALIZATION_V1.motionStyle,
    readingSize: DEFAULT_PERSONALIZATION_V1.readingSize,
    home: {
      subjectOrder: [...DEFAULT_PERSONALIZATION_V1.home.subjectOrder],
    },
  };
}

function normalizeSubjectOrder(value: unknown): SubjectId[] {
  return isCompleteSubjectOrder(value)
    ? [...value]
    : [...CLASSIC_99_SUBJECT_ORDER];
}

/**
 * Strictly validates a complete V1 document. Unknown keys, missing fields,
 * invalid enum values, duplicate subjects, and incomplete subject orders fail.
 */
export function validatePersonalizationConfig(
  value: unknown,
): PersonalizationValidationResult {
  if (!isRecord(value)) {
    return { success: false, errors: ["Personalization config must be an object."] };
  }

  const errors: string[] = [];
  const topLevelKeys = [
    "version",
    "themeId",
    "heroStyle",
    "glassStyle",
    "motionStyle",
    "readingSize",
    "home",
  ] as const;

  if (!hasOnlyKeys(value, topLevelKeys)) {
    errors.push("Personalization config contains unknown fields.");
  }
  if (!isPersonalizationPayloadWithinLimit(value)) {
    errors.push(
      `Personalization payload must be at most ${MAX_PERSONALIZATION_PAYLOAD_BYTES} UTF-8 bytes.`,
    );
  }
  if (value.version !== PERSONALIZATION_VERSION) {
    errors.push(`Personalization config version must be ${PERSONALIZATION_VERSION}.`);
  }
  if (!isOneOf(PERSONALIZATION_THEME_IDS, value.themeId)) {
    errors.push("Personalization config has an invalid themeId.");
  }
  if (!isOneOf(PERSONALIZATION_HERO_STYLES, value.heroStyle)) {
    errors.push("Personalization config has an invalid heroStyle.");
  }
  if (!isOneOf(PERSONALIZATION_GLASS_STYLES, value.glassStyle)) {
    errors.push("Personalization config has an invalid glassStyle.");
  }
  if (!isOneOf(PERSONALIZATION_MOTION_STYLES, value.motionStyle)) {
    errors.push("Personalization config has an invalid motionStyle.");
  }
  if (!isOneOf(PERSONALIZATION_READING_SIZES, value.readingSize)) {
    errors.push("Personalization config has an invalid readingSize.");
  }

  if (!isRecord(value.home)) {
    errors.push("Personalization config home must be an object.");
  } else {
    if (!hasOnlyKeys(value.home, ["subjectOrder"])) {
      errors.push("Personalization config home contains unknown fields.");
    }
    if (!isCompleteSubjectOrder(value.home.subjectOrder)) {
      errors.push("Personalization config home.subjectOrder must contain each subject exactly once.");
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      version: PERSONALIZATION_VERSION,
      themeId: value.themeId as ThemeId,
      heroStyle: value.heroStyle as HeroStyle,
      glassStyle: value.glassStyle as GlassStyle,
      motionStyle: value.motionStyle as MotionStyle,
      readingSize: value.readingSize as ReadingSize,
      home: {
        subjectOrder: [...(value.home as { subjectOrder: SubjectId[] }).subjectOrder],
      },
    },
  };
}

export function isPersonalizationConfigV1(
  value: unknown,
): value is PersonalizationConfigV1 {
  return validatePersonalizationConfig(value).success;
}

/**
 * Normalizes untrusted input into a complete safe V1 document.
 *
 * A complete valid V1 document is copied while irrelevant unknown keys are
 * stripped. Any invalid or unsupported V1 input falls back to Classic 99.
 * Subject order is all-or-nothing: only a complete valid permutation is
 * accepted.
 */
export function normalizePersonalizationConfig(
  value: unknown,
): PersonalizationConfigV1 {
  const fallback = cloneDefaultPersonalization();
  if (!isRecord(value) || !hasValidV1Fields(value)) return fallback;

  const home = value.home as { subjectOrder: SubjectId[] };
  return {
    version: PERSONALIZATION_VERSION,
    themeId: value.themeId as ThemeId,
    heroStyle: value.heroStyle as HeroStyle,
    glassStyle: value.glassStyle as GlassStyle,
    motionStyle: value.motionStyle as MotionStyle,
    readingSize: value.readingSize as ReadingSize,
    home: {
      subjectOrder: normalizeSubjectOrder(home.subjectOrder),
    },
  };
}

/**
 * Returns a fresh mutable V1 default. No caller can mutate the shared
 * frozen default or affect a later factory call.
 */
export function createDefaultPersonalization(): PersonalizationConfigV1 {
  return cloneDefaultPersonalization();
}

/**
 * Migration entry point for future preference documents.
 *
 * V1 is currently the first supported shape. Unknown, missing, or unsupported
 * versions deliberately use Classic 99 rather than guessing at old semantics.
 */
export function migratePersonalizationConfig(
  value: unknown,
): PersonalizationConfigV1 {
  if (!isRecord(value) || value.version !== PERSONALIZATION_VERSION) {
    return cloneDefaultPersonalization();
  }
  return normalizePersonalizationConfig(value);
}

/**
 * Parse a stored document without throwing. This is the strict counterpart
 * to normalizePersonalizationConfig and is useful for cache/server boundaries.
 */
export function parsePersonalizationConfig(
  value: unknown,
): PersonalizationConfigV1 | null {
  const result = validatePersonalizationConfig(value);
  return result.success ? result.data : null;
}