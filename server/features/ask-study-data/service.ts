import {
  ASK_STUDY_DATA_PROMPT_VERSION,
  ASK_STUDY_DATA_ROUTER_VERSION,
  ASK_STUDY_DATA_VERSION,
  ASK_STUDY_DATA_MAX_QUESTION_CHARACTERS,
  ASK_STUDY_DATA_MAX_FACT_SET_BYTES,
  validateAskStudyDataAnswer,
  type AskStudyDataFactSetV1,
  type AskStudyDataLocale,
  type AskStudyDataWindow,
} from "../../../shared/askStudyData.js";
import { parseStudyFeatureFlag } from "../study-core/featureFlags.js";
import { createStudyAnalyzerService } from "../study-analyzer/service.js";
import type { StudyAnalyzerDto } from "../study-analyzer/types.js";
import { buildAskStudyDataDeterministicAnswer, isDirectAskStudyDataQuestion } from "./deterministic.js";
import { buildAskStudyDataFactSet } from "./factSet.js";
import { resolveAskStudyDataSubject } from "./subjectResolver.js";
import {
  asksForUnsupportedTimeWindow,
  classifyAskStudyDataSafety,
  isSupportedAskIntent,
  normalizeAskQuestion,
  routeAskStudyDataQuestion,
} from "./routing.js";
import type {
  AskMyStudyDataResponse,
  AskStudyDataServiceInput,
  AskStudyDataWorkerRequest,
} from "./types.js";
import {
  createAskStudyDataWorkerCall,
  type AskStudyDataWorkerCall,
} from "./workerClient.js";

const SUPPORTED_EXAMPLES: Record<AskStudyDataLocale, string[]> = {
  en: [
    "How many active study days did I have in the last 30 days?",
    "What does my objective-question performance show?",
    "Which lectures are currently due for review?",
  ],
  ar: [
    "كم يوم دراسة نشط كان لدي في آخر 30 يوماً؟",
    "ماذا تُظهر نتائج أسئلتي الموضوعية؟",
    "ما المحاضرات المستحقة للمراجعة حالياً؟",
  ],
};

function unsupported(locale: AskStudyDataLocale, reason: string): AskMyStudyDataResponse {
  return {
    status: "UNSUPPORTED",
    reason,
    supportedExamples: SUPPORTED_EXAMPLES[locale],
    locale,
    routerVersion: ASK_STUDY_DATA_ROUTER_VERSION,
  };
}

function safetyResponse(locale: AskStudyDataLocale, reason: string): AskMyStudyDataResponse {
  if (reason === "CROSS_USER_DATA") {
    return {
      status: "UNSUPPORTED",
      reason: locale === "en"
        ? "I can only answer questions about your own study data."
        : "يمكنني الإجابة عن أسئلة بيانات دراستك أنت فقط.",
      supportedExamples: SUPPORTED_EXAMPLES[locale],
      locale,
      routerVersion: ASK_STUDY_DATA_ROUTER_VERSION,
    };
  }
  const messages: Record<string, Record<AskStudyDataLocale, string>> = {
    COHORT_DATA: {
      en: "Class averages and comparisons with other students are not available here.",
      ar: "لا تتوفر هنا معدلات الصف أو المقارنات مع الطلاب الآخرين.",
    },
    MEDICAL_OR_MENTAL_INFERENCE: {
      en: "The app does not infer intelligence or medical or mental-health conditions from study activity.",
      ar: "لا يستنتج التطبيق الذكاء أو الحالات الطبية أو النفسية من نشاط الدراسة.",
    },
    EXAM_OUTCOME_PREDICTION: {
      en: "Study activity can describe recorded progress, but it cannot predict or guarantee exam results.",
      ar: "يمكن لنشاط الدراسة وصف التقدم المسجّل، لكنه لا يتنبأ بنتائج الامتحان ولا يضمنها.",
    },
    MALICIOUS_INSTRUCTION: {
      en: "I can answer supported questions about your own study data, but I cannot follow instructions to reveal system details or access other data.",
      ar: "يمكنني الإجابة عن الأسئلة المدعومة حول بيانات دراستك فقط، ولا يمكنني كشف تعليمات النظام أو الوصول إلى بيانات أخرى.",
    },
    UNSUPPORTED_TOPIC: {
      en: "This feature answers questions about your recorded study data, not notes, lecture content, or resource completion.",
      ar: "تجيب هذه الميزة عن أسئلة بيانات دراستك المسجّلة، وليس عن الملاحظات أو محتوى المحاضرات أو إكمال الموارد.",
    },
  };
  const message = messages[reason]?.[locale] ?? (locale === "en"
    ? "This request is outside the supported study-data questions."
    : "هذا الطلب خارج نطاق أسئلة بيانات الدراسة المدعومة.");
  return {
    status: "UNSUPPORTED",
    reason: message,
    supportedExamples: SUPPORTED_EXAMPLES[locale],
    locale,
    routerVersion: ASK_STUDY_DATA_ROUTER_VERSION,
  };
}

function currentStateIntent(intent: string): boolean {
  return intent === "MASTERY_SUMMARY" ||
    intent === "RETENTION_REVIEW" ||
    intent === "DUE_REVIEW_LECTURES";
}

function metricWindow(intent: string, requested: AskStudyDataWindow): {
  window: AskStudyDataWindow;
  limitation?: string;
} {
  if (currentStateIntent(intent)) {
    return {
      window: "CURRENT",
      ...(requested !== "CURRENT"
        ? { limitation: "Mastery and Retention describe current state; historical state windows are not available." }
        : {}),
    };
  }
  if (requested === "CURRENT") {
    return {
      window: "LAST_30_DAYS",
      limitation: "A current-state window is not available for this time-based metric; the last 30 days are used.",
    };
  }
  return { window: requested };
}

function hasData(facts: AskStudyDataFactSetV1): boolean {
  return facts.facts.some((fact) => fact.value !== null);
}

function appendLimitation(facts: AskStudyDataFactSetV1, limitation: string): AskStudyDataFactSetV1 {
  const limitations = [...new Set([...facts.limitations, limitation])].slice(0, 8);
  const updated = { ...facts, limitations };
  if (new TextEncoder().encode(JSON.stringify(updated)).byteLength > ASK_STUDY_DATA_MAX_FACT_SET_BYTES) {
    throw new Error("ASK_STUDY_DATA_FACT_SET_TOO_LARGE");
  }
  return updated;
}

function resultFromAnswer(input: {
  source: "DETERMINISTIC" | "AI" | "DETERMINISTIC_FALLBACK";
  locale: AskStudyDataLocale;
  facts: AskStudyDataFactSetV1;
  answer: ReturnType<typeof buildAskStudyDataDeterministicAnswer>;
}): AskMyStudyDataResponse {
  return {
    status: "ANSWERED",
    source: input.source,
    intent: input.facts.intent,
    locale: input.locale,
    answer: input.answer.answer,
    evidence: input.answer.evidence,
    limitations: input.facts.limitations.slice(0, 5),
    asOf: input.facts.asOf,
    routerVersion: ASK_STUDY_DATA_ROUTER_VERSION,
    window: input.facts.window,
  };
}

export function createAskMyStudyDataService(options: {
  environment?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
  readAnalyzer?: (userId: string, asOf: Date) => Promise<StudyAnalyzerDto>;
  callWorker?: AskStudyDataWorkerCall;
} = {}): (input: AskStudyDataServiceInput) => Promise<AskMyStudyDataResponse> {
  const environment = options.environment ?? process.env;
  const callWorker = options.callWorker ?? createAskStudyDataWorkerCall({ environment });
  return async ({ userId, question, locale }) => {
    if (!parseStudyFeatureFlag(environment.ASK_MY_STUDY_DATA_ENABLED)) {
      return unsupported(locale, "FEATURE_DISABLED");
    }
    if (typeof userId !== "string" || userId.length === 0) {
      throw new Error("Authenticated user id is required.");
    }
    const normalizedQuestion = question.trim();
    if (Array.from(normalizedQuestion).length < 2 ||
        Array.from(normalizedQuestion).length > ASK_STUDY_DATA_MAX_QUESTION_CHARACTERS) {
      return unsupported(locale, "INVALID_QUESTION");
    }

    const safety = classifyAskStudyDataSafety(normalizedQuestion);
    if (safety.category !== "OWN_STUDY_DATA") {
      return safetyResponse(locale, safety.reason ?? safety.category);
    }
    if (asksForUnsupportedTimeWindow(normalizedQuestion)) {
      return unsupported(locale, "UNSUPPORTED_TIME_WINDOW");
    }

    const route = routeAskStudyDataQuestion(normalizedQuestion);
    if (!isSupportedAskIntent(route.intent)) {
      return unsupported(locale, "UNSUPPORTED_STUDY_DATA_QUESTION");
    }

    const rawAsOf = (options.now ?? (() => new Date()))();
    const asOf = new Date(rawAsOf.getTime());
    if (!Number.isFinite(asOf.getTime())) throw new Error("Ask My Study Data server time is invalid.");
    const readAnalyzer = options.readAnalyzer ?? ((authenticatedUserId: string, requestAsOf: Date) =>
      createStudyAnalyzerService({ now: () => requestAsOf })(authenticatedUserId));
    const dto = await readAnalyzer(userId, asOf);
    const subjectResolution = resolveAskStudyDataSubject(normalizedQuestion, dto);
    if (subjectResolution.status === "CLARIFICATION") {
      return {
        status: "NEEDS_CLARIFICATION",
        reason: subjectResolution.candidates.length
          ? locale === "en"
            ? "I couldn't identify one subject from the subjects available in your own study data."
            : "لم أتمكن من تحديد مادة واحدة من المواد المتاحة في بيانات دراستك."
          : locale === "en"
            ? "No matching subject is available in your study data."
            : "لا تتوفر مادة مطابقة في بيانات دراستك.",
        candidates: subjectResolution.candidates.map((candidate) =>
          candidate.replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069<>]/gu, " ").slice(0, 100),
        ),
        locale,
        routerVersion: ASK_STUDY_DATA_ROUTER_VERSION,
      };
    }
    const intent = subjectResolution.status === "MATCHED" ? "SUBJECT_ACTIVITY" : route.intent;
    const resolved = metricWindow(intent, route.window);
    let facts = buildAskStudyDataFactSet({
      dto,
      intent,
      window: resolved.window,
      asOf,
      recentlyDefaulted: route.recentlyDefaulted,
      ...(subjectResolution.status === "MATCHED" ? { subjectIds: [subjectResolution.subjectId] } : {}),
    });
    if (resolved.limitation) facts = appendLimitation(facts, resolved.limitation);
    const normalizedWindowQuestion = normalizeAskQuestion(normalizedQuestion);
    if (/(?:\b(?:this|current|last|past)\s+week\b|هذا الاسبوع|الاسبوع الحالي|اخر اسبوع)/u.test(normalizedWindowQuestion)) {
      facts = appendLimitation(facts, "Week wording is interpreted as the rolling last 7 days, not a calendar week.");
    } else if (/(?:\b(?:this|current|past)\s+month\b|هذا الشهر|الشهر الحالي)/u.test(normalizedWindowQuestion)) {
      facts = appendLimitation(facts, "Month wording is interpreted as the rolling last 30 days, not a calendar month.");
    }
    if (intent === "SUBJECT_ACTIVITY" &&
        /(?:\bbest\b|\bworst\b|\bstrongest\b|\bweakest\b|افضل|اسوأ|اسوء|الاقوى|الاضعف)/u.test(
          normalizedQuestion,
        )) {
      facts = appendLimitation(
        facts,
        "No composite best-or-worst subject score is calculated; only explicit per-subject facts are reported.",
      );
    }

    const deterministic = buildAskStudyDataDeterministicAnswer(facts, locale);
    if (!hasData(facts)) {
      const noDataAnswer = {
        ...deterministic,
        answer: locale === "en"
          ? "There is not enough available study data to answer this reliably for the selected period."
          : "لا تتوفر بيانات دراسة كافية للإجابة بثقة عن الفترة المحددة.",
      };
      return resultFromAnswer({ source: "DETERMINISTIC", locale, facts, answer: noDataAnswer });
    }
    if (intent === "SUBJECT_ACTIVITY" ||
        (route.directQuestion && isDirectAskStudyDataQuestion(facts, locale))) {
      return resultFromAnswer({ source: "DETERMINISTIC", locale, facts, answer: deterministic });
    }
    if (!parseStudyFeatureFlag(environment.ASK_MY_STUDY_DATA_AI_ENABLED)) {
      return resultFromAnswer({
        source: "DETERMINISTIC_FALLBACK",
        locale,
        facts,
        answer: deterministic,
      });
    }

    const request: AskStudyDataWorkerRequest = {
      version: ASK_STUDY_DATA_VERSION,
      promptVersion: ASK_STUDY_DATA_PROMPT_VERSION,
      locale,
      intent,
      question: normalizedQuestion,
      facts,
    };
    try {
      const candidate = await callWorker(request);
      const validated = validateAskStudyDataAnswer(candidate, facts, locale);
      if (validated) {
        return resultFromAnswer({ source: "AI", locale, facts, answer: validated });
      }
    } catch {
      // A validated deterministic answer is returned when the private Worker is unavailable.
    }
    return resultFromAnswer({
      source: "DETERMINISTIC_FALLBACK",
      locale,
      facts,
      answer: deterministic,
    });
  };
}

export const askMyStudyData = createAskMyStudyDataService();