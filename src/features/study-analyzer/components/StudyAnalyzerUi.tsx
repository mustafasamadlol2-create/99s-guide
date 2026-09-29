import type { ReactNode } from "react";
import { AlertCircle, CircleHelp, TrendingDown, TrendingUp } from "lucide-react";
import type {
  StudyPositiveSignal,
  StudyWeaknessSignal,
} from "../../../../server/features/study-analyzer/types";
import type { Language } from "../../../core/i18n/translations";
import {
  formatNumber,
  formatRateBps,
  trendLabel,
} from "../format";

export function copy(language: Language, english: string, arabic: string): string {
  return language === "ar" ? arabic : english;
}

export function Panel({
  title,
  subtitle,
  icon,
  children,
  action,
  className = "",
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-3xl border border-slate-200/90 bg-white/90 p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/65 sm:p-5 ${className}`}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="break-words text-base font-semibold text-slate-950 dark:text-white">{title}</h2>
            {subtitle && <p className="mt-1 break-words text-xs leading-5 text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="mt-4 min-w-0">{children}</div>
    </section>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  icon,
  tone = "violet",
}: {
  label: string;
  value: string;
  detail?: string;
  icon: ReactNode;
  tone?: "violet" | "blue" | "amber" | "teal";
}) {
  const toneClasses = {
    violet: "bg-violet-100 text-violet-800 dark:bg-violet-300/10 dark:text-violet-100",
    blue: "bg-blue-100 text-blue-800 dark:bg-blue-300/10 dark:text-blue-100",
    amber: "bg-amber-100 text-amber-900 dark:bg-amber-300/10 dark:text-amber-100",
    teal: "bg-teal-100 text-teal-900 dark:bg-teal-300/10 dark:text-teal-100",
  }[tone];
  return (
    <article className="min-w-0 rounded-3xl border border-slate-200/90 bg-white/90 p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/65">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words text-xs font-medium leading-5 text-slate-600 dark:text-slate-300">{label}</p>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${toneClasses}`}>{icon}</span>
      </div>
      <p className="mt-3 break-words text-2xl font-semibold tracking-tight text-slate-950 dark:text-white" dir="auto">{value}</p>
      {detail && <p className="mt-1 break-words text-xs leading-5 text-slate-500 dark:text-slate-400">{detail}</p>}
    </article>
  );
}

export function StatRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0 last:pb-0 dark:border-white/[0.07]">
      <div className="min-w-0">
        <p className="break-words text-sm text-slate-600 dark:text-slate-300">{label}</p>
        {detail && <p className="mt-0.5 break-words text-xs leading-5 text-slate-500 dark:text-slate-400">{detail}</p>}
      </div>
      <span className="shrink-0 text-end text-sm font-semibold text-slate-900 dark:text-white" dir="auto">{value}</span>
    </div>
  );
}

export function TrendBadge({ state, language }: { state: string | null | undefined; language: Language }) {
  const Icon = state === "IMPROVED" ? TrendingUp : state === "DECLINED" ? TrendingDown : CircleHelp;
  const style = state === "IMPROVED"
    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-300/10 dark:text-emerald-100"
    : state === "DECLINED"
      ? "bg-amber-50 text-amber-900 dark:bg-amber-300/10 dark:text-amber-100"
      : "bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200";
  return (
    <span className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${style}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {trendLabel(state as "IMPROVED" | "STABLE" | "DECLINED" | "INSUFFICIENT_DATA", language)}
    </span>
  );
}

export function DataQualityNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-2 rounded-2xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

export function MiniBarChart({
  title,
  items,
  language,
}: {
  title: string;
  items: Array<{ label: string; value: number | null; detail?: string }>;
  language: Language;
}) {
  const maximum = Math.max(1, ...items.map((item) => item.value ?? 0));
  return (
    <figure className="mt-4 border-t border-slate-100 pt-3 dark:border-white/[0.07]">
      <figcaption className="text-xs font-semibold text-slate-600 dark:text-slate-300">{title}</figcaption>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{copy(language, "Not enough data yet", "لا توجد بيانات كافية بعد")}</p>
      ) : (
        <ul className="mt-2 space-y-2.5">
          {items.map((item, index) => {
            const width = item.value === null
              ? 0
              : Math.max(0, Math.min(100, (Math.max(0, item.value) / maximum) * 100));
            return (
              <li key={`${item.label}-${index}`} className="min-w-0">
                <div className="flex min-w-0 items-baseline justify-between gap-3">
                  <span className="min-w-0 break-words text-xs text-slate-600 dark:text-slate-300">{item.label}</span>
                  <bdi className="shrink-0 text-xs font-semibold text-slate-900 dark:text-white">
                    {item.value === null ? "—" : formatNumber(item.value, language)}
                  </bdi>
                </div>
                {item.detail && <p className="mt-0.5 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{item.detail}</p>}
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.07]" aria-hidden="true">
                  <div className="h-full rounded-full bg-violet-600 transition-[width] duration-300 motion-reduce:transition-none dark:bg-violet-300" style={{ width: `${width}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </figure>
  );
}

export function sourceQualityMessage(
  source: { available: boolean; collectionEnabled: boolean; complete: boolean; truncated: boolean },
  language: Language,
): string | null {
  if (!source.collectionEnabled || !source.available) {
    return copy(language, "This data source is not available yet.", "مصدر البيانات هذا غير متاح حاليًا.");
  }
  if (!source.complete || source.truncated) {
    return copy(language, "Some recorded data is incomplete for this section.", "بعض البيانات المسجّلة في هذا القسم غير مكتملة.");
  }
  return null;
}

export function valueOrUnknown(
  value: number | null | undefined,
  language: Language,
  unknownLabel: string,
): string {
  return value === null || value === undefined ? unknownLabel : formatNumber(value, language);
}

export function getSignalEvidence(
  signal: StudyWeaknessSignal | StudyPositiveSignal,
  language: Language,
): string | null {
  const evidence = signal.evidence;
  if (evidence.rateBps !== undefined && evidence.rateBps !== null) {
    return formatRateBps(evidence.rateBps, language);
  }
  if (evidence.numerator !== undefined && evidence.numerator !== null &&
      evidence.denominator !== undefined && evidence.denominator !== null) {
    return `${formatNumber(evidence.numerator, language)} / ${formatNumber(evidence.denominator, language)}`;
  }
  if (evidence.count !== undefined && evidence.count !== null) {
    return formatNumber(evidence.count, language);
  }
  return null;
}