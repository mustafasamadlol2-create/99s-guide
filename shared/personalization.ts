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
    subjectOrder: SubjectId[];
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

const CLASSIC_99_SUBJECT_ORDER: SubjectId[] = [...PERSONALIZATION_SUBJECT_IDS];

type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export const DEFAULT_PERSONALIZATION_CONFIG: DeepReadonly<PersonalizationConfigV1> =
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

function cloneDefaultPersonalization(): PersonalizationConfigV1 {
  return {
    version: DEFAULT_PERSONALIZATION_CONFIG.version,
    themeId: DEFAULT_PERSONALIZATION_CONFIG.themeId,
    heroStyle: DEFAULT_PERSONALIZATION_CONFIG.heroStyle,
    glassStyle: DEFAULT_PERSONALIZATION_CONFIG.glassStyle,
    motionStyle: DEFAULT_PERSONALIZATION_CONFIG.motionStyle,
    readingSize: DEFAULT_PERSONALIZATION_CONFIG.readingSize,
    home: {
      subjectOrder: [...DEFAULT_PERSONALIZATION_CONFIG.home.subjectOrder],
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
 * Invalid fields fall back independently. Subject order is all-or-nothing:
 * only a complete valid permutation is accepted.
 */
export function normalizePersonalizationConfig(
  value: unknown,
): PersonalizationConfigV1 {
  const fallback = cloneDefaultPersonalization();
  if (!isRecord(value)) return fallback;

  const home = isRecord(value.home) ? value.home : {};
  return {
    version: PERSONALIZATION_VERSION,
    themeId: isOneOf(PERSONALIZATION_THEME_IDS, value.themeId)
      ? value.themeId
      : fallback.themeId,
    heroStyle: isOneOf(PERSONALIZATION_HERO_STYLES, value.heroStyle)
      ? value.heroStyle
      : fallback.heroStyle,
    glassStyle: isOneOf(PERSONALIZATION_GLASS_STYLES, value.glassStyle)
      ? value.glassStyle
      : fallback.glassStyle,
    motionStyle: isOneOf(PERSONALIZATION_MOTION_STYLES, value.motionStyle)
      ? value.motionStyle
      : fallback.motionStyle,
    readingSize: isOneOf(PERSONALIZATION_READING_SIZES, value.readingSize)
      ? value.readingSize
      : fallback.readingSize,
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