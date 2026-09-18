import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PERSONALIZATION_CONFIG,
  PERSONALIZATION_SUBJECT_IDS,
  isPersonalizationConfigV1,
  migratePersonalizationConfig,
  normalizePersonalizationConfig,
  parsePersonalizationConfig,
  validatePersonalizationConfig,
} from "../shared/personalization.js";

test("Classic 99 defaults are complete and immutable by returned copies", () => {
  assert.equal(DEFAULT_PERSONALIZATION_CONFIG.version, 1);
  assert.equal(DEFAULT_PERSONALIZATION_CONFIG.themeId, "classic-99");
  assert.equal(DEFAULT_PERSONALIZATION_CONFIG.heroStyle, "classic");
  assert.equal(DEFAULT_PERSONALIZATION_CONFIG.glassStyle, "balanced");
  assert.equal(DEFAULT_PERSONALIZATION_CONFIG.motionStyle, "full");
  assert.equal(DEFAULT_PERSONALIZATION_CONFIG.readingSize, "default");
  assert.deepEqual(
    DEFAULT_PERSONALIZATION_CONFIG.home.subjectOrder,
    PERSONALIZATION_SUBJECT_IDS,
  );

  const normalized = normalizePersonalizationConfig(DEFAULT_PERSONALIZATION_CONFIG);
  normalized.home.subjectOrder.reverse();
  assert.deepEqual(
    DEFAULT_PERSONALIZATION_CONFIG.home.subjectOrder,
    PERSONALIZATION_SUBJECT_IDS,
  );
});

test("strict validation accepts a complete V1 document", () => {
  const result = validatePersonalizationConfig({
    version: 1,
    themeId: "ocean",
    heroStyle: "ambient",
    glassStyle: "frosted",
    motionStyle: "subtle",
    readingSize: "large",
    home: { subjectOrder: [...PERSONALIZATION_SUBJECT_IDS].reverse() },
  });

  assert.equal(result.success, true);
  assert.equal(isPersonalizationConfigV1(result.success ? result.data : null), true);
  assert.deepEqual(
    parsePersonalizationConfig(result.success ? result.data : null)?.home.subjectOrder,
    [...PERSONALIZATION_SUBJECT_IDS].reverse(),
  );
});

test("strict validation rejects missing, unknown, and invalid fields", () => {
  const result = validatePersonalizationConfig({
    version: 1,
    themeId: "not-a-theme",
    heroStyle: "classic",
    glassStyle: "balanced",
    motionStyle: "full",
    readingSize: "default",
    home: { subjectOrder: ["PHC", "PHC"] },
    unexpected: true,
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.errors.length >= 3, true);
  }
  assert.equal(parsePersonalizationConfig(null), null);
});

test("normalization falls back safely without throwing", () => {
  const normalized = normalizePersonalizationConfig({
    version: 999,
    themeId: "unknown",
    heroStyle: null,
    glassStyle: "clear",
    motionStyle: "reduced",
    readingSize: "large",
    home: null,
  });

  assert.deepEqual(normalized, {
    version: 1,
    themeId: "classic-99",
    heroStyle: "classic",
    glassStyle: "clear",
    motionStyle: "reduced",
    readingSize: "large",
    home: { subjectOrder: PERSONALIZATION_SUBJECT_IDS },
  });
});

test("normalization preserves valid partial subject order and appends omissions", () => {
  const normalized = normalizePersonalizationConfig({
    home: { subjectOrder: ["NT", "PHC", "NT", "invalid", "RM"] },
  });

  assert.deepEqual(normalized.home.subjectOrder, [
    "NT",
    "PHC",
    "RM",
    "CA",
    "SSC",
    "ImD",
    "ID",
  ]);
});

test("normalization ignores unknown fields and invalid nested shapes", () => {
  const normalized = normalizePersonalizationConfig({
    themeId: "midnight",
    home: {
      subjectOrder: "not-an-array",
      unknown: "ignored",
    },
    unknown: { value: true },
  });

  assert.equal(normalized.themeId, "midnight");
  assert.deepEqual(normalized.home.subjectOrder, PERSONALIZATION_SUBJECT_IDS);
  assert.equal("unknown" in normalized, false);
});

test("migration uses V1 normalization and Classic 99 for unsupported versions", () => {
  const migrated = migratePersonalizationConfig({
    version: 1,
    themeId: "emerald",
    home: { subjectOrder: ["SSC"] },
  });
  assert.equal(migrated.themeId, "emerald");
  assert.deepEqual(migrated.home.subjectOrder, [
    "SSC",
    "PHC",
    "RM",
    "CA",
    "ImD",
    "ID",
    "NT",
  ]);

  assert.deepEqual(migratePersonalizationConfig({ version: 0 }), {
    version: 1,
    themeId: "classic-99",
    heroStyle: "classic",
    glassStyle: "balanced",
    motionStyle: "full",
    readingSize: "default",
    home: { subjectOrder: PERSONALIZATION_SUBJECT_IDS },
  });
  assert.deepEqual(migratePersonalizationConfig("invalid"), {
    version: 1,
    themeId: "classic-99",
    heroStyle: "classic",
    glassStyle: "balanced",
    motionStyle: "full",
    readingSize: "default",
    home: { subjectOrder: PERSONALIZATION_SUBJECT_IDS },
  });
});