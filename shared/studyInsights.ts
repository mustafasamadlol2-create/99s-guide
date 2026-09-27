import { z } from "zod";

export const STUDY_INSIGHT_VERSION = "study-insight-v1" as const;
export const STUDY_INSIGHT_PROMPT_VERSION = "study-insight-prompt-v1" as const;
export const STUDY_INSIGHT_GROUNDING_VERSION = "study-insight-grounding-v1" as const;
export const STUDY_INSIGHT_TTL_SECONDS = 24 * 60 * 60;
export const STUDY_INSIGHT_MAX_GROUNDING_BYTES = 64 * 1024;

export const studyInsightLocaleSchema = z.enum(["ar", "en"]);
export type StudyInsightLocale = z.infer<typeof studyInsightLocaleSchema>;

const trendSchema = z.enum([
  "IMPROVED",
  "STABLE",
  "DECLINED",
  "INSUFFICIENT_DATA",
]);

const windowSchema = z.object({
  status: z.enum(["AVAILABLE", "UNAVAILABLE"]),
  from: z.string().nullable(),
  to: z.string(),
}).strict();

const evidenceSchema = z.object({
  metricId: z.string().min(1).max(120),
  numerator: z.number().int().nullable().optional(),
  denominator: z.number().int().nullable().optional(),
  rateBps: z.number().int().nullable().optional(),
  count: z.number().int().nullable().optional(),
  window: z.string().max(40).optional(),
}).strict();

const signalSchema = z.object({
  signalId: z.string().min(1).max(240),
  id: z.string().min(1).max(80),
  scope: z.enum(["GLOBAL", "SUBJECT", "LECTURE", "ITEM"]),
  severity: z.enum(["LOW", "MODERATE", "HIGH"]).optional(),
  subjectId: z.string().max(255).optional(),
  lectureId: z.string().max(255).optional(),
  itemId: z.string().max(255).optional(),
  evidence: evidenceSchema,
}).strict();

const factSchema = z.object({
  id: z.string().min(1).max(160),
  value: z.number().finite().nullable(),
  unit: z.enum(["COUNT", "RATE_BPS", "SECONDS"]),
  window: z.string().max(40).optional(),
}).strict();

const dueReviewSchema = z.object({
  lectureId: z.string().min(1).max(255),
  subjectId: z.string().max(255).nullable().optional(),
  effectiveMasteryState: z.string().min(1).max(80),
  reviewState: z.string().min(1).max(80),
  nextReviewAt: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();

const repeatedErrorSchema = z.object({
  itemId: z.string().min(1).max(255),
  lectureId: z.string().min(1).max(255),
  subjectId: z.string().max(255).nullable(),
  recentIncorrectCount: z.number().int().nonnegative(),
  recentCorrectCount: z.number().int().nonnegative(),
  lastOutcome: z.literal("INCORRECT"),
}).strict();

const distributionSchema = z.record(z.string().max(80), z.number().int().nonnegative());

export const studyInsightGroundingSchema = z.object({
  groundingVersion: z.literal(STUDY_INSIGHT_GROUNDING_VERSION),
  analyzerVersion: z.literal("study-analyzer-v1"),
  windows: z.object({
    last7Days: windowSchema,
    last30Days: windowSchema,
  }).strict(),
  dataQuality: z.object({
    trackedLectures: z.number().int().nonnegative().nullable(),
    freshRetentionRows: z.number().int().nonnegative().nullable(),
    staleRetentionRows: z.number().int().nonnegative().nullable(),
    missingRetentionRows: z.number().int().nonnegative().nullable(),
    insufficientPatterns: z.array(z.enum([
      "TIME_OF_DAY_PATTERN_INSUFFICIENT",
      "SESSION_LENGTH_PATTERN_INSUFFICIENT",
      "SOURCE_WINDOWS_INCOMPLETE",
      "SUBJECT_FACTS_TRUNCATED",
      "RETENTION_DATA_STALE",
      "RETENTION_DATA_MISSING",
    ])).max(8),
  }).strict(),
  activity: z.object({
    activeDays7d: z.number().int().nonnegative().nullable(),
    activeDays30d: z.number().int().nonnegative().nullable(),
    consistencyTrend: trendSchema,
  }).strict(),
  focus: z.object({
    meaningfulSessions30d: z.number().int().nonnegative().nullable(),
    verifiedSeconds30d: z.number().int().nonnegative().nullable(),
    completionRateBps: z.number().int().min(0).max(10_000).nullable(),
  }).strict(),
  objectivePractice: z.object({
    attempts30d: z.number().int().nonnegative().nullable(),
    accuracyRateBps30d: z.number().int().min(0).max(10_000).nullable(),
    trend: trendSchema,
  }).strict(),
  flashcards: z.object({
    reviews30d: z.number().int().nonnegative().nullable(),
    rememberedRateBps30d: z.number().int().min(0).max(10_000).nullable(),
  }).strict(),
  recall: z.object({
    answered30d: z.number().int().nonnegative().nullable(),
    objectiveAccuracyRateBps30d: z.number().int().min(0).max(10_000).nullable(),
    skipAndExpiryAreLearningFailures: z.literal(false),
  }).strict(),
  mastery: z.object({
    trackedLectures: z.number().int().nonnegative().nullable(),
    effectiveDistributionFreshOnly: distributionSchema.nullable(),
  }).strict(),
  retention: z.object({
    due: z.number().int().nonnegative().nullable(),
    overdue: z.number().int().nonnegative().nullable(),
    staleRows: z.number().int().nonnegative().nullable(),
    missingRows: z.number().int().nonnegative().nullable(),
  }).strict(),
  patterns: z.object({
    mostUsedTimeOfDay: z.object({
      status: z.enum(["SUPPORTED_PATTERN", "INSUFFICIENT_DATA"]),
      bucket: z.string().max(40).optional(),
      meaningfulSessions: z.number().int().nonnegative().optional(),
    }).strict(),
    bestSupportedOutcomeTimeBucket: z.object({
      status: z.enum(["SUPPORTED_PATTERN", "INSUFFICIENT_DATA"]),
      interpretationScope: z.literal("OBSERVED_ASSOCIATION"),
      bucket: z.string().max(40).optional(),
      linkedSessions: z.number().int().nonnegative().optional(),
      objectiveAttempts: z.number().int().nonnegative().optional(),
      objectiveCorrectRateBps: z.number().int().min(0).max(10_000).optional(),
    }).strict(),
    bestSupportedSessionLengthBucket: z.object({
      status: z.enum(["SUPPORTED_PATTERN", "INSUFFICIENT_DATA"]),
      interpretationScope: z.literal("OBSERVED_ASSOCIATION"),
      bucket: z.string().max(40).optional(),
      linkedSessions: z.number().int().nonnegative().optional(),
      objectiveAttempts: z.number().int().nonnegative().optional(),
      objectiveCorrectRateBps: z.number().int().min(0).max(10_000).optional(),
    }).strict(),
  }).strict(),
  facts: z.array(factSchema).max(64),
  weaknesses: z.array(signalSchema).max(20),
  positives: z.array(signalSchema).max(20),
  dueReviewLectures: z.array(dueReviewSchema).max(20),
  repeatedErrorItems: z.array(repeatedErrorSchema).max(20),
}).strict();

export type StudyInsightGroundingV1 = z.infer<typeof studyInsightGroundingSchema>;

const referencedFactIdsSchema = z.array(z.string().min(1).max(240)).min(1).max(6);
const insightText = z.string().min(1);

export const studyInsightOutputSchema = z.object({
  version: z.literal(STUDY_INSIGHT_VERSION),
  locale: studyInsightLocaleSchema,
  headline: insightText,
  summary: insightText,
  observations: z.array(z.object({
    id: z.string().regex(/^obs-[1-6]$/u),
    text: insightText,
    factIds: referencedFactIdsSchema,
  }).strict()).max(6),
  reviewPriorities: z.array(z.object({
    text: insightText,
    lectureId: z.string().min(1).max(255).optional(),
    subjectId: z.string().min(1).max(255).optional(),
    reasonFactIds: referencedFactIdsSchema,
  }).strict()).max(5),
  studySuggestions: z.array(z.object({
    text: insightText,
    reasonFactIds: referencedFactIdsSchema,
  }).strict()).max(5),
  dataLimitations: z.array(insightText).max(5),
}).strict();

export type StudyInsightV1 = z.infer<typeof studyInsightOutputSchema>;

export const studyInsightCacheEntrySchema = z.object({
  insightVersion: z.literal(STUDY_INSIGHT_VERSION),
  promptVersion: z.literal(STUDY_INSIGHT_PROMPT_VERSION),
  analyzerVersion: z.literal("study-analyzer-v1"),
  groundingFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  locale: studyInsightLocaleSchema,
  generatedAt: z.string().datetime({ offset: true }),
  model: z.string().min(1).max(200),
  output: studyInsightOutputSchema,
}).strict();

export type StudyInsightCacheEntry = z.infer<typeof studyInsightCacheEntrySchema>;

const USER_TEXT_LIMITS: ReadonlyArray<readonly [RegExp, string]> = [
  [/<[^>]*>/u, "HTML"],
  [/(?:https?:\/\/|www\.)/iu, "URL"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu, "email"],
  [/(?:\+?\d[\d\s().-]{7,}\d)/u, "phone number"],
  [/\p{N}/u, "numeric claim"],
  [/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b/iu, "number word"],
  [/(?:واحد|واحدة|اثنان|اثنين|ثلاثة|ثلاث|أربعة|اربعة|خمسة|خمس|ستة|ست|سبعة|سبع|ثمانية|ثمان|تسعة|تسع|عشرة|عشرون|ثلاثون|أربعون|اربعون|خمسون|مئة|مائة|ألف)/u, "Arabic number word"],
  [/\b(?:adhd|add|autism|depression|anxiety|burnout|mental illness|learning disorder)\b/iu, "diagnosis"],
  [/(?:اضطراب|اكتئاب|قلق|احتراق نفسي|فرط الحركة|تشتت الانتباه)/u, "diagnosis"],
  [/\b(?:points?|leaderboard|rank(?:ing)?|caused? by|because of|proves? that|therefore)\b/iu, "unsupported inference"],
  [/(?:النقاط|لوحة المتصدرين|بسبب|يثبت أن|دليل على)/u, "unsupported inference"],
  [/\bPDFs?\b/iu, "resource completion claim"],
  [/\bflashcards?\b.{0,48}\baccuracy\b|\baccuracy\b.{0,48}\bflashcards?\b/iu, "flashcard accuracy claim"],
  [/(?:بطاقات|فلاش كارد).{0,48}(?:دقة|صحيح|خطأ)|(?:دقة|صحيح|خطأ).{0,48}(?:بطاقات|فلاش كارد)/u, "flashcard accuracy claim"],
  [/\b(?:skip|skipped|expiry|expired)\b.{0,48}\b(?:wrong|incorrect|failure|failed|weakness)\b/iu, "Recall skip or expiry inference"],
  [/\b(?:wrong|incorrect|failure|failed|weakness)\b.{0,48}\b(?:skip|skipped|expiry|expired)\b/iu, "Recall skip or expiry inference"],
  [/(?:تخطي|تجاوز|انتهاء).{0,48}(?:خطأ|فشل|ضعف)|(?:خطأ|فشل|ضعف).{0,48}(?:تخطي|تجاوز|انتهاء)/u, "Recall skip or expiry inference"],
  [/\b(?:morning|afternoon|evening|night)\b/iu, "unsupported time-of-day pattern"],
  [/(?:الصباح|الظهر|بعد الظهر|المساء|الليل)/u, "unsupported time-of-day pattern"],
  [/\b(?:shorter|longer|short|long) sessions?\b|\bsession length\b|\bsession duration\b/iu, "unsupported session-length pattern"],
  [/(?:جلسات قصيرة|جلسات طويلة|مدة الجلسة|طول الجلسة)/u, "unsupported session-length pattern"],
];

function allUserFacingText(output: StudyInsightV1): string[] {
  return [
    output.headline,
    output.summary,
    ...output.observations.map((entry) => entry.text),
    ...output.reviewPriorities.map((entry) => entry.text),
    ...output.studySuggestions.map((entry) => entry.text),
    ...output.dataLimitations,
  ];
}

function unsupportedText(
  text: string,
  grounding: StudyInsightGroundingV1,
): boolean {
  for (const [pattern, reason] of USER_TEXT_LIMITS) {
    if (reason === "unsupported time-of-day pattern" &&
        (grounding.patterns.mostUsedTimeOfDay.status === "SUPPORTED_PATTERN" ||
         grounding.patterns.bestSupportedOutcomeTimeBucket.status === "SUPPORTED_PATTERN")) {
      continue;
    }
    if (reason === "unsupported session-length pattern" &&
        grounding.patterns.bestSupportedSessionLengthBucket.status === "SUPPORTED_PATTERN") {
      continue;
    }
    if (pattern.test(text)) return true;
  }
  return false;
}

export function validateStudyInsightOutput(
  candidate: unknown,
  grounding: StudyInsightGroundingV1,
  locale: StudyInsightLocale,
): StudyInsightV1 | null {
  const parsed = studyInsightOutputSchema.safeParse(candidate);
  if (!parsed.success) return null;
  const output = parsed.data;
  if (output.locale !== locale) return null;

  const allowedFactIds = new Set([
    ...grounding.facts.map((fact) => fact.id),
    ...grounding.weaknesses.map((signal) => signal.signalId),
    ...grounding.positives.map((signal) => signal.signalId),
  ]);
  const allowedLectureIds = new Set([
    ...grounding.dueReviewLectures.map((lecture) => lecture.lectureId),
    ...grounding.repeatedErrorItems.map((item) => item.lectureId),
  ]);
  const allowedSubjectIds = new Set([
    ...grounding.dueReviewLectures.flatMap((lecture) => lecture.subjectId ? [lecture.subjectId] : []),
    ...grounding.repeatedErrorItems.flatMap((item) => item.subjectId ? [item.subjectId] : []),
    ...grounding.weaknesses.flatMap((signal) => signal.subjectId ? [signal.subjectId] : []),
    ...grounding.positives.flatMap((signal) => signal.subjectId ? [signal.subjectId] : []),
  ]);

  for (const observation of output.observations) {
    if (!observation.factIds.every((id) => allowedFactIds.has(id))) return null;
  }
  for (const priority of output.reviewPriorities) {
    if (!priority.reasonFactIds.every((id) => allowedFactIds.has(id))) return null;
    if (priority.lectureId && !allowedLectureIds.has(priority.lectureId)) return null;
    if (priority.subjectId && !allowedSubjectIds.has(priority.subjectId)) return null;
  }
  for (const suggestion of output.studySuggestions) {
    if (!suggestion.reasonFactIds.every((id) => allowedFactIds.has(id))) return null;
  }

  const boundedText = allUserFacingText(output).every((text) => {
    const characters = Array.from(text);
    return characters.length <= 500 && !unsupportedText(text, grounding);
  });
  if (Array.from(output.headline).length > 120 ||
      Array.from(output.summary).length > 1_200 ||
      !boundedText) return null;

  return output;
}

export function deterministicDataLimitations(
  grounding: StudyInsightGroundingV1,
  locale: StudyInsightLocale,
): string[] {
  const messages: Record<string, { en: string; ar: string }> = {
    TIME_OF_DAY_PATTERN_INSUFFICIENT: {
      en: "There is not enough evidence to identify a study time-of-day pattern.",
      ar: "لا توجد أدلة كافية لتحديد نمط لوقت الدراسة.",
    },
    SESSION_LENGTH_PATTERN_INSUFFICIENT: {
      en: "There is not enough evidence to identify a session-length pattern.",
      ar: "لا توجد أدلة كافية لتحديد نمط لمدة جلسات الدراسة.",
    },
    SOURCE_WINDOWS_INCOMPLETE: {
      en: "Some study sources have incomplete coverage for the selected period.",
      ar: "تغطية بعض مصادر الدراسة غير مكتملة للفترة المحددة.",
    },
    SUBJECT_FACTS_TRUNCATED: {
      en: "Some subject-level details were omitted from this bounded summary.",
      ar: "حُذفت بعض تفاصيل المواد من هذا الملخص المحدود.",
    },
    RETENTION_DATA_STALE: {
      en: "Some retention information is stale and is not treated as current.",
      ar: "بعض معلومات الاستبقاء قديمة ولا تُعرض على أنها حالية.",
    },
    RETENTION_DATA_MISSING: {
      en: "Retention information is unavailable for some tracked lectures.",
      ar: "معلومات الاستبقاء غير متاحة لبعض المحاضرات المتتبعة.",
    },
  };
  return grounding.dataQuality.insufficientPatterns
    .map((pattern) => messages[pattern]?.[locale])
    .filter((message): message is string => Boolean(message))
    .slice(0, 5);
}