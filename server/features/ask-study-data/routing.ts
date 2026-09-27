import type {
  AskStudyDataIntent,
  AskStudyDataSupportedIntent,
  AskStudyDataWindow,
} from "../../../shared/askStudyData.js";

export type AskStudyDataSafetyCategory =
  | "OWN_STUDY_DATA"
  | "CROSS_USER_DATA"
  | "COHORT_DATA"
  | "MEDICAL_OR_MENTAL_INFERENCE"
  | "EXAM_OUTCOME_PREDICTION"
  | "UNRELATED"
  | "MALICIOUS_INSTRUCTION";

export type AskStudyDataSafetyResult = {
  category: AskStudyDataSafetyCategory;
  reason?: string;
};

export type AskStudyDataRoute = {
  intent: AskStudyDataIntent;
  window: AskStudyDataWindow;
  interpretationExplicit: boolean;
  recentlyDefaulted: boolean;
  directQuestion: boolean;
};

export function normalizeAskQuestion(question: string): string {
  return question
    .normalize("NFKC")
    .toLocaleLowerCase("ar")
    .replace(/[\u064B-\u065F\u0670\u0640]/gu, "")
    .replace(/[أإآٱ]/gu, "ا")
    .replace(/ى/gu, "ي")
    .replace(/\s+/gu, " ")
    .trim();
}

const safetyPatterns: ReadonlyArray<{
  category: Exclude<AskStudyDataSafetyCategory, "OWN_STUDY_DATA">;
  pattern: RegExp;
  reason: string;
}> = [
  {
    category: "CROSS_USER_DATA",
    pattern: /\b(?:another|other)\s+(?:student|user)s?(?:'s)?\b|\b(?:someone else's|other user's|different user's) (?:student|user|person)|show (?:me )?(?:their|his|her) (?:data|study)|user\s*id\b|\b(?:student|user)\s+(?:id\s*)?#?\d+\b|\b(?:how|what|show|tell me)\b.{0,80}\b(?:did|does|has|is|had)\s+(?!(?:i|you|we|my)\b)[\p{L}][\p{L}'-]{1,32}\b.{0,48}\b(?:study|have|accuracy|performance|activity|active days|focus|retention|progress)\b|\b(?:show|tell me|what|how many)\b.{0,60}\b[\p{L}][\p{L}'-]{2,32}'s\b.{0,32}\b(?:data|study|accuracy|performance|activity|active days|focus|retention|progress)\b|(?:كم|ما).{0,25}(?:درس|تعلم|استذكر)\s+[\p{L}][\p{L} -]{1,40}|طلاب (?:غيري|اخرين)|طالب (?:ثاني|اخر)|بيانات (?:طالب|شخص) (?:اخر)|غير بياناتي|طلاب غيري/u,
    reason: "CROSS_USER_DATA",
  },
  {
    category: "COHORT_DATA",
    pattern: /\b(?:class average|class rank|peer percentile|compare me (?:to|with) (?:the )?(?:class|other students|my peers)|how do i compare to)\b|معدل الصف|متوسط الصف|ترتيبي (?:بالصف|بين الطلاب)|قارن(?:ي)?ني? (?:بالطلاب|بزملائي)/u,
    reason: "COHORT_DATA",
  },
  {
    category: "MEDICAL_OR_MENTAL_INFERENCE",
    pattern: /\b(?:do i have|am i|diagnos(?:e|is))\s*(?:adhd|add|autism|depression|anxiety|a mental|a learning)|\b(?:adhd|autism|depression|anxiety|mental health|learning disorder|intelligent|smart)\b|هل (?:لدي|عندي) (?:اضطراب|اكتئاب|قلق|فرط الحركة)|هل انا (?:مصاب|ذكي)|هل انا مصاب/u,
    reason: "MEDICAL_OR_MENTAL_INFERENCE",
  },
  {
    category: "EXAM_OUTCOME_PREDICTION",
    pattern: /\b(?:will i pass|am i going to pass|predict my (?:exam|grade)|guarantee (?:that )?i(?:'ll| will) pass)\b|هل (?:سأنجح|راح انجح|سأجتاز)|هل انجح بالامتحان/u,
    reason: "EXAM_OUTCOME_PREDICTION",
  },
  {
    category: "MALICIOUS_INSTRUCTION",
    pattern: /\b(?:ignore (?:all )?(?:previous|prior|safety|your) (?:instructions|rules)|show (?:me )?(?:your )?(?:system prompt|hidden prompt)|system prompt|drop table|select \* from|use gemini|change (?:the )?model|run (?:sql|a query))\b|تجاهل (?:كل|جميع) التعليمات|اعرض (?:تعليمات النظام|البرومبت)/u,
    reason: "MALICIOUS_INSTRUCTION",
  },
  {
    category: "UNRELATED",
    pattern: /\b(?:what did i write in my notes|search my notes|what does (?:this|the) lecture teach|explain (?:the )?(?:lecture|pdf)|summari[sz]e (?:the )?pdf|did i watch (?:the )?video|how much did i read)\b|ماذا كتبت في ملاحظاتي|ابحث في ملاحظاتي|اشرح محتوى المحاضرة|لخص ملف|هل شاهدت الفيديو/u,
    reason: "UNSUPPORTED_TOPIC",
  },
];

export function classifyAskStudyDataSafety(question: string): AskStudyDataSafetyResult {
  const normalized = normalizeAskQuestion(question);
  for (const entry of safetyPatterns) {
    if (entry.pattern.test(normalized)) {
      return { category: entry.category, reason: entry.reason };
    }
  }
  return { category: "OWN_STUDY_DATA" };
}

function hasCustomDateRange(question: string): boolean {
  return /\b(?:from|between|since|starting|beginning|on)\b.{0,80}\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{1,2}[/-]\d{1,2})\b|\b\d{4}-\d{2}-\d{2}\b|\bfrom\s+\d{1,2}\b.{0,80}\bto\s+\d{1,2}\b/u.test(question);
}

export function asksForCustomDateRange(question: string): boolean {
  return hasCustomDateRange(normalizeAskQuestion(question));
}

export function asksForUnsupportedTimeWindow(question: string): boolean {
  const text = normalizeAskQuestion(question);
  if (hasCustomDateRange(text)) return true;
  const hasRelativePeriod =
    /\b(?:last|past|previous|this|current|since|for|over)\s+(?:(?:the)\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple of|few)\s*(?:day|days|week|weeks|month|months|semester|semesters|quarter|quarters|year|years)\b/u.test(text) ||
    /\b(?:last|previous)\s+(?:week|month|semester|quarter|year)\b/u.test(text) ||
    /\b(?:last|past|previous|this|current)\s+(?:week|month|semester|quarter|academic year|calendar year|year)\b|\b(?:today|yesterday|year to date|this year|current year|last year)\b|\b(?:in|during|from|since)\s+(?:19|20)\d{2}\b/u.test(text) ||
    /(?:امس|اليوم|الاسبوع الماضي|الشهر الماضي|الفصل الماضي|السنة الماضية|(?:اخر|هذا|خلال|منذ)\s+(?:\d+|اسبوعين|ثلاثة اسابيع|شهرين|عدة|اسبوع|شهر|فصل|سنة)\s*(?:يوم|ايام|اسبوع|اسابيع|شهر|اشهر|فصل|فصول|سنة|سنوات)?)/u.test(text);
  if (!hasRelativePeriod) return false;
  const isSupportedWindow =
    /\b(?:last|past)\s+7\s+days\b|\b(?:last|past)\s+30\s+days\b|\b(?:this|current|last|past)\s+week\b|\b(?:this|current|past)\s+month\b|\b(?:this|current)\s+semester\b|\bcurrently\b|\bright now\b|\brecently\b|\blately\b/u.test(text) ||
    /(?:هذا الاسبوع|اخر اسبوع|اخر 7 ايام|اخر سبعة ايام|هذا الشهر|اخر 30 يوم|هذا الفصل|الفصل الحالي|حاليا|الان|مؤخرا|الفترة الاخيرة)/u.test(text);
  return !isSupportedWindow;
}

function detectWindow(question: string): {
  window: AskStudyDataWindow | null;
  recentlyDefaulted: boolean;
} {
  const text = normalizeAskQuestion(question);
  if (/(?:this week|current week|last week|past week|last 7 days|past 7 days|هذا الاسبوع|الاسبوع الحالي|اخر اسبوع|اخر 7 ايام|اخر سبعة ايام)/u.test(text)) {
    return { window: "LAST_7_DAYS", recentlyDefaulted: false };
  }
  if (/(?:this month|current month|past month|last 30 days|past 30 days|هذا الشهر|الشهر الحالي|اخر 30 يوم)/u.test(text)) {
    return { window: "LAST_30_DAYS", recentlyDefaulted: false };
  }
  if (/(?:this semester|current semester|ه[ا]ذا الفصل|هذا الفصل|هالفصل|الفصل الحالي)/u.test(text)) {
    return { window: "CURRENT_SEMESTER", recentlyDefaulted: false };
  }
  if (/(?:\bcurrent(?:ly)?\b|\bright now\b|حاليا|حالياً|الان|الآن|الحالي)/u.test(text)) {
    return { window: "CURRENT", recentlyDefaulted: false };
  }
  if (/(?:\brecently\b|\blately\b|الفترة الاخيرة|الفترة الأخيرة|مؤخرا|مؤخراً)/u.test(text)) {
    return { window: "LAST_30_DAYS", recentlyDefaulted: true };
  }
  return { window: null, recentlyDefaulted: false };
}

function inferIntent(question: string): AskStudyDataIntent {
  const text = normalizeAskQuestion(question);
  if (/(?:what should i review|what needs review|which lecture should i review|lectures? (?:to|i should) review|due reviews?|overdue lectures?|شنو احتاج اراجع|شنو احتاج أراجع|شنو المحاضرات اللي لازم اراجعها|المحاضرات اللي لازم اراجعها|ماذا اراجع|ماذا أراجع|شنو اراجع|محاضرات مستحقة|محاضرات متأخرة)/u.test(text)) {
    return "DUE_REVIEW_LECTURES";
  }
  if (/(?:retention|review state|overdue|due for review|حالة المراجعة|الاستبقاء|مراجعة متأخرة)/u.test(text)) {
    return "RETENTION_REVIEW";
  }
  if (/(?:am i more consistent|study consistency|consistency|study regularly|streak|هل داتحسن(?: بالالتزام)?|استمراريتي|انتظامي|الاستمرارية|التزامي|سلسلة الدراسة)/u.test(text)) {
    return "CONSISTENCY";
  }
  if (/(?:\b(?:by|per|each)\s+(?:subject|course|material)\b|\b(?:subject|course|material)\b.{0,40}\b(?:activity|performance|accuracy|review|progress)\b|حسب المادة|لكل مادة|لكل المواد|نشاط المواد)/u.test(text)) {
    return "SUBJECT_ACTIVITY";
  }
  if (/(?:mcq|objective|question accuracy|accuracy rate|دقة الاسئلة|دقة الأسئلة|دقتي بال|الاسئلة الموضوعية|الأسئلة الموضوعية)/u.test(text)) {
    if (/(?:trend|improv|declin|change|getting better|تحسن|اتحسن|تغير|تتغير)/u.test(text)) return "OBJECTIVE_TREND";
    return "OBJECTIVE_PRACTICE";
  }
  if (/(?:repeated errors?|repeat(?:ed)? mistakes?|keep getting wrong|wrong questions|الاخطاء المتكررة|الأخطاء المتكررة|اغلاطي المتكررة|أخطائي المتكررة|اخطائي|أخطائي)/u.test(text)) {
    return "REPEATED_ERRORS";
  }
  if (/(?:flash ?cards?|بطاقات المراجعة|فلاش كارد|الفلاش كارد)/u.test(text)) return "FLASHCARD_SUMMARY";
  if (/(?:recall|retrieval practice|استرجاع|التذكر الدوري|المراجعة المتباعدة)/u.test(text)) return "RECALL_SUMMARY";
  if (/(?:mastery|effective mastery|how well do i know|mastered|اتقاني|إتقاني|الإتقان|اتقان|إتقان|مستوى معرفتي)/u.test(text)) return "MASTERY_SUMMARY";
  if (/(?:focus|verified study time|how many hours did i study|hours did i focus|فوكس|التركيز|كم ساعة درست|كم ساعة ركزت)/u.test(text)) return "FOCUS_SUMMARY";
  if (/(?:when do i study|what time do i study|study time pattern|best time to study|when do i study best|باي وقت غالبا ادرس|متى ادرس|وقت الدراسة|اكثر وقت ادرس)/u.test(text)) return "STUDY_TIME_PATTERN";
  if (/(?:session length|session duration|how long are my sessions|what session length|مدة الجلسات|طول الجلسة|مدة الجلسة)/u.test(text)) return "SESSION_LENGTH_PATTERN";
  if (/(?:weakness|weak areas?|weak lectures?|what am i weak|المحاضرات الضعيفة|نقاط ضعفي|مواطن الضعف|اشارات الضعف|إشارات الضعف)/u.test(text)) return "WEAKNESS_SIGNALS";
  if (/(?:positive signals?|strengths?|what am i doing well|what improved|نقاط القوة|الجوانب الايجابية|الجوانب الإيجابية|اشارات ايجابية|إشارات إيجابية)/u.test(text)) return "POSITIVE_SIGNALS";
  if (/(?:subject|subjects|course|material|المادة|المواد|المواد الدراسية|المواد الاقوى|المادة الافضل|المادة الأسوأ|اسوء مادة|أسوأ مادة|افضل مادة|أفضل مادة)/u.test(text)) return "SUBJECT_ACTIVITY";
  if (/(?:active days?|study days?|how many days|activity summary|كم يوم درست|ايام الدراسة|أيام الدراسة|ايام نشاط|أيام نشاط)/u.test(text)) return "ACTIVITY_SUMMARY";
  if (/(?:am i improving|how am i doing|study summary|general study|my study data|overall progress|هل داتحسن|هل اتحسن|شلون وضعي|كيف كان ادائي|ملخص دراستي|ملخص الدراسه)/u.test(text)) return "GENERAL_STUDY_SUMMARY";
  return "UNSUPPORTED";
}

function isDirectQuestion(question: string): boolean {
  const text = normalizeAskQuestion(question);
  return /^(?:(?:how many|what is|what are|what was|how much)\b|كم|ما هو|ما هي|شنو عدد|شنو نسبة|ما مقدار|ما عدد)/u.test(text) ||
    /(?:exactly|exact count|العدد بالضبط|كم عدد)/u.test(text);
}

export function routeAskStudyDataQuestion(question: string): AskStudyDataRoute {
  const intent = inferIntent(question);
  const detected = detectWindow(question);
  const defaultsToCurrent = intent === "MASTERY_SUMMARY" ||
    intent === "RETENTION_REVIEW" ||
    intent === "DUE_REVIEW_LECTURES";
  const window = detected.window ?? (defaultsToCurrent ? "CURRENT" : "LAST_30_DAYS");
  return {
    intent,
    window,
    interpretationExplicit: detected.window !== null,
    recentlyDefaulted: detected.recentlyDefaulted,
    directQuestion: isDirectQuestion(question),
  };
}

export function isSupportedAskIntent(intent: AskStudyDataIntent): intent is AskStudyDataSupportedIntent {
  return intent !== "UNSUPPORTED";
}