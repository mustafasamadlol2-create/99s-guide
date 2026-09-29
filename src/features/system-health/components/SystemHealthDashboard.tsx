import { Activity, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useSystemHealth } from "../useSystemHealth";
import { HealthStatusBadge } from "./HealthStatusBadge";
import type { HealthComponent, HealthStatus, SystemHealthSnapshot } from "../../../../server/observability/types.js";
import type { Language } from "../../../core/i18n/translations";

type ComponentKey = keyof SystemHealthSnapshot["components"];

const sections: Array<{ key: ComponentKey; en: string; ar: string }> = [
  { key: "postgres", en: "Core API / PostgreSQL", ar: "واجهة الخدمة / PostgreSQL" },
  { key: "outbox", en: "Study Event / Outbox", ar: "أحداث الدراسة / صندوق الإرسال" },
  { key: "privateD1", en: "Private D1 projections", ar: "إسقاطات D1 الخاصة" },
  { key: "leaderboardD1", en: "Leaderboard D1", ar: "لوحة الصدارة D1" },
  { key: "groupFocus", en: "Group Focus", ar: "التركيز الجماعي" },
  { key: "studyPoints", en: "Study Points", ar: "نقاط الدراسة" },
  { key: "recall", en: "Recall", ar: "الاستذكار" },
  { key: "masteryRetention", en: "Mastery / Retention", ar: "الإتقان / الاحتفاظ" },
  { key: "analyzer", en: "Study Analyzer", ar: "محلل الدراسة" },
  { key: "workersAi", en: "AI Study Insights", ar: "رؤى الدراسة بالذكاء الاصطناعي" },
  { key: "askStudyData", en: "Ask My Study Data", ar: "اسأل بيانات دراستي" },
];

const summaryLabels: Record<string, { en: string; ar: string }> = {
  connectivity: { en: "Connectivity", ar: "الاتصال" },
  latencyMs: { en: "Health query (ms)", ar: "زمن فحص الصحة (مللي ثانية)" },
  schemaStatus: { en: "Schema", ar: "المخطط" },
  missingCriticalTableCount: { en: "Missing required objects", ar: "العناصر المطلوبة المفقودة" },
  privatePending: { en: "Private D1 pending", ar: "مهام D1 الخاصة المعلقة" },
  leaderboardPending: { en: "Leaderboard pending", ar: "مهام لوحة الصدارة المعلقة" },
  privateBlocked: { en: "Private D1 blocked", ar: "مهام D1 الخاصة المتوقفة" },
  leaderboardBlocked: { en: "Leaderboard blocked", ar: "مهام لوحة الصدارة المتوقفة" },
  privatePoison: { en: "Private D1 poison", ar: "مهام D1 الخاصة المتعذرة" },
  leaderboardPoison: { en: "Leaderboard poison", ar: "مهام لوحة الصدارة المتعذرة" },
  pending: { en: "Pending", ar: "معلق" },
  delayed: { en: "Delayed", ar: "متأخر" },
  leased: { en: "Leased", ar: "قيد المعالجة" },
  blocked: { en: "Blocked", ar: "متوقف" },
  poison: { en: "Poison", ar: "متعذر" },
  highAttempts: { en: "High attempts", ar: "محاولات متكررة" },
  pendingAgeMs: { en: "Oldest pending age (ms)", ar: "عمر أقدم مهمة (مللي ثانية)" },
  oldestPendingAgeMs: { en: "Oldest pending age (ms)", ar: "عمر أقدم مهمة (مللي ثانية)" },
  openRooms: { en: "Open rooms", ar: "الغرف المفتوحة" },
  closedRooms: { en: "Closed rooms", ar: "الغرف المغلقة" },
  reconciledSummaries7d: { en: "Reconciled summaries (7d)", ar: "ملخصات تمت تسويتها (٧ أيام)" },
  reconciliationP95Ms: { en: "Reconciliation p95 (ms)", ar: "الزمن المئوي ٩٥ للتسوية (مللي ثانية)" },
  reconciliationMaxMs: { en: "Maximum reconciliation lag (ms)", ar: "أقصى تأخير للتسوية (مللي ثانية)" },
  requests15m: { en: "Requests (15m)", ar: "الطلبات (١٥ دقيقة)" },
  serverErrors15m: { en: "Server errors (15m)", ar: "أخطاء الخادم (١٥ دقيقة)" },
  p95LatencyMs: { en: "Request p95 (ms)", ar: "زمن الطلب المئوي ٩٥ (مللي ثانية)" },
  workerConfigured: { en: "Worker configuration present", ar: "إعداد العامل موجود" },
  workerReachability: { en: "Worker reachability", ar: "إمكانية الوصول للعامل" },
  durableObjectRuntime: { en: "Durable Object runtime", ar: "بيئة Durable Object" },
  postgresFallback: { en: "Fallback", ar: "البديل" },
  featureState: { en: "Feature state", ar: "حالة الميزة" },
  requestSignal: { en: "Request signal", ar: "إشارة الطلبات" },
};

function formattedValue(value: string | number | boolean | null, language: Language): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? (language === "ar" ? "نعم" : "Yes") : (language === "ar" ? "لا" : "No");
  if (typeof value === "number") {
    return new Intl.NumberFormat(language === "ar" ? "ar" : "en").format(value);
  }
  return value.replaceAll("_", " ");
}

function HealthCard({
  title,
  component,
  status,
  language,
}: {
  title: string;
  component: HealthComponent;
  status: HealthStatus;
  language: Language;
}) {
  const entries = Object.entries(component.summary).slice(0, 7);
  return (
    <article className="rounded-xl border border-neutral-200/70 bg-white p-4 dark:border-white/10 dark:bg-[#171719]">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-sm text-neutral-900 dark:text-white">{title}</h3>
        <HealthStatusBadge status={status} language={language === "ar" ? "ar" : "en"} />
      </div>
      <dl className="mt-4 space-y-2">
        {entries.length === 0 ? (
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            {language === "ar" ? "لا توجد تفاصيل إضافية." : "No additional signal is available."}
          </div>
        ) : entries.map(([key, value]) => (
          <div key={key} className="flex items-start justify-between gap-3 text-xs">
            <dt className="text-neutral-500 dark:text-neutral-400">
              {summaryLabels[key]?.[language === "ar" ? "ar" : "en"] ?? key}
            </dt>
            <dd className="text-right font-medium text-neutral-800 dark:text-neutral-200 break-words">
              {formattedValue(value, language)}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function dateLabel(value: string, language: Language): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(language === "ar" ? "ar" : "en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function SystemHealthDashboard({ language }: { language: Language }) {
  const isRtl = language === "ar";
  const { snapshot, loading, refreshing, failedAt, refresh } = useSystemHealth();
  const serverSnapshot = snapshot;
  const clientStale = Boolean(
    failedAt
    || (serverSnapshot && Date.now() - Date.parse(serverSnapshot.checkedAt) > 120_000),
  );
  const overall: HealthStatus = clientStale ? "UNKNOWN" : serverSnapshot?.overall ?? "UNKNOWN";
  const title = isRtl ? "صحة النظام" : "System Health";

  return (
    <section className="w-full max-w-7xl mx-auto space-y-5" aria-labelledby="system-health-title">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-rose-500" aria-hidden="true" />
            <h2 id="system-health-title" className="text-xl font-bold text-neutral-900 dark:text-white">
              {title}
            </h2>
          </div>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {isRtl
              ? "مؤشرات تشغيلية مجمعة فقط؛ لا تتضمن بيانات دراسة أو سجلات طلبة."
              : "Aggregate operational signals only. Student identities and private study content are excluded."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-white/10 dark:text-neutral-200 dark:hover:bg-white/5"
          aria-label={isRtl ? "تحديث مؤشرات الصحة" : "Refresh health signals"}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {refreshing
            ? (isRtl ? "جارٍ التحديث…" : "Refreshing…")
            : (isRtl ? "تحديث" : "Refresh")}
        </button>
      </header>

      {loading && !serverSnapshot ? (
        <div className="rounded-xl border border-neutral-200/70 p-8 text-center text-sm text-neutral-500 dark:border-white/10 dark:text-neutral-400" role="status">
          {isRtl ? "جارٍ تحميل المؤشرات التشغيلية…" : "Loading operational health…"}
        </div>
      ) : (
        <>
          <article className="rounded-2xl border border-neutral-200/70 bg-gradient-to-br from-white to-neutral-50 p-5 dark:border-white/10 dark:from-[#1C1C1E] dark:to-[#141416]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                {clientStale
                  ? <TriangleAlert className="h-8 w-8 text-amber-500" aria-hidden="true" />
                  : <ShieldCheck className="h-8 w-8 text-emerald-500" aria-hidden="true" />}
                <div>
                  <h3 className="text-base font-bold text-neutral-900 dark:text-white">
                    {isRtl ? "الحالة العامة" : "Overall status"}
                  </h3>
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    {serverSnapshot
                      ? `${isRtl ? "آخر فحص" : "Checked"}: ${dateLabel(serverSnapshot.checkedAt, language)}`
                      : (isRtl ? "لم تصل بيانات صحة بعد." : "No health data has been received yet.")}
                  </p>
                </div>
              </div>
              <HealthStatusBadge status={overall} language={isRtl ? "ar" : "en"} />
            </div>
            {clientStale && (
              <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" role="status">
                {isRtl
                  ? "تعذر تحديث البيانات؛ عُرضت الحالة كغير معروفة بدلاً من الاعتماد على حالة قديمة."
                  : "Health data could not be refreshed. Status is shown as UNKNOWN instead of reusing an old green state."}
              </p>
            )}
            {serverSnapshot && (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { en: "Requests (15m)", ar: "الطلبات (١٥ دقيقة)", value: serverSnapshot.operations.requests },
                  { en: "Server errors", ar: "أخطاء الخادم", value: serverSnapshot.operations.serverErrors },
                  { en: "Error rate", ar: "معدل الأخطاء", value: serverSnapshot.operations.serverErrorRate === null ? "—" : `${(serverSnapshot.operations.serverErrorRate * 100).toFixed(1)}%` },
                  { en: "Latency p95", ar: "زمن الاستجابة المئوي ٩٥", value: serverSnapshot.operations.latencyMs.p95 === null ? "—" : `${serverSnapshot.operations.latencyMs.p95} ms` },
                ].map((item) => (
                  <div key={item.en} className="rounded-lg bg-neutral-100/80 p-3 dark:bg-white/[0.05]">
                    <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{isRtl ? item.ar : item.en}</div>
                    <div className="mt-1 text-lg font-bold tabular-nums text-neutral-900 dark:text-white">
                      {typeof item.value === "number" ? new Intl.NumberFormat(isRtl ? "ar" : "en").format(item.value) : item.value}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>

          {serverSnapshot && (
            <>
              <section aria-labelledby="system-health-components-title">
                <h3 id="system-health-components-title" className="mb-3 text-sm font-bold text-neutral-900 dark:text-white">
                  {isRtl ? "الخدمات والأنظمة الفرعية" : "Services and subsystems"}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {sections.map((section) => {
                    const component = serverSnapshot.components[section.key];
                    return (
                      <HealthCard
                        key={section.key}
                        title={isRtl ? section.ar : section.en}
                        component={component}
                        status={clientStale ? "UNKNOWN" : component.status}
                        language={language}
                      />
                    );
                  })}
                </div>
              </section>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <section className="rounded-xl border border-neutral-200/70 p-4 dark:border-white/10" aria-labelledby="system-health-errors-title">
                  <h3 id="system-health-errors-title" className="text-sm font-bold text-neutral-900 dark:text-white">
                    {isRtl ? "الأخطاء التشغيلية الأخيرة" : "Recent operational errors"}
                  </h3>
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    {isRtl ? "مجمعة حسب الخدمة والميزة ورمز الخطأ؛ لا توجد حمولات أو معرفات." : "Grouped by service, feature, and stable error code; no raw payloads or identifiers."}
                  </p>
                  {serverSnapshot.operations.recentErrors.length === 0 ? (
                    <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">
                      {isRtl ? "لا توجد أخطاء مسجلة في نافذة المؤشرات الحالية." : "No operational errors are recorded in the current window."}
                    </p>
                  ) : (
                    <ul className="mt-3 divide-y divide-neutral-100 dark:divide-white/10">
                      {serverSnapshot.operations.recentErrors.map((error) => (
                        <li key={`${error.service}:${error.feature}:${error.errorCode}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                          <span className="font-mono font-semibold text-neutral-800 dark:text-neutral-200">
                            {error.errorCode}
                          </span>
                          <span className="text-neutral-500 dark:text-neutral-400">
                            {error.service} · {error.feature} · {new Intl.NumberFormat(isRtl ? "ar" : "en").format(error.count)}
                          </span>
                          <time className="text-neutral-500 dark:text-neutral-400" dateTime={error.lastOccurredAt}>
                            {dateLabel(error.lastOccurredAt, language)}
                          </time>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rounded-xl border border-neutral-200/70 p-4 dark:border-white/10" aria-labelledby="system-health-flags-title">
                  <h3 id="system-health-flags-title" className="text-sm font-bold text-neutral-900 dark:text-white">
                    {isRtl ? "حالة مفاتيح الميزات" : "Feature flag status"}
                  </h3>
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    {isRtl ? "عرض للقراءة فقط؛ لا يمكن تعديل المفاتيح من لوحة الصحة." : "Read-only visibility. Flags cannot be edited from this dashboard."}
                  </p>
                  <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {Object.entries(serverSnapshot.featureFlags).map(([name, enabled]) => (
                      <li key={name} className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-[11px] dark:bg-white/[0.04]">
                        <span className="truncate font-mono text-neutral-700 dark:text-neutral-300">{name}</span>
                        <span className={enabled ? "font-bold text-emerald-700 dark:text-emerald-300" : "font-medium text-neutral-500"}>
                          {enabled ? (isRtl ? "مفعّل" : "ON") : (isRtl ? "متوقف" : "OFF")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>

              <section className="rounded-xl border border-neutral-200/70 p-4 dark:border-white/10" aria-labelledby="system-health-outcomes-title">
                <h3 id="system-health-outcomes-title" className="text-sm font-bold text-neutral-900 dark:text-white">
                  {isRtl ? "نتائج خطوط المعالجة" : "Pipeline outcomes"}
                </h3>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  {isRtl
                    ? "النتائج الطبيعية مثل التهدئة وعدم توفر عنصر تُعرض منفصلة عن الأخطاء."
                    : "Expected outcomes such as cooldown and no-eligible are shown separately from errors."}
                </p>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  {isRtl
                    ? "العدادات محلية للعملية، بذاكرة مؤقتة لمدة ١٥ دقيقة، وتُصفّر عند إعادة التشغيل."
                    : "Counters are in-memory per process, cover 15 minutes, and reset on restart."}
                </p>
                {serverSnapshot.operations.outcomes.length === 0 ? (
                  <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
                    {isRtl ? "لا توجد نتائج تشغيلية مرصودة بعد." : "No pipeline outcomes have been observed yet."}
                  </p>
                ) : (
                  <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {serverSnapshot.operations.outcomes.map((outcome) => (
                      <li
                        key={`${outcome.feature}:${outcome.operation}:${outcome.result}`}
                        className="flex items-center justify-between gap-3 rounded-lg bg-neutral-50 px-3 py-2 text-xs dark:bg-white/[0.04]"
                      >
                        <span className="min-w-0 truncate text-neutral-700 dark:text-neutral-300">
                          {outcome.feature.replaceAll("_", " ")} · {outcome.operation} · {outcome.result.replaceAll("_", " ")}
                        </span>
                        <strong className="shrink-0 tabular-nums text-neutral-900 dark:text-white">
                          {new Intl.NumberFormat(isRtl ? "ar" : "en").format(outcome.count)}
                        </strong>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-xl border border-neutral-200/70 bg-neutral-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]" aria-labelledby="system-health-release-title">
                <h3 id="system-health-release-title" className="text-sm font-bold text-neutral-900 dark:text-white">
                  {isRtl ? "بوابات الإصدار" : "Release gates"}
                </h3>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
                  {isRtl
                    ? "فحوصات الإصدار منفصلة عن صحة وقت التشغيل، وتُشغّل محلياً أو على التجهيز فقط."
                    : "Release checks are separate from runtime health and run only against local or staging targets."}
                </p>
                <code dir="ltr" className="mt-3 block overflow-x-auto rounded-lg bg-neutral-900 px-3 py-2 text-xs text-neutral-100">
                  npm run study:release-check -- --target=local
                </code>
                <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                  {isRtl
                    ? "الأمر للقراءة فقط؛ لا ينشر التطبيق ولا يصلح البيانات ولا يشغّل إعادة البناء."
                    : "Read-only command. It does not publish, repair data, or run rebuilds/backfills."}
                </p>
              </section>
            </>
          )}
        </>
      )}
    </section>
  );
}