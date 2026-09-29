import { useState, type FormEvent } from "react";
import { ArrowUpRight, LoaderCircle, MessageCircleQuestion } from "lucide-react";
import type { AskMyStudyDataResponse } from "../../../../server/features/ask-study-data/types";
import type { Language } from "../../../core/i18n/translations";
import { askMyStudyData } from "../api";

const QUICK_QUESTIONS = [
  ["What should I review?", "ما الذي ينبغي أن أراجعه؟"],
  ["How is my MCQ performance changing?", "كيف يتغير أدائي في أسئلة الاختيار من متعدد؟"],
  ["What does my Focus data show?", "ماذا تُظهر بيانات جلسات التركيز؟"],
] as const;

function copy(language: Language, english: string, arabic: string): string {
  return language === "ar" ? arabic : english;
}

export function AskMyStudyDataPanel({ language }: { language: Language }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskMyStudyDataResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const rtl = language === "ar";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedQuestion = question.trim();
    if (normalizedQuestion.length < 2 || submitting) return;
    setSubmitting(true);
    setFailed(false);
    setResult(null);
    try {
      setResult(await askMyStudyData(normalizedQuestion, language));
    } catch {
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  }

  function chooseQuestion(value: string) {
    setQuestion(value);
    setResult(null);
    setFailed(false);
  }

  return (
    <section
      aria-labelledby="ask-study-data-title"
      dir={rtl ? "rtl" : "ltr"}
      className="rounded-3xl border border-sky-200/80 bg-sky-50/70 p-4 dark:border-sky-300/15 dark:bg-sky-300/[0.06] sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-700 text-white">
          <MessageCircleQuestion className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="ask-study-data-title" className="text-base font-semibold text-slate-950 dark:text-white">
            {copy(language, "Ask about my study data", "اسأل عن بيانات دراستي")}
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {copy(language, "Ask one question about your recorded study activity.", "اكتب سؤالًا واحدًا عن نشاطك الدراسي المسجّل.")}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" aria-label={copy(language, "Suggested questions", "أسئلة مقترحة")}>
        {QUICK_QUESTIONS.map(([english, arabic]) => (
          <button
            key={english}
            type="button"
            onClick={() => chooseQuestion(rtl ? arabic : english)}
            className="min-h-11 rounded-full border border-sky-200 bg-white px-3 py-2 text-start text-xs font-medium text-sky-950 transition hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-700 dark:border-sky-200/15 dark:bg-slate-950/60 dark:text-sky-100 dark:hover:bg-sky-300/10"
          >
            {rtl ? arabic : english}
          </button>
        ))}
      </div>

      <form className="mt-4 space-y-3" onSubmit={submit}>
        <label htmlFor="ask-study-data-question" className="sr-only">
          {copy(language, "Your question", "سؤالك")}
        </label>
        <textarea
          id="ask-study-data-question"
          value={question}
          onChange={(event) => {
            setQuestion(event.target.value);
            setResult(null);
            setFailed(false);
          }}
          maxLength={500}
          rows={3}
          dir={rtl ? "rtl" : "ltr"}
          placeholder={copy(language, "Type a question about your study data…", "اكتب سؤالًا عن بيانات دراستك…")}
          className="min-h-24 w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-start text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 dark:border-white/10 dark:bg-slate-950/70 dark:text-white dark:placeholder:text-slate-500"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {copy(language, "One question at a time · maximum 500 characters", "سؤال واحد في كل مرة · ٥٠٠ حرف كحد أقصى")}
          </span>
          <button
            type="submit"
            disabled={submitting || question.trim().length < 2}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55 dark:bg-sky-600 dark:hover:bg-sky-500"
          >
            {submitting ? (
              <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <ArrowUpRight className={`h-4 w-4 ${rtl ? "rotate-180" : ""}`} aria-hidden="true" />
            )}
            {submitting
              ? copy(language, "Checking…", "جارٍ التحقق…")
              : copy(language, "Ask", "اسأل")}
          </button>
        </div>
      </form>

      <div className="mt-4" aria-live="polite" aria-atomic="true">
        {failed && (
          <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-900 dark:border-rose-300/20 dark:bg-rose-300/10 dark:text-rose-100">
            {copy(language, "Your question could not be answered right now. Try again in a moment.", "تعذّرت الإجابة عن سؤالك الآن. حاول مرة أخرى بعد قليل.")}
          </p>
        )}
        {result?.status === "ANSWERED" && (
          <div className="rounded-2xl border border-sky-200 bg-white/90 p-4 dark:border-sky-200/15 dark:bg-slate-950/60">
            <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-800 dark:text-slate-100">
              {result.answer}
            </p>
            {result.limitations.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-xs leading-5 text-slate-500 dark:border-white/10 dark:text-slate-400">
                {result.limitations.map((limitation, index) => (
                  <li key={`${index}-${limitation}`} className="break-words">{limitation}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {result?.status === "NEEDS_CLARIFICATION" && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950 dark:border-amber-200/15 dark:bg-amber-300/[0.08] dark:text-amber-100">
            <p>{result.reason}</p>
            {result.candidates && result.candidates.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {result.candidates.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    onClick={() => chooseQuestion(candidate)}
                    className="min-h-11 rounded-full border border-amber-300/70 bg-white/80 px-3 py-2 text-start text-xs font-medium hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 dark:border-amber-200/20 dark:bg-slate-950/50 dark:hover:bg-amber-300/10"
                  >
                    {candidate}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {result?.status === "UNSUPPORTED" && (
          <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 text-sm leading-6 text-slate-700 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-200">
            <p>{result.reason}</p>
            {result.supportedExamples.length > 0 && (
              <ul className="mt-2 list-inside list-disc space-y-1">
                {result.supportedExamples.map((example) => <li key={example}>{example}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}