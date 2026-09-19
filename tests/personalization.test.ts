import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PERSONALIZATION_CONFIG,
  DEFAULT_PERSONALIZATION_V1,
  DEFAULT_PERSONALIZATION_V2,
  MAX_PERSONALIZATION_PAYLOAD_BYTES,
  PERSONALIZATION_GLASS_STYLES,
  PERSONALIZATION_HERO_STYLES,
  PERSONALIZATION_MOTION_STYLES,
  PERSONALIZATION_READING_SIZES,
  PERSONALIZATION_SUBJECT_IDS,
  PERSONALIZATION_THEME_IDS,
  createDefaultPersonalization,
  isPersonalizationPayloadWithinLimit,
  isPersonalizationConfigV1,
  isPersonalizationConfigV2,
  migratePersonalizationConfig,
  normalizePersonalizationConfig,
  personalizationPayloadByteLength,
  parsePersonalizationConfig,
  validatePersonalizationConfig,
} from "../shared/personalization.js";

function validConfig() {
  return {
    version: 2 as const,
    themeId: "classic-99" as const,
    heroStyle: "classic" as const,
    glassStyle: "balanced" as const,
    motionStyle: "full" as const,
    readingSize: "default" as const,
    home: {
      subjectOrder: [...PERSONALIZATION_SUBJECT_IDS],
      hiddenSubjectIds: [],
      semesterVisibility: { semester1: true, semester2: true },
    },
  };
}

test("Classic 99 defaults are complete and factory results are independent", () => {
  assert.equal(DEFAULT_PERSONALIZATION_CONFIG.version, 2);
  assert.deepEqual(DEFAULT_PERSONALIZATION_CONFIG, DEFAULT_PERSONALIZATION_V2);
  assert.equal(DEFAULT_PERSONALIZATION_CONFIG.themeId, "classic-99");
  assert.equal(DEFAULT_PERSONALIZATION_CONFIG.heroStyle, "classic");
  assert.equal(DEFAULT_PERSONALIZATION_CONFIG.glassStyle, "balanced");
  assert.equal(DEFAULT_PERSONALIZATION_CONFIG.motionStyle, "full");
  assert.equal(DEFAULT_PERSONALIZATION_CONFIG.readingSize, "default");
  assert.deepEqual(
    DEFAULT_PERSONALIZATION_CONFIG.home.subjectOrder,
    PERSONALIZATION_SUBJECT_IDS,
  );

  const a = createDefaultPersonalization();
  const b = createDefaultPersonalization();
  (a.home.subjectOrder as string[]).reverse();
  a.themeId = "ocean";
  assert.notDeepEqual(a, b);
  assert.deepEqual(
    b.home.subjectOrder,
    PERSONALIZATION_SUBJECT_IDS,
  );
  assert.equal(b.themeId, "classic-99");
  assert.deepEqual(
    DEFAULT_PERSONALIZATION_CONFIG.home.subjectOrder,
    PERSONALIZATION_SUBJECT_IDS,
  );
});

test("strict validation accepts a complete V2 document", () => {
  const result = validatePersonalizationConfig({
    version: 2,
    themeId: "ocean",
    heroStyle: "aurora",
    glassStyle: "frosted",
    motionStyle: "subtle",
    readingSize: "large",
    home: {
      subjectOrder: [...PERSONALIZATION_SUBJECT_IDS].reverse(),
      hiddenSubjectIds: ["SSC", "NT"],
      semesterVisibility: { semester1: false, semester2: true },
    },
  });

  assert.equal(result.success, true);
  assert.equal(isPersonalizationConfigV2(result.success ? result.data : null), true);
  assert.deepEqual(
    parsePersonalizationConfig(result.success ? result.data : null)?.home.subjectOrder,
    [...PERSONALIZATION_SUBJECT_IDS].reverse(),
  );
});

test("strict validation rejects missing, unknown, and invalid fields", () => {
  const result = validatePersonalizationConfig({
    version: 2,
    themeId: "not-a-theme",
    heroStyle: "classic",
    glassStyle: "balanced",
    motionStyle: "full",
    readingSize: "default",
    home: {
      subjectOrder: ["PHC", "PHC"],
      hiddenSubjectIds: [],
      semesterVisibility: { semester1: true, semester2: true },
    },
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
    version: 2,
    themeId: "classic-99",
    heroStyle: "classic",
    glassStyle: "balanced",
    motionStyle: "full",
    readingSize: "default",
    home: {
      subjectOrder: PERSONALIZATION_SUBJECT_IDS,
      hiddenSubjectIds: [],
      semesterVisibility: { semester1: true, semester2: true },
    },
  });
});

test("normalization rejects partial, duplicate, and unknown subject orders wholesale", () => {
  const normalized = normalizePersonalizationConfig({
    home: { subjectOrder: ["NT", "PHC", "NT", "invalid", "RM"] },
  });

  assert.deepEqual(normalized.home.subjectOrder, PERSONALIZATION_SUBJECT_IDS);
});

test("normalization accepts only a complete subject permutation", () => {
  const subjectOrder = [...PERSONALIZATION_SUBJECT_IDS].reverse();
  const normalized = normalizePersonalizationConfig({
    ...validConfig(),
    home: {
      subjectOrder,
      hiddenSubjectIds: [],
      semesterVisibility: { semester1: true, semester2: true },
    },
  });

  assert.deepEqual(normalized.home.subjectOrder, subjectOrder);
});

test("normalization ignores unknown fields and invalid nested shapes", () => {
  const normalized = normalizePersonalizationConfig({
    ...validConfig(),
    home: {
      subjectOrder: [...PERSONALIZATION_SUBJECT_IDS],
      hiddenSubjectIds: [],
      semesterVisibility: { semester1: true, semester2: true },
      unknown: "ignored",
    },
    unknown: { value: true },
  });

  assert.equal(normalized.themeId, "classic-99");
  assert.deepEqual(normalized.home.subjectOrder, PERSONALIZATION_SUBJECT_IDS);
  assert.equal("unknown" in normalized, false);
});

test("migration upgrades V1 and falls back safely for unsupported versions", () => {
  const migrated = migratePersonalizationConfig({
    version: 1,
    themeId: "classic-99",
    heroStyle: "classic",
    glassStyle: "balanced",
    motionStyle: "full",
    readingSize: "default",
    home: { subjectOrder: [...PERSONALIZATION_SUBJECT_IDS] },
  });
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.home.hiddenSubjectIds, []);
  assert.deepEqual(migrated.home.semesterVisibility, { semester1: true, semester2: true });

  const normalized = migratePersonalizationConfig({
    ...validConfig(),
    themeId: "emerald",
    home: {
      subjectOrder: [...PERSONALIZATION_SUBJECT_IDS].reverse(),
      hiddenSubjectIds: [],
      semesterVisibility: { semester1: true, semester2: true },
    },
  });
  assert.equal(normalized.themeId, "emerald");
  assert.deepEqual(normalized.home.subjectOrder, [...PERSONALIZATION_SUBJECT_IDS].reverse());

  const invalidV1 = migratePersonalizationConfig({
    version: 1,
    themeId: "emerald",
    heroStyle: "classic",
    glassStyle: "balanced",
    motionStyle: "full",
    readingSize: "default",
    home: { subjectOrder: ["SSC"] },
  });
  assert.deepEqual(invalidV1, createDefaultPersonalization());

  assert.deepEqual(migratePersonalizationConfig({ version: 0 }), {
    version: 2,
    themeId: "classic-99",
    heroStyle: "classic",
    glassStyle: "balanced",
    motionStyle: "full",
    readingSize: "default",
    home: {
      subjectOrder: PERSONALIZATION_SUBJECT_IDS,
      hiddenSubjectIds: [],
      semesterVisibility: { semester1: true, semester2: true },
    },
  });
  assert.deepEqual(migratePersonalizationConfig("invalid"), {
    version: 2,
    themeId: "classic-99",
    heroStyle: "classic",
    glassStyle: "balanced",
    motionStyle: "full",
    readingSize: "default",
    home: {
      subjectOrder: PERSONALIZATION_SUBJECT_IDS,
      hiddenSubjectIds: [],
      semesterVisibility: { semester1: true, semester2: true },
    },
  });
});

test("exports exactly the canonical presentation IDs", () => {
  assert.deepEqual(PERSONALIZATION_THEME_IDS, [
    "classic-99",
    "midnight",
    "ocean",
    "emerald",
    "rose",
    "amber",
    "violet",
    "monochrome",
  ]);
  assert.deepEqual(PERSONALIZATION_HERO_STYLES, [
    "classic",
    "minimal",
    "night",
    "aurora",
  ]);
  assert.deepEqual(PERSONALIZATION_GLASS_STYLES, ["clear", "balanced", "frosted"]);
  assert.deepEqual(PERSONALIZATION_MOTION_STYLES, ["full", "subtle", "reduced"]);
  assert.deepEqual(PERSONALIZATION_READING_SIZES, ["small", "default", "large"]);
});

test("strict validation rejects account appearance and app icon fields", () => {
  assert.equal(
    validatePersonalizationConfig({ ...validConfig(), appearance: "dark" }).success,
    false,
  );
  assert.equal(
    validatePersonalizationConfig({ ...validConfig(), themeMode: "system" }).success,
    false,
  );
  assert.equal(
    validatePersonalizationConfig({ ...validConfig(), appIconId: "night" }).success,
    false,
  );
  assert.equal(
    validatePersonalizationConfig({ ...validConfig(), iconId: "night" }).success,
    false,
  );
});

test("safe normalization strips appearance and icon fields from an otherwise valid V1 payload", () => {
  const normalized = normalizePersonalizationConfig({
    ...validConfig(),
    appearance: "dark",
    colorScheme: "dark",
    appIconId: "night",
    nativeIcon: "night",
  });

  assert.deepEqual(normalized, validConfig());
  assert.equal("appearance" in normalized, false);
  assert.equal("appIconId" in normalized, false);
});

test("missing and unsupported versions always use Classic 99 defaults", () => {
  const inputs = [
    {},
    { ...validConfig(), version: 0 },
    { ...validConfig(), version: 2 },
    { ...validConfig(), version: 99 },
    { ...validConfig(), version: "1" },
  ];

  for (const input of inputs) {
    assert.deepEqual(normalizePersonalizationConfig(input), createDefaultPersonalization());
    assert.deepEqual(migratePersonalizationConfig(input), createDefaultPersonalization());
  }
});

test("payload size uses UTF-8 bytes and enforces the 16 KiB limit", () => {
  assert.equal(MAX_PERSONALIZATION_PAYLOAD_BYTES, 16384);
  assert.equal(isPersonalizationPayloadWithinLimit(validConfig()), true);
  assert.equal(isPersonalizationPayloadWithinLimit("a".repeat(16383)), true);
  assert.equal(isPersonalizationPayloadWithinLimit("a".repeat(16385)), false);
  assert.equal(personalizationPayloadByteLength("ع"), 2);
  assert.equal(personalizationPayloadByteLength("😀"), 4);
  assert.equal(isPersonalizationPayloadWithinLimit("ع".repeat(8192)), true);
  assert.equal(isPersonalizationPayloadWithinLimit("ع".repeat(8193)), false);
});

test("oversized serialized payloads fail strict validation but do not throw during normalization", () => {
  const oversized = {
    ...validConfig(),
    irrelevant: "x".repeat(MAX_PERSONALIZATION_PAYLOAD_BYTES),
  };

  assert.equal(validatePersonalizationConfig(oversized).success, false);
  assert.doesNotThrow(() => normalizePersonalizationConfig(oversized));
  assert.deepEqual(
    normalizePersonalizationConfig(oversized),
    validConfig(),
  );
});

test("malformed input matrix never throws and safely falls back", () => {
  const malformedInputs: unknown[] = [
    undefined,
    null,
    "",
    "hello",
    0,
    123,
    [],
    {},
    { version: 1, themeId: "unknown" },
    { ...validConfig(), heroStyle: "unknown" },
    { ...validConfig(), glassStyle: "unknown" },
    { ...validConfig(), motionStyle: "unknown" },
    { ...validConfig(), readingSize: "unknown" },
    { ...validConfig(), home: {} },
    { ...validConfig(), home: { subjectOrder: ["ID"] } },
    { ...validConfig(), home: { subjectOrder: ["ID", "ID", "NT", "RM", "CA", "PHC", "ImD"] } },
    { ...validConfig(), home: { subjectOrder: ["ID", "NT", "RM", "CA", "PHC", "ImD", "UNKNOWN"] } },
    { ...validConfig(), home: { subjectOrder: [...PERSONALIZATION_SUBJECT_IDS, "ID"] } },
    { ...validConfig(), appearance: "dark" },
    { ...validConfig(), appIconId: "night" },
  ];

  for (const input of malformedInputs) {
    assert.doesNotThrow(() => normalizePersonalizationConfig(input));
    const normalized = normalizePersonalizationConfig(input);
    const hasOnlySafeUnknownField =
      typeof input === "object" &&
      input !== null &&
      !Array.isArray(input) &&
      ("appearance" in input || "appIconId" in input);
    assert.deepEqual(
      normalized,
      hasOnlySafeUnknownField ? validConfig() : createDefaultPersonalization(),
    );
  }
});