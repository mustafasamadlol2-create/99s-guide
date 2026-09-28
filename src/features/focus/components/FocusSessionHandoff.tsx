import { ArrowLeft, ArrowRight, Clock3, ShieldCheck } from "lucide-react";
import { useTranslation, type Language } from "../../../core/i18n/translations";
import type { FocusSessionRecord } from "../focusHubModel";

interface FocusSessionHandoffProps {
  language: Language;
  session: FocusSessionRecord | null;
  lectureTitle?: string;
  planItemPosition?: number;
  planItemCount?: number;
  isLoading: boolean;
  onReturnToPlanner: () => void;
}

export function FocusSessionHandoff({
  language,
  session,
  lectureTitle,
  planItemPosition,
  planItemCount,
  isLoading,
  onReturnToPlanner,
}: FocusSessionHandoffProps) {
  const isRtl = language === "ar";
  const { t } = useTranslation(language);

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className="mx-auto flex min-h-[70dvh] w-full max-w-3xl flex-col justify-center px-4 py-8 sm:px-6"
    >
      <button
        type="button"
        onClick={onReturnToPlanner}
        className="mb-6 inline-flex min-h-11 w-fit items-center gap-2 rounded-xl px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300 dark:hover:bg-white/10"
      >
        {isRtl ? (
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        )}
        {t("focusHubReturnPlanner")}
      </button>

      <section className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(25,35,70,0.10)] dark:border-white/10 dark:bg-[#17191f]">
        <div className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-6 py-8 text-white sm:px-9 sm:py-10">
          <div className="absolute -left-12 -top-20 h-52 w-52 rounded-full bg-indigo-400/20 blur-3xl" aria-hidden="true" />
          <div className="relative flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-white/10">
              <Clock3 className="h-5 w-5 text-indigo-100" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-200">
                {t("focusHubTitle")}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                {t("focusHubActiveRouteTitle")}
              </h1>
            </div>
          </div>
        </div>

        <div className="p-6 sm:p-9">
          {isLoading ? (
            <div className="space-y-4" aria-busy="true">
              <div className="h-5 w-2/3 animate-pulse rounded bg-slate-100 dark:bg-white/[0.06]" />
              <div className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-white/[0.06]" />
            </div>
          ) : session ? (
            <>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                    {t("focusHubCurrentSession")}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    {t("focusHubLiveControlsNotHere")}
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/[0.035]">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {t("focusHubQueue")}
                  </p>
                  <p className="mt-1.5 truncate font-semibold text-slate-950 dark:text-white" dir="auto">
                    {lectureTitle || t("focusHubCurrentSession")}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/[0.035]">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {t("focusHubSessionNumber")}
                  </p>
                  <p className="mt-1.5 font-semibold text-slate-950 dark:text-white">
                    <bdi dir="ltr">{session.sessionNumber}</bdi>
                    {" "}
                    {t("focusHubOf")}
                    {" "}
                    <bdi dir="ltr">{session.plannedSessionCount}</bdi>
                  </p>
                </div>
                {planItemPosition && planItemCount ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/[0.035]">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {t("focusHubPlanProgress")}
                    </p>
                    <p className="mt-1.5 font-semibold text-slate-950 dark:text-white">
                      <bdi dir="ltr">{planItemPosition}</bdi>
                      {" "}
                      {t("focusHubOf")}
                      {" "}
                      <bdi dir="ltr">{planItemCount}</bdi>
                    </p>
                  </div>
                ) : null}
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/[0.035]">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {t("focusHubStatus")}
                  </p>
                  <p className="mt-1.5 font-semibold text-slate-950 dark:text-white">
                    <bdi dir="ltr">{session.status}</bdi>
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-300/15 dark:bg-amber-200/[0.06] dark:text-amber-100">
              {t("focusHubSessionNotCurrent")}
            </div>
          )}

          <button
            type="button"
            onClick={onReturnToPlanner}
            className="mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:bg-white dark:text-slate-950 dark:hover:bg-indigo-50 sm:w-auto"
          >
            {isRtl ? (
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            )}
            {t("focusHubReturnPlanner")}
          </button>
        </div>
      </section>
    </div>
  );
}