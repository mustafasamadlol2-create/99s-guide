import { LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import type { StudyInsightResponse } from "../../../../server/features/study-insights/types";
import type { Language } from "../../../core/i18n/translations";
import { copy, Panel } from "./StudyAnalyzerUi";

export function AiInsightCard({
  language,
  insight,
  loading,
  failed,
  onRefresh,
}: {
  language: Language;
  insight: StudyInsightResponse | null;
  loading: boolean;
  failed: boolean;
  onRefresh: () => void;
}) {
  const rtl = language === "ar";
  return (
    <Panel
      title={copy(language, "AI Study Insight", "رؤية الدراسة بالذكاء الاصطناعي")}
      subtitle={copy(language, "An explanation based on your recorded study data.", "تفسير مبني على بيانات دراستك المسجّلة.")}
      icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
      action={(
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/[0.05]"
        >
          {loading
            ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            : <RefreshCw className={`h-4 w-4 ${rtl ? "scale-x-[-1]" : ""}`} aria-hidden="true" />}
          <span>{loading ? copy(language, "Loading…", "جارٍ التحميل…") : copy(language, "Refresh insight", "تحديث الرؤية")}</span>
        </button>
      )}
    >
      <div aria-live="polite" aria-atomic="true">
        {loading && !insight && (
          <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
            {copy(language, "Loading the insight. Your deterministic study facts remain available below.", "جارٍ تحميل الرؤية. ستبقى حقائق دراستك المحددة متاحة في لوحة المعلومات.")}
          </p>
        )}
        {failed && !insight && (
          <p role="status" className="text-sm leading-6 text-slate-600 dark:text-slate-300">
            {copy(language, "AI insight is unavailable right now. Your study facts are still available.", "رؤية الذكاء الاصطناعي غير متاحة الآن. ما تزال حقائق دراستك متاحة.")}
          </p>
        )}
        {insight?.status === "READY" && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-violet-50/80 p-4 dark:bg-violet-300/[0.07]">
              <p className="break-words text-base font-semibold leading-7 text-violet-950 dark:text-violet-50">{insight.insight.headline}</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700 dark:text-slate-200">{insight.insight.summary}</p>
            </div>
            {insight.insight.observations.length > 0 && (
              <ul className="space-y-2">
                {insight.insight.observations.map((observation) => (
                  <li key={observation.id} className="rounded-2xl border border-slate-100 px-3 py-2.5 text-sm leading-6 text-slate-700 dark:border-white/[0.07] dark:text-slate-200">
                    <span className="break-words">{observation.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {insight.insight.reviewPriorities.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {copy(language, "Review priorities", "أولويات المراجعة")}
                </h3>
                <ul className="mt-2 space-y-2">
                  {insight.insight.reviewPriorities.map((priority, index) => (
                    <li key={`${index}-${priority.text}`} className="break-words text-sm leading-6 text-slate-700 dark:text-slate-200">
                      • {priority.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {insight.insight.studySuggestions.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {copy(language, "Study suggestions", "اقتراحات للدراسة")}
                </h3>
                <ul className="mt-2 space-y-2">
                  {insight.insight.studySuggestions.map((suggestion, index) => (
                    <li key={`${index}-${suggestion.text}`} className="break-words text-sm leading-6 text-slate-700 dark:text-slate-200">
                      • {suggestion.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {insight.insight.dataLimitations.length > 0 && (
              <div className="border-t border-slate-100 pt-3 dark:border-white/[0.07]">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {copy(language, "Data limitations", "حدود البيانات")}
                </p>
                <ul className="mt-1 space-y-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                  {insight.insight.dataLimitations.map((limitation, index) => (
                    <li key={`${index}-${limitation}`} className="break-words">{limitation}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {(insight?.status === "AI_UNAVAILABLE" || insight?.status === "INSUFFICIENT_DATA") && (
          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
            {insight.status === "INSUFFICIENT_DATA"
              ? copy(language, "There is not enough recorded data for a grounded insight yet.", "لا توجد بيانات مسجّلة كافية لإعداد رؤية موثوقة بعد.")
              : copy(language, "AI insight is unavailable right now. The deterministic dashboard remains available.", "رؤية الذكاء الاصطناعي غير متاحة الآن. تبقى لوحة البيانات المحددة متاحة.")}
          </div>
        )}
        {failed && insight && (
          <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
            {copy(language, "The latest refresh failed; the last loaded insight is still shown.", "تعذّر التحديث الأخير؛ ما تزال آخر رؤية محمّلة معروضة.")}
          </p>
        )}
      </div>
    </Panel>
  );
}