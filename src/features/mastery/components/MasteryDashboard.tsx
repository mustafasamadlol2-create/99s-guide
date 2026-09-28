import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RefreshCw } from "lucide-react";
import type { Language } from "../../../core/i18n/translations";
import {
  masteryApi,
  type CanonicalReview,
  type MasteryLectureRow,
  type MasteryState,
  type MasterySummary,
} from "../api";

export interface MasteryDashboardProps {
  language?: Language;
  subjects: Array<{ id: string; name?: string }>;
  dbLectures?: any[];
  onBack: () => void;
  onSelectLecture: (lecture: any, tab?: "mcqs" | "flashcards" | "pdf") => void;
}

const states: MasteryState[] = ["NOT_STARTED", "STARTED", "LEARNING", "NEEDS_REVIEW", "GOOD", "MASTERED"];
const stateLabels: Record<string, [string, string]> = {
  NOT_STARTED: ["Not started", "لم تبدأ"], STARTED: ["Started", "بدأت"], LEARNING: ["Learning", "قيد التعلم"],
  NEEDS_REVIEW: ["Needs review", "تحتاج إلى مراجعة"], GOOD: ["Good", "جيدة"], MASTERED: ["Strong evidence so far", "أدلة قوية حتى الآن"],
};
const reviewLabels: Record<string, [string, string]> = {
  DUE: ["Due", "حان وقت المراجعة"], OVERDUE: ["Overdue", "متأخرة"],
  DUE_SOON: ["Due soon", "قريبًا"], FRESH: ["Up to date", "محدّثة"],
  INSUFFICIENT_EVIDENCE: ["Not enough evidence", "أدلة غير كافية"],
};
const totalKeys: Record<MasteryState, string> = {
  NOT_STARTED: "notStarted", STARTED: "started", LEARNING: "learning",
  NEEDS_REVIEW: "needsReview", GOOD: "good", MASTERED: "mastered",
};
const text = (value: string | undefined, language: Language, table: Record<string, [string, string]>) =>
  table[value ?? ""]?.[language === "ar" ? 1 : 0] ?? value ?? "—";
const dateText = (value: string | null | undefined, language: Language) => {
  if (!value) return language === "ar" ? "لا يوجد موعد" : "No date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? (language === "ar" ? "لا يوجد موعد" : "No date") :
    date.toLocaleDateString(language === "ar" ? "ar-IQ-u-nu-latn" : "en-US", { day: "numeric", month: "short", year: "numeric" });
};
const lectureSubjectId = (lecture: any): string | undefined =>
  lecture?.subjectId ?? lecture?.mainSubject?.id ?? lecture?.subject?.id;
const lectureTitle = (lecture: any, id: string) => lecture?.title ?? lecture?.name ?? id;
const hasSurface = (lecture: any, key: "mcqs" | "flashcards") =>
  Array.isArray(lecture?.[key]) ? lecture[key].length > 0 :
    Array.isArray(lecture?.materials?.[key]) ? lecture.materials[key].length > 0 : Boolean(lecture?.[`${key}Count`]);

export function MasteryDashboard({ language = "en", subjects, dbLectures = [], onBack, onSelectLecture }: MasteryDashboardProps) {
  const rtl = language === "ar";
  const [summary, setSummary] = useState<MasterySummary | null>(null);
  const [reviews, setReviews] = useState<CanonicalReview[]>([]);
  const [reviewCursor, setReviewCursor] = useState<string | null>(null);
  const [rows, setRows] = useState<MasteryLectureRow[]>([]);
  const [rowCursor, setRowCursor] = useState<string | null>(null);
  const [tab, setTab] = useState<"reviews" | "lectures">("reviews");
  const [subject, setSubject] = useState("");
  const [state, setState] = useState("");
  const [reviewState, setReviewState] = useState("");
  const [search, setSearch] = useState("");
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const [reviewsError, setReviewsError] = useState(false);
  const [rowsError, setRowsError] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const summaryRequest = useRef(0);
  const reviewRequest = useRef(0);
  const reviewCursorRef = useRef<string | null>(null);
  const rowRequest = useRef(0);
  const lectureById = useMemo(() => new Map(dbLectures.map((lecture) => [String(lecture.id), lecture])), [dbLectures]);
  const subjectName = useMemo(() => new Map(subjects.map((item) => [item.id, item.name ?? item.id])), [subjects]);
  const getLecture = useCallback((id: string) => lectureById.get(id) ?? { id }, [lectureById]);

  const loadSummary = useCallback(async () => {
    const request = ++summaryRequest.current;
    setLoadingSummary(true); setSummaryError(false);
    try {
      const value = await masteryApi.summary();
      if (summaryRequest.current === request) setSummary(value);
    } catch { if (summaryRequest.current === request) setSummaryError(true); }
    finally { if (summaryRequest.current === request) setLoadingSummary(false); }
  }, []);
  const loadReviews = useCallback(async (append = false) => {
    const request = ++reviewRequest.current;
    if (append) setLoadingMore(true); else { setLoadingReviews(true); setReviewsError(false); }
    try {
      const page = await masteryApi.reviews(append ? reviewCursorRef.current : null);
      if (reviewRequest.current === request) {
        setReviews((old) => append ? [...old, ...(page.items ?? [])] : (page.items ?? []));
        setReviewCursor(page.nextCursor ?? null);
        reviewCursorRef.current = page.nextCursor ?? null;
      }
    } catch { if (reviewRequest.current === request) setReviewsError(true); }
    finally {
      if (reviewRequest.current === request) { setLoadingReviews(false); setLoadingMore(false); }
    }
  }, []);
  const loadRows = useCallback(async (append = false) => {
    const request = ++rowRequest.current;
    if (append) { setLoadingMore(true); setLoadMoreError(false); }
    else { setLoadingRows(true); setRowsError(false); setLoadMoreError(false); }
    try {
      let page = await masteryApi.lectures({ limit: 50, state, reviewState, subjectId: subject, cursor: append ? rowCursor : null });
      // A title search is local over lecture metadata, so load the bounded
      // cursor result completely before applying it. The server still owns
      // filtering and ordering; this only makes every loaded title searchable.
      if (!append && search.trim()) {
        const allRows = [...(page.rows ?? [])];
        let cursor = page.nextCursor ?? null;
        while (cursor && rowRequest.current === request) {
          const next = await masteryApi.lectures({ limit: 50, state, reviewState, subjectId: subject, cursor });
          allRows.push(...(next.rows ?? []));
          cursor = next.nextCursor ?? null;
        }
        page = { rows: allRows, nextCursor: cursor };
      }
      if (rowRequest.current === request) {
        setRows((old) => append ? [...old, ...(page.rows ?? [])] : (page.rows ?? []));
        setRowCursor(page.nextCursor ?? null);
      }
    } catch {
      if (rowRequest.current === request) {
        if (append) setLoadMoreError(true);
        else setRowsError(true);
      }
    }
    finally {
      if (rowRequest.current === request) { setLoadingRows(false); setLoadingMore(false); }
    }
  }, [rowCursor, search, state, reviewState, subject]);
  const refreshAll = useCallback(() => {
    void loadSummary();
    void loadReviews(false);
    if (tab === "lectures" || summaryError) void loadRows(false);
  }, [loadSummary, loadReviews, loadRows, tab, summaryError]);

  useEffect(() => { void loadSummary(); void loadReviews(false); }, [loadSummary, loadReviews]);
  useEffect(() => {
    if (tab === "lectures") { setRows([]); setRowCursor(null); void loadRows(false); }
  }, [tab, state, reviewState, subject, search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const refresh = () => refreshAll();
    window.addEventListener("study:mastery-updated", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      summaryRequest.current += 1; reviewRequest.current += 1; rowRequest.current += 1;
      window.removeEventListener("study:mastery-updated", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refreshAll]);

  const titleFor = (id: string) => lectureTitle(getLecture(id), id);
  const filteredReviews = subject ? reviews.filter((item) => lectureSubjectId(getLecture(item.lectureId)) === subject) : reviews;
  const filteredRows = rows.filter((row) => !search.trim() || titleFor(row.lectureId).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const total = summary?.totals?.total ?? 0;
  const reviewHasMore = Boolean(reviewCursor);
  const rowHasMore = Boolean(rowCursor);

  return (
    <main dir={rtl ? "rtl" : "ltr"} className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><button type="button" onClick={onBack} className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10">{rtl ? <ArrowRight size={17} /> : <ArrowLeft size={17} />}{rtl ? "رجوع" : "Back"}</button><h1 className="text-2xl font-bold text-slate-950 dark:text-white">{rtl ? "إتقاني" : "My mastery"}</h1><p className="mt-1 text-sm text-slate-500">{rtl ? "مساحة خاصة لمتابعة المراجعة." : "A private view of your study review."}</p></div>
        <button type="button" onClick={refreshAll} aria-label={rtl ? "تحديث" : "Refresh"} className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/10"><RefreshCw size={16} />{rtl ? "تحديث" : "Refresh"}</button>
      </header>
      {loadingSummary && !summary ? <p className="mt-8 text-sm text-slate-500">{rtl ? "جارٍ تحميل الملخص…" : "Loading summary…"}</p> : summaryError && !summary ? <><ErrorMessage rtl={rtl} onRetry={loadSummary} /><SummaryFailureTabs reviews={reviews} reviewCursor={reviewCursor} rows={rows} rowCursor={rowCursor} loadingReviews={loadingReviews} loadingRows={loadingRows} loadingMore={loadingMore} loadMoreError={loadMoreError} reviewsError={reviewsError} rowsError={rowsError} filteredReviews={filteredReviews} filteredRows={filteredRows} rtl={rtl} language={language} titleFor={titleFor} getLecture={getLecture} subjectName={subjectName} onRetryReviews={() => loadReviews(false)} onRetryRows={() => loadRows(false)} onSelectLecture={onSelectLecture} loadRows={() => loadRows(false)} onLoadMore={() => loadRows(true)} onLoadMoreReviews={() => loadReviews(true)} /></> : summary ? (
        <>
          {summary.sourceFreshness?.stale ? <p role="status" className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{rtl ? "جارٍ تحديث بيانات الإتقان…" : "Mastery data is updating…"}</p> : null}
          {summaryError ? <p role="status" className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{rtl ? "تعذر تحديث الملخص؛ تُعرض آخر بيانات تم تحميلها." : "Couldn’t refresh the summary; showing the last loaded data."}</p> : null}
          <section aria-label={rtl ? "توزيع الإتقان" : "Mastery distribution"} className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{states.map((item) => <div key={item} className="rounded-2xl border bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.04]"><p className="text-xs text-slate-500">{text(item, language, stateLabels)}</p><p className="mt-2 text-2xl font-bold">{summary.totals?.[totalKeys[item]] ?? summary.totals?.[item] ?? 0}</p></div>)}</section>
          <div className="mt-4 flex flex-wrap gap-3 text-sm"><span className="rounded-full bg-slate-100 px-3 py-1.5 dark:bg-white/10">{rtl ? "للمراجعة" : "Due"}: {summary.dueReviewCount}</span><span className="rounded-full bg-rose-50 px-3 py-1.5 text-rose-700">{rtl ? "متأخرة" : "Overdue"}: {summary.overdueCount}</span><span className="text-slate-500">{total} {rtl ? "محاضرة متتبعة" : "tracked lectures"}</span></div>
          {summary.subjects?.length ? <section className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label={rtl ? "ملخص المواد" : "Subject summaries"}>{summary.subjects.map((item) => <div key={item.subjectId} className="rounded-xl border p-3 text-sm dark:border-white/10"><p className="font-semibold">{subjectName.get(item.subjectId) ?? item.subjectId}</p><p className="mt-1 text-slate-500">{item.trackedLectures} {rtl ? "محاضرات" : "lectures"} · {rtl ? "مستحقة" : "Due"} {item.review?.due ?? 0} · {rtl ? "متأخرة" : "Overdue"} {item.review?.overdue ?? 0}</p></div>)}</section> : null}
          <nav aria-label={rtl ? "أقسام الإتقان" : "Mastery sections"} className="mt-8 flex gap-2 border-b dark:border-white/10"><button type="button" onClick={() => setTab("reviews")} className={`min-h-11 border-b-2 px-3 text-sm font-semibold ${tab === "reviews" ? "border-slate-900 text-slate-900 dark:border-white dark:text-white" : "border-transparent text-slate-500"}`}>{rtl ? "المراجعات المستحقة" : "Due reviews"}</button><button type="button" onClick={() => setTab("lectures")} className={`min-h-11 border-b-2 px-3 text-sm font-semibold ${tab === "lectures" ? "border-slate-900 text-slate-900 dark:border-white dark:text-white" : "border-transparent text-slate-500"}`}>{rtl ? "كل المحاضرات" : "All lectures"}</button></nav>
          {tab === "reviews" ? <section aria-label={rtl ? "قائمة المراجعة" : "Review list"} className="mt-4 space-y-3"><div className="flex flex-wrap items-center gap-2"><label className="text-sm font-semibold" htmlFor="mastery-subject">{rtl ? "المادة" : "Subject"}</label><select id="mastery-subject" value={subject} onChange={(event) => setSubject(event.target.value)} className="min-h-11 rounded-xl border bg-transparent px-3 text-sm"><option value="">{rtl ? "كل المواد" : "All subjects"}</option>{subjects.map((item) => <option key={item.id} value={item.id}>{item.name ?? item.id}</option>)}</select></div>{loadingReviews && !reviews.length ? <p className="text-sm text-slate-500">{rtl ? "جارٍ تحميل المراجعات…" : "Loading reviews…"}</p> : reviewsError && !reviews.length ? <ErrorMessage rtl={rtl} onRetry={() => loadReviews(false)} /> : filteredReviews.length ? filteredReviews.map((item) => <ReviewRow key={item.lectureId} item={item} lecture={getLecture(item.lectureId)} title={titleFor(item.lectureId)} subject={subjectName.get(lectureSubjectId(getLecture(item.lectureId)) ?? "")} language={language} onSelectLecture={onSelectLecture} />) : <p className="rounded-2xl border p-5 text-sm text-slate-500">{rtl ? "لا توجد مراجعات مستحقة." : "No due reviews."}</p>}{reviewsError && reviews.length ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-rose-700"><span>{rtl ? "تعذر تحديث قائمة المراجعات." : "Couldn’t refresh the review list."}</span><button type="button" onClick={() => void loadReviews(false)} className="font-semibold underline">{rtl ? "إعادة المحاولة" : "Retry"}</button></div> : null}{reviewHasMore ? <button type="button" disabled={loadingMore} onClick={() => void loadReviews(true)} className="min-h-11 rounded-xl border px-4 text-sm font-semibold">{loadingMore ? "…" : rtl ? "تحميل المزيد" : "Load more"}</button> : null}</section> :
            <section className="mt-4 space-y-3"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><input aria-label={rtl ? "البحث في المحاضرات" : "Search lectures"} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={rtl ? "ابحث عن محاضرة" : "Search lecture titles"} className="min-h-11 rounded-xl border bg-transparent px-3 text-sm lg:col-span-2" /><FilterSelect label={rtl ? "المادة" : "Subject"} value={subject} onChange={setSubject} options={subjects.map((item) => [item.id, item.name ?? item.id])} language={language} /><FilterSelect label={rtl ? "حالة المراجعة" : "Review state"} value={reviewState} onChange={setReviewState} options={["INSUFFICIENT_EVIDENCE", "FRESH", "DUE_SOON", "DUE", "OVERDUE"].map((item) => [item, text(item, language, reviewLabels)])} language={language} /><FilterSelect label={rtl ? "حالة الإتقان" : "Mastery state"} value={state} onChange={setState} options={states.map((item) => [item, text(item, language, stateLabels)])} language={language} /></div>{loadingRows && !rows.length ? <p className="text-sm text-slate-500">{rtl ? "جارٍ تحميل المحاضرات…" : "Loading lectures…"}</p> : rowsError && !rows.length ? <ErrorMessage rtl={rtl} onRetry={() => loadRows(false)} /> : filteredRows.map((row) => <LectureRow key={row.lectureId} row={row} lecture={getLecture(row.lectureId)} title={titleFor(row.lectureId)} language={language} onSelectLecture={onSelectLecture} />)}{rowsError && rows.length ? <ErrorMessage rtl={rtl} onRetry={() => loadRows(false)} /> : null}{rowHasMore ? <button type="button" disabled={loadingMore} onClick={() => void loadRows(true)} className="min-h-11 rounded-xl border px-4 text-sm font-semibold">{loadingMore ? "…" : rtl ? "تحميل المزيد" : "Load more"}</button> : null}{loadMoreError ? <div className="flex flex-wrap items-center gap-3 text-sm text-rose-700"><span>{rtl ? "تعذر تحميل المزيد." : "Couldn’t load more lectures."}</span><button type="button" onClick={() => void loadRows(true)} className="font-semibold underline">{rtl ? "إعادة المحاولة" : "Retry"}</button></div> : null}</section>}
        </>
      ) : null}
    </main>
  );
}

function ErrorMessage({ rtl, onRetry }: { rtl: boolean; onRetry: () => void }) {
  return <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><p>{rtl ? "تعذر تحميل هذه البيانات." : "This data could not be loaded."}</p><button type="button" onClick={onRetry} className="mt-2 font-semibold underline">{rtl ? "إعادة المحاولة" : "Retry"}</button></div>;
}
function ReviewQueueFallback({
  reviews,
  reviewCursor,
  loading,
  loadingMore,
  error,
  filteredReviews,
  rtl,
  language,
  titleFor,
  getLecture,
  subjectName,
  onRetry,
  onLoadMore,
  onSelectLecture,
}: any) {
  return (
    <section aria-label={rtl ? "قائمة المراجعة" : "Review list"} className="mt-4 space-y-3">
      <h2 className="text-lg font-semibold">{rtl ? "المراجعات المستحقة" : "Due reviews"}</h2>
      {loading && !reviews.length ? (
        <p className="text-sm text-slate-500">{rtl ? "جارٍ تحميل المراجعات…" : "Loading reviews…"}</p>
      ) : error && !reviews.length ? (
        <ErrorMessage rtl={rtl} onRetry={onRetry} />
      ) : filteredReviews.length ? (
        filteredReviews.map((item: CanonicalReview) => (
          <ReviewRow
            key={item.lectureId}
            item={item}
            lecture={getLecture(item.lectureId)}
            title={titleFor(item.lectureId)}
            subject={subjectName.get(lectureSubjectId(getLecture(item.lectureId)) ?? "")}
            language={language}
            onSelectLecture={onSelectLecture}
          />
        ))
      ) : (
        <p className="rounded-2xl border p-5 text-sm text-slate-500">
          {rtl ? "لا توجد مراجعات مستحقة." : "No due reviews."}
        </p>
      )}
      {error && reviews.length > 0 ? (
        <div className="flex items-center gap-3 text-sm text-rose-700">
          <span>{rtl ? "تعذر تحميل المزيد." : "Couldn’t load more reviews."}</span>
          <button type="button" onClick={onRetry} className="font-semibold underline">
            {rtl ? "إعادة المحاولة" : "Retry"}
          </button>
        </div>
      ) : null}
      {reviewCursor ? (
        <button
          type="button"
          disabled={loadingMore}
          onClick={onLoadMore}
          className="min-h-11 rounded-xl border px-4 text-sm font-semibold"
        >
          {loadingMore ? "…" : rtl ? "تحميل المزيد" : "Load more"}
        </button>
      ) : null}
    </section>
  );
}
function SummaryFailureTabs({ reviews, reviewCursor, rows, rowCursor, loadingReviews, loadingRows, loadingMore, loadMoreError, reviewsError, rowsError, filteredReviews, filteredRows, rtl, language, titleFor, getLecture, subjectName, onRetryReviews, onRetryRows, onSelectLecture, loadRows, onLoadMore, onLoadMoreReviews }: any) {
  const [tab, setTab] = useState<"reviews" | "lectures">("reviews");
  return <><nav aria-label={rtl ? "أقسام الإتقان" : "Mastery sections"} className="mt-6 flex gap-2 border-b dark:border-white/10"><button type="button" onClick={() => setTab("reviews")} className="min-h-11 border-b-2 border-slate-900 px-3 text-sm font-semibold">{rtl ? "المراجعات المستحقة" : "Due reviews"}</button><button type="button" onClick={() => { setTab("lectures"); void loadRows(); }} className="min-h-11 border-b-2 border-transparent px-3 text-sm font-semibold text-slate-500">{rtl ? "كل المحاضرات" : "All lectures"}</button></nav>{tab === "reviews" ? <ReviewQueueFallback reviews={reviews} reviewCursor={reviewCursor} loadingMore={loadingMore} error={reviewsError} filteredReviews={filteredReviews} rtl={rtl} language={language} titleFor={titleFor} getLecture={getLecture} subjectName={subjectName} onRetry={onRetryReviews} onLoadMore={onLoadMoreReviews} onSelectLecture={onSelectLecture} /> : <section className="mt-4 space-y-3">{loadingRows && !rows.length ? <p className="text-sm text-slate-500">{rtl ? "جارٍ تحميل المحاضرات…" : "Loading lectures…"}</p> : rowsError && !rows.length ? <ErrorMessage rtl={rtl} onRetry={onRetryRows} /> : filteredRows.map((row: MasteryLectureRow) => <LectureRow key={row.lectureId} row={row} lecture={getLecture(row.lectureId)} title={titleFor(row.lectureId)} language={language} onSelectLecture={onSelectLecture} />)}{rowsError && rows.length ? <ErrorMessage rtl={rtl} onRetry={onRetryRows} /> : null}{rowCursor ? <button type="button" disabled={loadingMore} onClick={onLoadMore} className="min-h-11 rounded-xl border px-4 text-sm font-semibold">{loadingMore ? "…" : rtl ? "تحميل المزيد" : "Load more"}</button> : null}{loadMoreError ? <div className="flex flex-wrap items-center gap-3 text-sm text-rose-700"><span>{rtl ? "تعذر تحميل المزيد." : "Couldn’t load more lectures."}</span><button type="button" disabled={loadingMore} onClick={onLoadMore} className="font-semibold underline">{rtl ? "إعادة المحاولة" : "Retry"}</button></div> : null}</section>}</>;
}
function FilterSelect({ label, value, onChange, options, language }: { label: string; value: string; onChange: (value: string) => void; options: string[][]; language: Language }) {
  return <label className="text-xs font-semibold text-slate-500">{label}<select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 block min-h-11 w-full rounded-xl border bg-transparent px-3 text-sm font-normal"><option value="">{language === "ar" ? "الكل" : "All"}</option>{options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>;
}
function actionButtons(lecture: any, language: Language, onSelectLecture: MasteryDashboardProps["onSelectLecture"]) {
  const rtl = language === "ar";
  const hasCanonicalLecture = Boolean(lecture?.id && lecture?.subjectId);
  return hasCanonicalLecture
    ? <div className="flex flex-wrap gap-2"><button type="button" onClick={() => onSelectLecture(lecture, "pdf")} className="min-h-11 rounded-xl border px-3 text-sm font-semibold">{rtl ? "فتح المحاضرة" : "Open lecture"}</button>{hasSurface(lecture, "mcqs") ? <button type="button" onClick={() => onSelectLecture(lecture, "mcqs")} className="min-h-11 rounded-xl border px-3 text-sm font-semibold">{rtl ? "أسئلة MCQ" : "MCQ"}</button> : null}{hasSurface(lecture, "flashcards") ? <button type="button" onClick={() => onSelectLecture(lecture, "flashcards")} className="min-h-11 rounded-xl border px-3 text-sm font-semibold">{rtl ? "بطاقات" : "Flashcards"}</button> : null}</div>
    : <span className="text-xs text-slate-500">{rtl ? "المحاضرة غير متاحة" : "Lecture unavailable"}</span>;
}
function ReviewRow({ item, lecture, title, subject, language, onSelectLecture }: { item: CanonicalReview; lecture: any; title: string; subject?: string; language: Language; onSelectLecture: MasteryDashboardProps["onSelectLecture"] }) {
  return <article className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.04]"><div className="min-w-0"><h2 dir="auto" className="truncate font-semibold">{title}</h2><p className="mt-1 text-sm text-slate-500">{subject ?? ""} · {text(item.reviewState, language, reviewLabels)} · {dateText(item.nextReviewAt, language)}</p></div>{actionButtons(lecture, language, onSelectLecture)}</article>;
}
function LectureRow({ row, lecture, title, language, onSelectLecture }: { row: MasteryLectureRow; lecture: any; title: string; language: Language; onSelectLecture: MasteryDashboardProps["onSelectLecture"] }) {
  return <article className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.04]"><div className="min-w-0"><h2 dir="auto" className="truncate font-semibold">{title}</h2><p className="mt-1 text-sm text-slate-500">{text(row.masteryState, language, stateLabels)} · {text(row.reviewState, language, reviewLabels)} · {dateText(row.nextReviewAt, language)}</p></div>{actionButtons(lecture, language, onSelectLecture)}</article>;
}