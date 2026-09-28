import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "../../../core/api/apiClient";
import type { Language } from "../../../core/i18n/translations";

type RecallItemType = "MCQ" | "FLASHCARD";
type McqOptionKey = "A" | "B" | "C" | "D";
type RecallStatus =
  | "PRESENTED"
  | "ANSWERED"
  | "SKIPPED"
  | "EXPIRED"
  | "NOT_DUE"
  | "DAILY_LIMIT_REACHED"
  | "WEEKLY_LIMIT_REACHED"
  | "NO_CANDIDATE"
  | "ACTIVE_ATTEMPT"
  | "AVAILABLE";

interface RecallOption {
  key: McqOptionKey;
  text: string;
}

interface RecallPresentation {
  attemptId: string;
  status: RecallStatus;
  itemType: RecallItemType;
  lectureId: string;
  lectureTitle: string | null;
  expiresAt: string;
  item:
    | { id: string; question: string; options: RecallOption[] }
    | { id: string; front: string; back: string };
}

interface RecallTransition {
  attemptId: string;
  itemType?: RecallItemType;
  status: RecallStatus;
  outcome:
    | "CORRECT"
    | "INCORRECT"
    | "SELF_REPORTED_HARD"
    | "SELF_REPORTED_MEDIUM"
    | "SELF_REPORTED_EASY"
    | "SKIPPED"
    | "EXPIRED"
    | null;
  reward?: { awarded: boolean; points: number };
}

const isArabic = (language?: Language) => String(language ?? "en").toLowerCase().startsWith("ar");
const copy = (language: Language | undefined, en: string, ar: string) => isArabic(language) ? ar : en;
const noCache = { cache: "no-store" as RequestCache, bypassCache: true, ttl: 0, silent: true };

function safeDate(value: string | null | undefined, language?: Language): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(isArabic(language) ? "ar-IQ" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function resultMessage(result: RecallTransition, itemType: RecallItemType, language?: Language): string {
  if (result.status === "SKIPPED" || result.outcome === "SKIPPED") {
    return copy(language, "Skipped. You can try another time.", "تم التخطي. يمكنك المحاولة لاحقًا.");
  }
  if (result.status === "EXPIRED" || result.outcome === "EXPIRED") {
    return copy(language, "This Recall item is no longer active.", "لم تعد بطاقة الاسترجاع هذه نشطة.");
  }
  if (itemType === "MCQ") {
    if (result.outcome === "CORRECT") return copy(language, "Correct.", "إجابة صحيحة.");
    if (result.outcome === "INCORRECT") return copy(language, "Not quite. Review the material when you're ready.", "ليست الإجابة الصحيحة. راجع المادة عندما تكون مستعدًا.");
    return copy(language, "Your answer was recorded.", "تم تسجيل إجابتك.");
  }
  switch (result.outcome) {
    case "SELF_REPORTED_HARD":
      return copy(language, "Marked for more review.", "تم تحديدها لمراجعة إضافية.");
    case "SELF_REPORTED_MEDIUM":
      return copy(language, "Marked as partly remembered.", "تم تحديدها على أنها متذكّرة جزئيًا.");
    case "SELF_REPORTED_EASY":
      return copy(language, "Marked as felt easy.", "تم تحديدها على أنها سهلة.");
    default:
      return copy(language, "Your check-in was recorded.", "تم تسجيل تقييمك.");
  }
}

export function RecallEntryCard({
  language,
  isActive = true,
}: {
  language?: Language;
  isActive?: boolean;
}) {
  const rtl = isArabic(language);
  const [isOpen, setIsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [availability, setAvailability] = useState<{ status: RecallStatus; nextEligibleAt?: string } | null>(null);
  const [eligibility, setEligibility] = useState<{ status: RecallStatus; nextEligibleAt?: string } | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [eligibilityError, setEligibilityError] = useState(false);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [interactionToken, setInteractionToken] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<RecallPresentation | null>(null);
  const [terminal, setTerminal] = useState<RecallTransition | null>(null);
  const [selectedOption, setSelectedOption] = useState<McqOptionKey | null>(null);
  const [revealed, setRevealed] = useState(false);
  const launchButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const eligibilityRequest = useRef(0);
  const transitionInFlight = useRef(false);

  const refreshEligibility = useCallback(async (showInDialog = false) => {
    const request = ++eligibilityRequest.current;
    setEligibilityLoading(true);
    setEligibilityError(false);
    if (showInDialog) setAvailability(null);
    try {
      const response = await apiClient("/api/recall/eligibility", {
        method: "GET",
        ...noCache,
      });
      const result = await response.json() as { status: RecallStatus; nextEligibleAt?: string };
      if (
        !["AVAILABLE", "ACTIVE_ATTEMPT", "NOT_DUE", "DAILY_LIMIT_REACHED", "WEEKLY_LIMIT_REACHED", "NO_CANDIDATE"].includes(result.status)
      ) throw new Error("Recall eligibility response was invalid.");
      if (eligibilityRequest.current === request) {
        setEligibility(result);
        if (showInDialog) setAvailability(result);
      }
    } catch {
      if (eligibilityRequest.current === request) setEligibilityError(true);
    } finally {
      if (eligibilityRequest.current === request) setEligibilityLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    const refreshOnForeground = () => {
      if (document.visibilityState === "visible") void refreshEligibility();
    };
    void refreshEligibility();
    window.addEventListener("focus", refreshOnForeground);
    document.addEventListener("visibilitychange", refreshOnForeground);
    window.addEventListener("study:mastery-updated", refreshOnForeground);
    return () => {
      eligibilityRequest.current += 1;
      window.removeEventListener("focus", refreshOnForeground);
      document.removeEventListener("visibilitychange", refreshOnForeground);
      window.removeEventListener("study:mastery-updated", refreshOnForeground);
    };
  }, [isActive, refreshEligibility]);

  const loadPresentation = async (id: string) => {
    setBusy(true);
    setLoadError(false);
    try {
      const response = await apiClient(`/api/recall/attempts/${encodeURIComponent(id)}`, {
        method: "GET",
        ...noCache,
      });
      const payload = await response.json() as RecallPresentation | RecallTransition;
      if (payload.status !== "PRESENTED") {
        setPresentation(null);
        setTerminal(payload as RecallTransition);
        return;
      }
      const item = (payload as RecallPresentation).item;
      if (
        !item ||
        (payload as RecallPresentation).itemType === "MCQ" &&
          (!("question" in item) || !Array.isArray(item.options)) ||
        (payload as RecallPresentation).itemType === "FLASHCARD" &&
          (!("front" in item) || !("back" in item))
      ) {
        throw new Error("Recall presentation was incomplete.");
      }
      setPresentation(payload as RecallPresentation);
      setTerminal(null);
      setSelectedOption(null);
      setRevealed(false);
    } catch {
      setLoadError(true);
    } finally {
      setBusy(false);
    }
  };

  const requestNext = async () => {
    setBusy(true);
    setLoadError(false);
    setSubmitError(false);
    setAvailability(null);
    setPresentation(null);
    setTerminal(null);
    setAttemptId(null);
    setInteractionToken(null);
    setSelectedOption(null);
    setRevealed(false);
    try {
      const response = await apiClient("/api/recall/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        ...noCache,
      });
      const payload = await response.json() as {
        status: RecallStatus;
        nextEligibleAt?: string;
        attempt?: { id: string };
        interactionToken?: string;
      };
      if (payload.status !== "AVAILABLE" && payload.status !== "ACTIVE_ATTEMPT") {
        setAvailability({ status: payload.status, nextEligibleAt: payload.nextEligibleAt });
        setEligibility({ status: payload.status, nextEligibleAt: payload.nextEligibleAt });
        return;
      }
      if (!payload.attempt?.id || !payload.interactionToken) {
        throw new Error("Recall attempt details were incomplete.");
      }
      setAttemptId(payload.attempt.id);
      setInteractionToken(payload.interactionToken);
      setBusy(false);
      await loadPresentation(payload.attempt.id);
    } catch {
      setLoadError(true);
    } finally {
      setBusy(false);
    }
  };

  const openRecall = () => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : launchButtonRef.current;
    setIsOpen(true);
    if (terminal) {
      setTerminal(null);
      setPresentation(null);
      setAttemptId(null);
      setInteractionToken(null);
      setAvailability(null);
      setLoadError(false);
      setSubmitError(false);
      void refreshEligibility(true);
      return;
    }
    if (presentation && interactionToken) return;
    if (attemptId && interactionToken && !terminal) {
      void loadPresentation(attemptId);
      return;
    }
    if (eligibilityError) {
      void refreshEligibility(true);
      return;
    }
    if (eligibility?.status === "AVAILABLE" || eligibility?.status === "ACTIVE_ATTEMPT") {
      void requestNext();
      return;
    }
    if (eligibility) {
      setAvailability(eligibility);
      return;
    }
    void refreshEligibility(true);
  };

  const closeRecall = () => setIsOpen(false);

  useEffect(() => {
    if (!isOpen) {
      returnFocusRef.current?.focus();
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setIsOpen(false);
      if (event.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, busy]);

  const submitAnswer = async (answer: { selectedOption: McqOptionKey } | { rating: "hard" | "medium" | "easy" }) => {
    if (!attemptId || !interactionToken || !presentation || busy || terminal || transitionInFlight.current) return;
    transitionInFlight.current = true;
    setBusy(true);
    setSubmitError(false);
    try {
      const response = await apiClient(`/api/recall/attempts/${encodeURIComponent(attemptId)}/answer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Recall-Interaction-Token": interactionToken,
        },
        body: JSON.stringify(answer),
        ...noCache,
      });
      const result = await response.json() as RecallTransition;
      setTerminal(result);
      window.dispatchEvent(new Event("study:mastery-updated"));
    } catch {
      setSubmitError(true);
    } finally {
      transitionInFlight.current = false;
      setBusy(false);
    }
  };

  const skipAttempt = async () => {
    if (!attemptId || !interactionToken || busy || terminal || transitionInFlight.current) return;
    transitionInFlight.current = true;
    setBusy(true);
    setSubmitError(false);
    try {
      const response = await apiClient(`/api/recall/attempts/${encodeURIComponent(attemptId)}/skip`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Recall-Interaction-Token": interactionToken,
        },
        body: "{}",
        ...noCache,
      });
      const result = await response.json() as RecallTransition;
      setTerminal(result);
      window.dispatchEvent(new Event("study:mastery-updated"));
    } catch {
      setSubmitError(true);
    } finally {
      transitionInFlight.current = false;
      setBusy(false);
    }
  };

  const unavailableMessage = availability?.status === "NOT_DUE"
    ? copy(language, "Recall is resting for now.", "الاسترجاع غير متاح الآن.")
    : availability?.status === "DAILY_LIMIT_REACHED"
      ? copy(language, "You've reached today's Recall limit.", "وصلت إلى حد الاسترجاع اليومي.")
      : availability?.status === "WEEKLY_LIMIT_REACHED"
        ? copy(language, "You've reached this week's Recall limit.", "وصلت إلى حد الاسترجاع لهذا الأسبوع.")
        : availability?.status === "NO_CANDIDATE"
          ? copy(language, "No Recall item is available right now.", "لا توجد بطاقة استرجاع متاحة الآن.")
          : availability?.status === "ACTIVE_ATTEMPT"
            ? copy(language, "A Recall check is already in progress.", "هناك بطاقة استرجاع قيد المتابعة.")
            : availability?.status === "AVAILABLE"
              ? copy(language, "A Recall check is ready when you are.", "بطاقة الاسترجاع جاهزة عندما تكون مستعدًا.")
          : null;

  return (
    <>
      <section
        dir={rtl ? "rtl" : "ltr"}
        aria-labelledby="quick-recall-title"
        className="ios-staggered-card flex w-full flex-col gap-3 rounded-[22px] border border-indigo-200/70 bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-4 shadow-sm dark:border-indigo-300/15 dark:from-indigo-950/50 dark:via-slate-950 dark:to-violet-950/30 sm:flex-row sm:items-center sm:justify-between sm:p-5"
      >
        <div className="min-w-0">
          <h2 id="quick-recall-title" className="text-base font-semibold text-slate-950 dark:text-white">
            {copy(language, "Quick Recall", "استرجاع سريع")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            {copy(language, "Try one server-selected question or flashcard when you're ready.", "جرّب سؤالًا أو بطاقة يختارها الخادم عندما تكون مستعدًا.")}
          </p>
        </div>
        <button
          ref={launchButtonRef}
          type="button"
          onClick={openRecall}
          disabled={eligibilityLoading && !eligibility}
          className="min-h-12 shrink-0 rounded-xl bg-indigo-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        >
          {eligibilityLoading && !eligibility
            ? copy(language, "Checking…", "جارٍ التحقق…")
            : eligibilityError
              ? copy(language, "Retry status", "إعادة التحقق")
              : eligibility?.status === "AVAILABLE"
                ? copy(language, "Start Quick Recall", "ابدأ الاسترجاع السريع")
                : eligibility?.status === "ACTIVE_ATTEMPT"
                  ? copy(language, "Resume Recall", "متابعة الاسترجاع")
                  : presentation && !terminal
                    ? copy(language, "Continue Recall", "متابعة الاسترجاع")
                    : copy(language, "Check Recall", "تحقق من الاسترجاع")}
        </button>
      </section>

      {isOpen && (
        <div className="fixed inset-0 z-[100] flex min-h-dvh items-stretch justify-center bg-slate-950/65 sm:items-center sm:p-6">
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="recall-dialog-title"
            tabIndex={-1}
            dir={rtl ? "rtl" : "ltr"}
            className="flex h-[100dvh] w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-950 sm:h-auto sm:max-h-[min(88dvh,850px)] sm:rounded-3xl sm:border sm:border-white/15"
          >
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 dark:border-white/10 sm:px-6">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
                  {copy(language, "One item · no timer", "بطاقة واحدة · بلا مؤقّت")}
                </p>
                <h2 id="recall-dialog-title" className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">
                  {copy(language, "Quick Recall", "استرجاع سريع")}
                </h2>
                {presentation?.lectureTitle && (
                  <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">
                    {presentation.lectureTitle}
                  </p>
                )}
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeRecall}
                aria-label={copy(language, "Close Recall", "إغلاق الاسترجاع")}
                className="min-h-11 min-w-11 rounded-full border border-slate-300 px-3 text-xl leading-none text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 dark:border-white/20 dark:text-slate-100 dark:hover:bg-white/10"
              >
                ×
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
              {busy && (
                <div role="status" className="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-600 dark:bg-white/5 dark:text-slate-300">
                  {copy(language, "Loading your Recall item…", "جارٍ تحميل بطاقة الاسترجاع…")}
                </div>
              )}

              {!busy && loadError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-300/20 dark:bg-rose-950/30">
                  <p role="alert" className="text-sm font-medium text-rose-800 dark:text-rose-200">
                    {copy(language, "Couldn't load a Recall item. Try again.", "تعذّر تحميل بطاقة الاسترجاع. حاول مرة أخرى.")}
                  </p>
                  <button
                    type="button"
                    onClick={() => attemptId && interactionToken ? void loadPresentation(attemptId) : void requestNext()}
                    className="mt-4 min-h-11 rounded-xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 dark:border-rose-200/30 dark:text-rose-100 dark:hover:bg-rose-900/30"
                  >
                    {copy(language, "Retry", "إعادة المحاولة")}
                  </button>
                </div>
              )}

              {!busy && eligibilityLoading && !availability && !loadError && (
                <p role="status" className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-600 dark:bg-white/5 dark:text-slate-300">
                  {copy(language, "Checking Recall availability…", "جارٍ التحقق من إتاحة الاسترجاع…")}
                </p>
              )}

              {!busy && eligibilityError && !availability && !loadError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-300/20 dark:bg-rose-950/30">
                  <p role="alert" className="text-sm font-medium text-rose-800 dark:text-rose-200">
                    {copy(language, "Couldn't check Recall availability.", "تعذّر التحقق من إتاحة الاسترجاع.")}
                  </p>
                  <button
                    type="button"
                    onClick={() => void refreshEligibility(true)}
                    className="mt-4 min-h-11 rounded-xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 dark:border-rose-200/30 dark:text-rose-100 dark:hover:bg-rose-900/30"
                  >
                    {copy(language, "Retry", "إعادة المحاولة")}
                  </button>
                </div>
              )}

              {!busy && !loadError && availability && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-white/10 dark:bg-white/5">
                  <p className="text-base font-semibold text-slate-900 dark:text-white">
                    {unavailableMessage ?? copy(language, "Recall isn't available right now.", "الاسترجاع غير متاح الآن.")}
                  </p>
                  {availability.nextEligibleAt && (
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      {copy(language, "Check again after", "يمكنك التحقق مجددًا بعد")}{" "}
                      <time dateTime={availability.nextEligibleAt}>
                        {safeDate(availability.nextEligibleAt, language) ?? copy(language, "the next eligible time", "موعد الإتاحة التالي")}
                      </time>
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => availability.status === "AVAILABLE" || availability.status === "ACTIVE_ATTEMPT"
                      ? void requestNext()
                      : void refreshEligibility(true)}
                    className="mt-4 min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 dark:border-white/20 dark:text-white dark:hover:bg-white/10"
                  >
                    {availability.status === "AVAILABLE"
                      ? copy(language, "Start Quick Recall", "ابدأ الاسترجاع السريع")
                      : availability.status === "ACTIVE_ATTEMPT"
                        ? copy(language, "Resume Recall", "متابعة الاسترجاع")
                        : copy(language, "Check again", "تحقق مجددًا")}
                  </button>
                </div>
              )}

              {!busy && terminal && (
                <div
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  className={`rounded-2xl border p-5 ${
                    terminal.outcome === "CORRECT"
                      ? "border-emerald-200 bg-emerald-50 dark:border-emerald-300/20 dark:bg-emerald-950/30"
                      : "border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5"
                  }`}
                >
                  <p className="text-base font-semibold text-slate-900 dark:text-white">
                    {resultMessage(terminal, terminal.itemType ?? presentation?.itemType ?? "MCQ", language)}
                  </p>
                  {terminal.status === "ANSWERED" && terminal.reward?.awarded && terminal.reward.points > 0 && (
                    <p className="mt-2 text-sm font-medium text-indigo-800 dark:text-indigo-200">
                      {copy(language, `The server awarded ${terminal.reward.points} points.`, `منح الخادم ${terminal.reward.points} نقطة.`)}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={closeRecall}
                    className="mt-5 min-h-11 rounded-xl bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                  >
                    {copy(language, "Done", "تم")}
                  </button>
                </div>
              )}

              {!busy && !terminal && presentation?.itemType === "MCQ" && "question" in presentation.item && (
                <div dir="auto" className="space-y-5">
                  <fieldset className="space-y-3">
                    <legend className="mb-4 text-lg font-semibold leading-7 text-slate-950 dark:text-white">
                      {presentation.item.question}
                    </legend>
                    {presentation.item.options.map((option) => (
                      <label
                        key={option.key}
                        dir="auto"
                        className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-2xl border p-4 text-start text-sm leading-6 transition ${
                          selectedOption === option.key
                            ? "border-indigo-500 bg-indigo-50 dark:border-indigo-300 dark:bg-indigo-400/10"
                            : "border-slate-200 bg-white hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.07]"
                        }`}
                      >
                        <input
                          type="radio"
                          name={`recall-${presentation.attemptId}`}
                          value={option.key}
                          checked={selectedOption === option.key}
                          onChange={() => setSelectedOption(option.key)}
                          className="mt-1 h-4 w-4 shrink-0 accent-indigo-700"
                        />
                        <span className="min-w-0 text-slate-800 dark:text-slate-100">
                          <span className="me-2 font-semibold" dir="ltr">{option.key}.</span>
                          {option.text}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  {submitError && (
                    <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
                      {copy(language, "Couldn't submit that answer. Try again.", "تعذّر إرسال الإجابة. حاول مرة أخرى.")}
                    </p>
                  )}
                </div>
              )}

              {!busy && !terminal && presentation?.itemType === "FLASHCARD" && "front" in presentation.item && (
                <div className="space-y-4">
                  <article className="rounded-3xl border border-slate-200 bg-slate-50 p-5 dark:border-white/10 dark:bg-white/[0.04] sm:p-7">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {copy(language, "Front", "الوجه الأمامي")}
                    </p>
                    <div dir="auto" className="mt-3 whitespace-pre-wrap break-words text-lg font-semibold leading-8 text-slate-950 dark:text-white">
                      {presentation.item.front}
                    </div>
                    {revealed && (
                      <div className="mt-6 border-t border-slate-200 pt-5 dark:border-white/10">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {copy(language, "Back", "الوجه الخلفي")}
                        </p>
                        <div dir="auto" className="mt-3 whitespace-pre-wrap break-words text-base leading-7 text-slate-800 dark:text-slate-100">
                          {presentation.item.back}
                        </div>
                      </div>
                    )}
                  </article>
                  <button
                    type="button"
                    aria-expanded={revealed}
                    onClick={() => setRevealed((value) => !value)}
                    className="min-h-12 w-full rounded-xl border border-indigo-300 px-4 py-3 text-sm font-semibold text-indigo-800 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 dark:border-indigo-200/30 dark:text-indigo-200 dark:hover:bg-indigo-400/10"
                  >
                    {revealed
                      ? copy(language, "Hide answer", "إخفاء الإجابة")
                      : copy(language, "Reveal answer", "إظهار الإجابة")}
                  </button>
                  {revealed && (
                    <fieldset className="space-y-2">
                      <legend className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {copy(language, "How did recalling it feel?", "كيف كان تذكّرها؟")}
                      </legend>
                      {([
                        ["hard", copy(language, "Needs more review", "تحتاج إلى مراجعة إضافية")],
                        ["medium", copy(language, "Somewhat remembered", "تذكّرتها جزئيًا")],
                        ["easy", copy(language, "Felt easy", "كانت سهلة")],
                      ] as const).map(([rating, label]) => (
                        <button
                          key={rating}
                          type="button"
                          disabled={busy}
                          onClick={() => void submitAnswer({ rating })}
                          className="min-h-12 w-full rounded-xl border border-slate-300 px-4 py-3 text-start text-sm font-medium text-slate-800 hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-60 dark:border-white/15 dark:text-slate-100 dark:hover:bg-indigo-400/10"
                        >
                          {label}
                        </button>
                      ))}
                    </fieldset>
                  )}
                  {submitError && (
                    <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
                      {copy(language, "Couldn't submit that check-in. Try again.", "تعذّر إرسال التقييم. حاول مرة أخرى.")}
                    </p>
                  )}
                </div>
              )}
            </div>

            {!busy && !terminal && presentation && (
              <footer className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-200 bg-white/95 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur dark:border-white/10 dark:bg-slate-950/95 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <button
                  type="button"
                  onClick={() => void skipAttempt()}
                  disabled={busy}
                  className="min-h-12 rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 disabled:opacity-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5"
                >
                  {copy(language, "Skip", "تخطّي")}
                </button>
                {presentation.itemType === "MCQ" && (
                  <button
                    type="button"
                    disabled={!selectedOption || busy}
                    onClick={() => selectedOption && void submitAnswer({ selectedOption })}
                    className="min-h-12 rounded-xl bg-indigo-700 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                  >
                    {copy(language, "Submit answer", "إرسال الإجابة")}
                  </button>
                )}
              </footer>
            )}
          </section>
        </div>
      )}
    </>
  );
}