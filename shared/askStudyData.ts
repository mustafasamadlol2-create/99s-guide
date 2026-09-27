import { z } from "zod";

export const ASK_STUDY_DATA_VERSION = "ask-study-data-v1" as const;
export const ASK_STUDY_DATA_PROMPT_VERSION = "ask-study-data-prompt-v1" as const;
export const ASK_STUDY_DATA_ROUTER_VERSION = "ask-study-data-router-v1" as const;
export const ASK_STUDY_DATA_MAX_QUESTION_CHARACTERS = 500;
export const ASK_STUDY_DATA_MAX_FACT_SET_BYTES = 32 * 1024;

export const ASK_STUDY_DATA_INTENTS = [
  "ACTIVITY_SUMMARY",
  "CONSISTENCY",
  "FOCUS_SUMMARY",
  "OBJECTIVE_PRACTICE",
  "OBJECTIVE_TREND",
  "REPEATED_ERRORS",
  "FLASHCARD_SUMMARY",
  "RECALL_SUMMARY",
  "MASTERY_SUMMARY",
  "RETENTION_REVIEW",
  "DUE_REVIEW_LECTURES",
  "SUBJECT_ACTIVITY",
  "STUDY_TIME_PATTERN",
  "SESSION_LENGTH_PATTERN",
  "WEAKNESS_SIGNALS",
  "POSITIVE_SIGNALS",
  "GENERAL_STUDY_SUMMARY",
  "UNSUPPORTED",
] as const;

export const ASK_STUDY_DATA_WINDOWS = [
  "LAST_7_DAYS",
  "LAST_30_DAYS",
  "CURRENT_SEMESTER",
  "CURRENT",
] as const;

export const askStudyDataIntentSchema = z.enum(ASK_STUDY_DATA_INTENTS);
export const askStudyDataWindowSchema = z.enum(ASK_STUDY_DATA_WINDOWS);
export const askStudyDataLocaleSchema = z.enum(["ar", "en"]);

export type AskStudyDataIntent = z.infer<typeof askStudyDataIntentSchema>;
export type AskStudyDataWindow = z.infer<typeof askStudyDataWindowSchema>;
export type AskStudyDataLocale = z.infer<typeof askStudyDataLocaleSchema>;
export type AskStudyDataSupportedIntent = Exclude<AskStudyDataIntent, "UNSUPPORTED">;

export const askStudyDataRequestSchema = z.object({
  question: z.string(),
  locale: askStudyDataLocaleSchema.optional(),
}).strict();

const factValueSchema = z.union([
  z.number().finite().nullable(),
  z.string().max(500),
  z.boolean(),
]);

export const askStudyDataFactSetSchema = z.object({
  intent: askStudyDataIntentSchema.exclude(["UNSUPPORTED"]),
  window: askStudyDataWindowSchema,
  analyzerVersion: z.literal("study-analyzer-v1"),
  asOf: z.string().datetime({ offset: true }),
  facts: z.array(z.object({
    id: z.string().min(1).max(160),
    value: factValueSchema,
    unit: z.enum(["COUNT", "RATE_BPS", "SECONDS", "STATE", "TEXT"]).optional(),
    window: z.string().max(40).optional(),
  }).strict()).max(48),
  limitations: z.array(z.string().min(1).max(240)).max(8),
  references: z.object({
    lectureIds: z.array(z.string().min(1).max(255)).max(20),
    subjectIds: z.array(z.string().min(1).max(255)).max(20),
    itemIds: z.array(z.string().min(1).max(255)).max(20),
  }).strict(),
}).strict();

export type AskStudyDataFactSetV1 = z.infer<typeof askStudyDataFactSetSchema>;

export const askStudyDataWorkerRequestSchema = z.object({
  version: z.literal(ASK_STUDY_DATA_VERSION),
  promptVersion: z.literal(ASK_STUDY_DATA_PROMPT_VERSION),
  locale: askStudyDataLocaleSchema,
  intent: askStudyDataIntentSchema.exclude(["UNSUPPORTED"]),
  question: z.string().min(2).max(2_000),
  facts: askStudyDataFactSetSchema,
}).strict();

export type AskStudyDataWorkerRequestV1 = z.infer<typeof askStudyDataWorkerRequestSchema>;

export const askStudyDataAnswerSchema = z.object({
  version: z.literal(ASK_STUDY_DATA_VERSION),
  locale: askStudyDataLocaleSchema,
  intent: askStudyDataIntentSchema.exclude(["UNSUPPORTED"]),
  answer: z.string().min(1),
  evidence: z.array(z.object({
    factIds: z.array(z.string().min(1).max(160)).min(1).max(12),
    lectureIds: z.array(z.string().min(1).max(255)).max(20).optional(),
    subjectIds: z.array(z.string().min(1).max(255)).max(20).optional(),
    itemIds: z.array(z.string().min(1).max(255)).max(20).optional(),
  }).strict()).min(1).max(8),
  limitations: z.array(z.string().min(1).max(240)).max(5),
}).strict();

export type AskStudyDataAnswerV1 = z.infer<typeof askStudyDataAnswerSchema>;

const NUMBER_WORDS =
  /(?:^|[^\p{L}])(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)(?=$|[^\p{L}])/iu;
const ARABIC_NUMBER_WORDS =
  /(?:^|[^\p{L}])(?:واحد|واحدة|اثنان|اثنين|ثلاثة|ثلاث|أربعة|اربعة|خمسة|خمس|ستة|ست|سبعة|سبع|ثمانية|ثمان|تسعة|تسع|عشرة|عشرون|ثلاثون|أربعون|اربعون|خمسون|مئة|مائة|ألف)(?=$|[^\p{L}])/u;
const UNSUPPORTED_ANSWER_CLAIMS = [
  /\b(?:adhd|autism|depress(?:ion|ed)|anxiety|mental illness|diagnos(?:e|is|ed)|intelligence|smartness|motivation|lazy|unmotivated)\b/iu,
  /\b(?:will you pass|you will pass|exam outcome|guarantee(?:d)? (?:a )?pass|likely to pass|chances of passing|what grade you(?:'ll| will) get)\b/iu,
  /\b(?:caus(?:e|es|ed|ing)|because|due to|reason is|explained by|leads? to|results? in|proves? that|therefore|thus|consequently|as a result)\b/iu,
  /\b(?:you should|try to|i recommend|make a plan|create a schedule|start studying|review more|improve by)\b/iu,
  /\b(?:class average|other students|peer percentile|class rank|leaderboard|points)\b/iu,
  /\b(?:read|finished|completed) (?:the )?pdfs?\b/iu,
  /\bflashcards?\b.{0,48}\baccuracy\b|\baccuracy\b.{0,48}\bflashcards?\b/iu,
  /\b(?:skip|skipped|expiry|expired)\b.{0,48}\b(?:wrong|incorrect|failure|failed)\b/iu,
  /(?:بسبب|لان|لأن|نتيجة لذلك|يؤدي إلى|يسبب|يثبت أن|ذكي|ذكاء|اكتئاب|مكتئب|قلق|اضطراب|دافعية|كسول|نجاح مضمون|سأنجح|معدل الصف|طلاب آخرين|يجب عليك|أنصحك|ضع خطة|راجع أكثر)/u,
  /(?:بطاقات|فلاش كارد).{0,48}(?:دقة|صحيح|خطأ)|(?:دقة|صحيح|خطأ).{0,48}(?:بطاقات|فلاش كارد)/u,
] as const;

function normalizeNumberToken(value: string): string {
  const westernized = value
    .replace(/[٠-٩]/gu, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/gu, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/٬/gu, "")
    .replace(/٫/gu, ".");
  const normalized = westernized.replace(/,(?=\d{3}(?:\D|$))/gu, "").replace(/,/gu, ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? String(parsed) : normalized;
}

function numericTokens(text: string): string[] {
  return [...text.matchAll(/[\p{N}]+(?:[.,٫٬][\p{N}]+)*/gu)]
    .map((match) => normalizeNumberToken(match[0]));
}

function allowedNumericTokens(facts: AskStudyDataFactSetV1): Set<string> {
  const allowed = new Set<string>();
  for (const fact of facts.facts) {
    if (typeof fact.value === "number" && Number.isFinite(fact.value)) {
      allowed.add(normalizeNumberToken(String(fact.value)));
      if (fact.unit === "RATE_BPS") {
        allowed.add(normalizeNumberToken((fact.value / 100).toFixed(2)));
      }
    }
    if (typeof fact.value === "string") {
      for (const token of numericTokens(fact.value)) allowed.add(token);
    }
    if (fact.window === "LAST_7_DAYS") allowed.add("7");
    if (fact.window === "LAST_30_DAYS") allowed.add("30");
  }
  if (facts.window === "LAST_7_DAYS") allowed.add("7");
  if (facts.window === "LAST_30_DAYS") allowed.add("30");
  return allowed;
}

export function validateAskStudyDataAnswer(
  candidate: unknown,
  facts: AskStudyDataFactSetV1,
  locale: AskStudyDataLocale,
): AskStudyDataAnswerV1 | null {
  const parsed = askStudyDataAnswerSchema.safeParse(candidate);
  if (!parsed.success) return null;
  const output = parsed.data;
  if (output.locale !== locale || output.intent !== facts.intent) return null;

  const factIds = new Set(facts.facts.map((fact) => fact.id));
  const lectureIds = new Set(facts.references.lectureIds);
  const subjectIds = new Set(facts.references.subjectIds);
  const itemIds = new Set(facts.references.itemIds);
  for (const evidence of output.evidence) {
    if (!evidence.factIds.every((id) => factIds.has(id)) ||
        !(evidence.lectureIds ?? []).every((id) => lectureIds.has(id)) ||
        !(evidence.subjectIds ?? []).every((id) => subjectIds.has(id)) ||
        !(evidence.itemIds ?? []).every((id) => itemIds.has(id))) return null;
  }
  if (!output.limitations.every((limitation) => facts.limitations.includes(limitation))) return null;

  const answer = output.answer;
  if (Array.from(answer).length > 1_800 ||
      /<[^>]*>|(?:https?:\/\/|www\.)/iu.test(answer) ||
      UNSUPPORTED_ANSWER_CLAIMS.some((pattern) => pattern.test(answer)) ||
      NUMBER_WORDS.test(answer) ||
      ARABIC_NUMBER_WORDS.test(answer)) return null;
  const allowedNumbers = allowedNumericTokens(facts);
  if (!numericTokens(answer).every((token) => allowedNumbers.has(token))) return null;
  return output;
}