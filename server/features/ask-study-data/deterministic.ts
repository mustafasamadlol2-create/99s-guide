import type {
  AskStudyDataAnswerV1,
  AskStudyDataFactSetV1,
  AskStudyDataLocale,
} from "../../../shared/askStudyData.js";

function getFact(facts: AskStudyDataFactSetV1, id: string) {
  return facts.facts.find((fact) => fact.id === id);
}

function textValue(value: number | string | boolean | null | undefined, locale: AskStudyDataLocale): string {
  if (value === null || value === undefined) return locale === "ar" ? "غير متاح" : "unavailable";
  return String(value);
}

function localizedWindow(window: AskStudyDataFactSetV1["window"], locale: AskStudyDataLocale): string {
  const values = {
    en: {
      LAST_7_DAYS: "the last 7 days",
      LAST_30_DAYS: "the last 30 days",
      CURRENT_SEMESTER: "this semester",
      CURRENT: "currently",
    },
    ar: {
      LAST_7_DAYS: "آخر 7 أيام",
      LAST_30_DAYS: "آخر 30 يوماً",
      CURRENT_SEMESTER: "هذا الفصل",
      CURRENT: "حالياً",
    },
  } as const;
  return values[locale][window];
}

function evidenceIds(facts: AskStudyDataFactSetV1): string[] {
  const ids = facts.facts.map((fact) => fact.id);
  const selected = (prefix: string, max = 8) => ids.filter((id) => id.startsWith(prefix)).slice(0, max);
  const windowSuffix = facts.window === "LAST_7_DAYS"
    ? "7d"
    : facts.window === "CURRENT_SEMESTER"
      ? "semester"
      : "30d";
  switch (facts.intent) {
    case "ACTIVITY_SUMMARY":
      return [`activity.active_days.${windowSuffix}`];
    case "FOCUS_SUMMARY":
      return [`focus.verified_seconds.${windowSuffix}`, `focus.meaningful_sessions.${windowSuffix}`];
    case "OBJECTIVE_PRACTICE":
      return [`mcq.objective_accuracy.${windowSuffix}`, `mcq.objective_attempts.${windowSuffix}`];
    case "CONSISTENCY":
      return [
        `activity.active_days.${windowSuffix}`,
        "consistency.trend.state",
        "consistency.current_streak_days",
        "consistency.active_day_rate.30d",
      ];
    case "OBJECTIVE_TREND":
      return [
        "mcq.objective_trend.state",
        "mcq.objective_trend.latest_accuracy",
        "mcq.objective_trend.previous_accuracy",
      ];
    case "REPEATED_ERRORS":
      return ["mcq.repeated_errors.count.90d", ...selected("mcq.repeated_error.incorrect.", 5)];
    case "FLASHCARD_SUMMARY":
      return [
        `flashcards.meaningful_reviews.${windowSuffix}`,
        `flashcards.self_reported_remembered.${windowSuffix}`,
        `flashcards.self_reported_not_remembered.${windowSuffix}`,
      ];
    case "RECALL_SUMMARY":
      return [
        `recall.presented.${windowSuffix}`,
        `recall.answered.${windowSuffix}`,
        `recall.skipped.${windowSuffix}`,
        `recall.expired.${windowSuffix}`,
        `recall.objective_correct.${windowSuffix}`,
        `recall.objective_incorrect.${windowSuffix}`,
      ];
    case "MASTERY_SUMMARY":
      return ["mastery.tracked_lectures.current", ...selected("mastery.effective_distribution.", 7)];
    case "RETENTION_REVIEW":
      return [
        "retention.due.current",
        "retention.overdue.current",
        "retention.needs_review.current",
        "retention.fresh_rows.current",
        "retention.stale_rows.current",
        "retention.missing_rows.current",
      ];
    case "DUE_REVIEW_LECTURES":
      return ["retention.due.current", "retention.overdue.current"];
    case "SUBJECT_ACTIVITY":
      return selected("subject.", 12);
    case "STUDY_TIME_PATTERN":
      return [
        "pattern.most_used_time_of_day.status",
        "pattern.most_used_time_of_day.bucket",
        "pattern.best_outcome_time.status",
        "pattern.best_outcome_time.bucket",
      ];
    case "SESSION_LENGTH_PATTERN":
      return [
        "pattern.session_length.status",
        "pattern.session_length.bucket",
        "pattern.session_length.linked_sessions",
        "pattern.session_length.objective_accuracy",
      ];
    case "WEAKNESS_SIGNALS":
      return selected("weakness.", 8).filter((id) => /^weakness\.\d+$/u.test(id));
    case "POSITIVE_SIGNALS":
      return selected("positive.", 8);
    case "GENERAL_STUDY_SUMMARY":
      return [
        `activity.active_days.${windowSuffix}`,
        `focus.verified_seconds.${windowSuffix}`,
        `mcq.objective_accuracy.${windowSuffix}`,
        "consistency.trend.state",
        "retention.due.current",
      ];
  }
}

function evidenceFor(facts: AskStudyDataFactSetV1): AskStudyDataAnswerV1["evidence"] {
  const available = new Set(facts.facts.map((fact) => fact.id));
  const ids = evidenceIds(facts)
    .filter((id) => available.has(id))
    .slice(0, facts.intent === "SUBJECT_ACTIVITY" ? 12 : 8);
  if (facts.intent === "SUBJECT_ACTIVITY" && ids.length > 0) {
    return [{
      factIds: ids,
      ...(facts.references.subjectIds.length ? { subjectIds: facts.references.subjectIds.slice(0, 2) } : {}),
    }];
  }
  return ids.map((id) => ({ factIds: [id] }));
}

function rate(value: number | string | boolean | null | undefined): string {
  if (typeof value !== "number") return "—";
  return `${(value / 100).toFixed(2).replace(/\.?0+$/u, "")}%`;
}

function directAnswer(facts: AskStudyDataFactSetV1, locale: AskStudyDataLocale): string | null {
  const { intent, window } = facts;
  const period = localizedWindow(window, locale);
  const en = locale === "en";
  const suffix = window === "LAST_7_DAYS" ? "7d" : window === "CURRENT_SEMESTER" ? "semester" : "30d";
  const value = (id: string) => getFact(facts, id)?.value;
  const state = (id: string) => {
    const raw = value(id);
    return typeof raw === "string" ? raw.toLowerCase().replace(/_/gu, " ") : textValue(raw, locale);
  };
  switch (intent) {
    case "ACTIVITY_SUMMARY": {
      const days = value(`activity.active_days.${suffix}`);
      return en
        ? `You had ${textValue(days, locale)} active study days in ${period}.`
        : `كان لديك ${textValue(days, locale)} يوماً دراسياً نشطاً خلال ${period}.`;
    }
    case "FOCUS_SUMMARY": {
      const seconds = value(`focus.verified_seconds.${suffix}`);
      const sessions = value(`focus.meaningful_sessions.${suffix}`);
      return en
        ? `The app recorded ${textValue(seconds, locale)} verified Focus seconds across ${textValue(sessions, locale)} meaningful sessions in ${period}. This is recorded app Focus time, not all real-life study time.`
        : `سجّل التطبيق ${textValue(seconds, locale)} ثانية تركيز موثقة ضمن ${textValue(sessions, locale)} جلسة ذات معنى خلال ${period}. هذا وقت التركيز المسجّل في التطبيق، وليس كل وقت الدراسة الفعلي.`;
    }
    case "OBJECTIVE_PRACTICE": {
      const accuracy = value(`mcq.objective_accuracy.${suffix}`);
      const attempts = value(`mcq.objective_attempts.${suffix}`);
      return en
        ? `Your combined objective-question accuracy was ${rate(accuracy)} across ${textValue(attempts, locale)} attempts in ${period}.`
        : `بلغت دقتك في الأسئلة الموضوعية ${rate(accuracy)} عبر ${textValue(attempts, locale)} محاولة خلال ${period}.`;
    }
    case "CONSISTENCY": {
      const days = value(`activity.active_days.${suffix}`);
      const streak = value("consistency.current_streak_days");
      const trend = state("consistency.trend.state");
      return en
        ? `Recorded consistency trend: ${trend}. You had ${textValue(days, locale)} active study days in ${period}; the current app-recorded streak is ${textValue(streak, locale)} days.`
        : `اتجاه الانتظام المسجّل: ${trend}. كان لديك ${textValue(days, locale)} يوماً دراسياً نشطاً خلال ${period}، وسلسلة الدراسة المسجّلة حالياً ${textValue(streak, locale)} يوماً.`;
    }
    case "OBJECTIVE_TREND": {
      const trend = state("mcq.objective_trend.state");
      const latest = value("mcq.objective_trend.latest_accuracy");
      const previous = value("mcq.objective_trend.previous_accuracy");
      return en
        ? `The fixed 90-day objective-question comparison is ${trend}. Accuracy was ${rate(previous)} in the previous comparison window and ${rate(latest)} in the latest one. This is a comparison, not a causal explanation.`
        : `اتجاه نتائج الأسئلة الموضوعية المسجّل خلال آخر 90 يوماً هو ${trend}. بلغت الدقة ${rate(previous)} في فترة المقارنة السابقة و${rate(latest)} في الأحدث. هذه مقارنة وليست تفسيراً سببياً.`;
    }
    case "REPEATED_ERRORS": {
      const count = value("mcq.repeated_errors.count.90d");
      const recentCounts = facts.facts
        .filter((fact) => /^mcq\.repeated_error\.incorrect\.\d+$/u.test(fact.id) && typeof fact.value === "number")
        .map((fact) => String(fact.value))
        .slice(0, 5);
      return en
        ? `The fixed 90-day record contains ${textValue(count, locale)} repeated-error items. Their recorded recent incorrect counts include: ${recentCounts.length ? recentCounts.join(", ") : "unavailable"}.`
        : `يتضمن سجل آخر 90 يوماً ${textValue(count, locale)} عناصر ذات أخطاء متكررة. ومن أعداد الإجابات الخاطئة المسجّلة حديثاً لهذه العناصر: ${recentCounts.length ? recentCounts.join("، ") : "غير متاح"}.`;
    }
    case "FLASHCARD_SUMMARY": {
      const meaningful = value(`flashcards.meaningful_reviews.${suffix}`);
      const remembered = value(`flashcards.self_reported_remembered.${suffix}`);
      const notRemembered = value(`flashcards.self_reported_not_remembered.${suffix}`);
      return en
        ? `You recorded ${textValue(meaningful, locale)} meaningful Flashcard reviews in ${period}: ${textValue(remembered, locale)} self-reported remembered and ${textValue(notRemembered, locale)} self-reported not remembered. These are self-reports, not objective accuracy.`
        : `سجّلت ${textValue(meaningful, locale)} مراجعة ذات معنى للبطاقات خلال ${period}: ${textValue(remembered, locale)} تذكّر مُبلّغ عنه ذاتياً و${textValue(notRemembered, locale)} عدم تذكّر مُبلّغ عنه ذاتياً. هذه إفادات ذاتية وليست دقة موضوعية.`;
    }
    case "RECALL_SUMMARY": {
      const presented = value(`recall.presented.${suffix}`);
      const answered = value(`recall.answered.${suffix}`);
      const skipped = value(`recall.skipped.${suffix}`);
      const expired = value(`recall.expired.${suffix}`);
      const correct = value(`recall.objective_correct.${suffix}`);
      const incorrect = value(`recall.objective_incorrect.${suffix}`);
      return en
        ? `In ${period}, Recall recorded ${textValue(presented, locale)} presented, ${textValue(answered, locale)} answered, ${textValue(skipped, locale)} skipped, and ${textValue(expired, locale)} expired prompts. Among answered objective outcomes, ${textValue(correct, locale)} were correct and ${textValue(incorrect, locale)} incorrect; skips and expiries are not counted as failures.`
        : `سجّل الاسترجاع خلال ${period} عدد ${textValue(presented, locale)} منبّهاً معروضاً و${textValue(answered, locale)} مجاباً و${textValue(skipped, locale)} متجاوزاً و${textValue(expired, locale)} منتهياً. ومن نتائج الأسئلة الموضوعية المجاب عنها، كان ${textValue(correct, locale)} صحيحاً و${textValue(incorrect, locale)} خاطئاً؛ ولا تُحسب حالات التجاوز أو الانتهاء إخفاقاً.`;
    }
    case "DUE_REVIEW_LECTURES":
      return en
        ? `There are ${textValue(getFact(facts, "retention.due.current")?.value, locale)} currently due lectures and ${textValue(getFact(facts, "retention.overdue.current")?.value, locale)} overdue lectures.`
        : `لديك حالياً ${textValue(getFact(facts, "retention.due.current")?.value, locale)} محاضرة مستحقة للمراجعة و${textValue(getFact(facts, "retention.overdue.current")?.value, locale)} محاضرة متأخرة.`;
    case "RETENTION_REVIEW":
      return en
        ? `Current Retention records show ${textValue(value("retention.due.current"), locale)} due, ${textValue(value("retention.overdue.current"), locale)} overdue, and ${textValue(value("retention.needs_review.current"), locale)} needing review. ${textValue(value("retention.fresh_rows.current"), locale)} projections are fresh, ${textValue(value("retention.stale_rows.current"), locale)} are stale, and ${textValue(value("retention.missing_rows.current"), locale)} are missing.`
        : `تُظهر سجلات الاستبقاء الحالية ${textValue(value("retention.due.current"), locale)} مستحقة و${textValue(value("retention.overdue.current"), locale)} متأخرة و${textValue(value("retention.needs_review.current"), locale)} تحتاج إلى مراجعة. توجد ${textValue(value("retention.fresh_rows.current"), locale)} إسقاطات حديثة و${textValue(value("retention.stale_rows.current"), locale)} قديمة و${textValue(value("retention.missing_rows.current"), locale)} مفقودة.`;
    case "MASTERY_SUMMARY": {
      const distribution = facts.facts
        .filter((fact) => fact.id.startsWith("mastery.effective_distribution."))
        .map((fact) => `${fact.id.split(".")[2]}: ${textValue(fact.value, locale)}`);
      return en
        ? `The app tracks ${textValue(getFact(facts, "mastery.tracked_lectures.current")?.value, locale)} lectures. Fresh effective Mastery distribution: ${distribution.length ? distribution.join(", ") : "unavailable"}. This is an app signal, not a claim about what you know absolutely.`
        : `يتابع التطبيق ${textValue(getFact(facts, "mastery.tracked_lectures.current")?.value, locale)} محاضرة. توزيع الإتقان الفعّال من البيانات الحديثة: ${distribution.length ? distribution.join("، ") : "غير متاح"}. هذا مؤشر داخل التطبيق وليس حكماً مطلقاً على معرفتك.`;
    }
    case "STUDY_TIME_PATTERN": {
      const status = state("pattern.most_used_time_of_day.status");
      const bucket = value("pattern.most_used_time_of_day.bucket");
      const bestStatus = state("pattern.best_outcome_time.status");
      const bestBucket = value("pattern.best_outcome_time.bucket");
      return en
        ? `Most-used recorded time of day: ${status === "supported pattern" ? textValue(bucket, locale) : "insufficient data"}. Supported outcome-time association: ${bestStatus === "supported pattern" ? textValue(bestBucket, locale) : "insufficient data"}. These are observed associations, not evidence that a time causes better results.`
        : `الفترة الأكثر استخداماً في السجل: ${status === "supported pattern" ? textValue(bucket, locale) : "بيانات غير كافية"}. الارتباط المدعوم بنتائج الأسئلة حسب الوقت: ${bestStatus === "supported pattern" ? textValue(bestBucket, locale) : "بيانات غير كافية"}. هذه ارتباطات مرصودة وليست دليلاً على أن وقتاً معيناً يسبب نتائج أفضل.`;
    }
    case "SESSION_LENGTH_PATTERN": {
      const status = state("pattern.session_length.status");
      const bucket = value("pattern.session_length.bucket");
      const sessions = value("pattern.session_length.linked_sessions");
      const accuracy = value("pattern.session_length.objective_accuracy");
      return en
        ? `Session-length pattern status: ${status}. ${status === "supported pattern" ? `The observed session-length bucket was ${textValue(bucket, locale)}, across ${textValue(sessions, locale)} linked sessions; associated objective accuracy was ${rate(accuracy)}.` : "There is not enough linked data to report a session-length pattern."} This is an association, not causation.`
        : `حالة نمط طول الجلسة: ${status}. ${status === "supported pattern" ? `كانت فئة طول الجلسة المرصودة ${textValue(bucket, locale)} عبر ${textValue(sessions, locale)} جلسة مرتبطة؛ وبلغت دقة الأسئلة الموضوعية المرتبطة ${rate(accuracy)}.` : "لا تتوفر بيانات مترابطة كافية لعرض نمط طول الجلسة."} هذا ارتباط وليس علاقة سببية.`;
    }
    case "WEAKNESS_SIGNALS":
    case "POSITIVE_SIGNALS": {
      const isWeakness = intent === "WEAKNESS_SIGNALS";
      const signalFacts = facts.facts.filter((fact) => /^(?:weakness|positive)\.\d+$/u.test(fact.id));
      const labels = signalFacts.slice(0, 8).map((fact) =>
        String(fact.value).replace(/_/gu, " ").toLowerCase(),
      );
      return en
        ? `${isWeakness ? "Recorded study signals" : "Recorded positive study signals"}: ${labels.length ? labels.join("; ") : "none available"}. These describe app records, not personal ability.`
        : `${isWeakness ? "إشارات الدراسة المسجّلة" : "إشارات الدراسة الإيجابية المسجّلة"}: ${labels.length ? labels.join("؛ ") : "لا تتوفر"}. تصف هذه الإشارات سجلات التطبيق وليست حكماً على القدرة الشخصية.`;
    }
    case "GENERAL_STUDY_SUMMARY": {
      const days = value(`activity.active_days.${suffix}`);
      const accuracy = value(`mcq.objective_accuracy.${suffix}`);
      const focusSeconds = value(`focus.verified_seconds.${suffix}`);
      const due = value("retention.due.current");
      const trend = state("consistency.trend.state");
      return en
        ? `Recorded study summary for ${period}: ${textValue(days, locale)} active days, ${textValue(focusSeconds, locale)} verified Focus seconds, ${rate(accuracy)} objective-question accuracy, consistency trend ${trend}, and ${textValue(due, locale)} lectures currently due for review. These facts describe recorded activity only.`
        : `ملخص الدراسة المسجّل خلال ${period}: ${textValue(days, locale)} يوماً نشطاً و${textValue(focusSeconds, locale)} ثانية تركيز موثقة ودقة ${rate(accuracy)} للأسئلة الموضوعية واتجاه انتظام ${trend} و${textValue(due, locale)} محاضرة مستحقة للمراجعة حالياً. تصف هذه الحقائق النشاط المسجّل فقط.`;
    }
    case "SUBJECT_ACTIVITY": {
      const subjectIds = [...new Set(facts.references.subjectIds)].slice(0, 2);
      const rows = subjectIds.map((subjectId, index) => {
        const safeName = subjectId.replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069<>]/gu, " ").slice(0, 100);
        const slot = String(index + 1);
        const id = (metric: string) => `subject.${metric}.${slot}`;
        const activeDays = getFact(facts, id("active_days.30d"))?.value;
        const focusSeconds = getFact(facts, id("focus_seconds.30d"))?.value;
        const attempts = getFact(facts, id("objective_attempts.30d"))?.value;
        const accuracy = getFact(facts, id("objective_accuracy.30d"))?.value;
        const dueReviews = getFact(facts, id("due_reviews.current"))?.value;
        return en
          ? `${safeName}: last-30-day active study days ${textValue(activeDays, locale)}, verified Focus seconds ${textValue(focusSeconds, locale)}, objective attempts ${textValue(attempts, locale)}, objective accuracy ${rate(accuracy)}, current due reviews ${textValue(dueReviews, locale)}`
          : `${safeName}: أيام الدراسة النشطة في آخر 30 يوماً ${textValue(activeDays, locale)}، ثواني تركيز موثقة ${textValue(focusSeconds, locale)}، محاولات موضوعية ${textValue(attempts, locale)}، دقة الأسئلة الموضوعية ${rate(accuracy)}، مراجعات مستحقة حالياً ${textValue(dueReviews, locale)}`;
      });
      const notRanked = facts.limitations.some((limitation) =>
        limitation.startsWith("No composite best-or-worst subject score"),
      );
      const prefix = notRanked
        ? en
          ? "The app does not calculate a single best or worst subject score. "
          : "لا يحسب التطبيق درجة واحدة لتحديد أفضل مادة أو أسوأها. "
        : "";
      return rows.length
        ? `${prefix}${en ? "Recorded per-subject facts: " : "الحقائق المسجّلة لكل مادة: "}${rows.join("; ")}.`
        : en
          ? "There are no available per-subject facts for this period."
          : "لا تتوفر حقائق حسب المادة لهذه الفترة.";
    }
    default:
      return null;
  }
}

export function buildAskStudyDataDeterministicAnswer(
  facts: AskStudyDataFactSetV1,
  locale: AskStudyDataLocale,
): AskStudyDataAnswerV1 {
  const exact = directAnswer(facts, locale);
  let answer = exact;
  if (!answer) {
    const values = facts.facts
      .filter((fact) => fact.value !== null)
      .slice(0, 5)
      .map((fact) => `${fact.id}: ${String(fact.value)}`);
    if (locale === "en") {
      answer = values.length
        ? `I can report these measured facts for ${localizedWindow(facts.window, locale)}: ${values.join(", ")}. They describe recorded study activity only; they do not establish causation, ability, or exam outcomes.`
        : `There is not enough available study data to answer this reliably for ${localizedWindow(facts.window, locale)}.`;
    } else {
      answer = values.length
        ? `هذه الحقائق المسجّلة عن دراستك خلال ${localizedWindow(facts.window, locale)}: ${values.join("، ")}. تصف هذه البيانات النشاط المسجّل فقط، ولا تثبت علاقة سببية أو قدرة شخصية أو نتيجة امتحان.`
        : `لا تتوفر بيانات دراسة كافية للإجابة بثقة عن ${localizedWindow(facts.window, locale)}.`;
    }
  }
  return {
    version: "ask-study-data-v1",
    locale,
    intent: facts.intent,
    answer,
    evidence: evidenceFor(facts),
    limitations: facts.limitations.slice(0, 5),
  };
}

export function isDirectAskStudyDataQuestion(
  facts: AskStudyDataFactSetV1,
  locale: AskStudyDataLocale,
): boolean {
  return directAnswer(facts, locale) !== null;
}