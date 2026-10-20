import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type { Language } from "../../../core/i18n/translations";
import {
  getIntegritySignal,
  listIntegritySignals,
  reviewIntegritySignal,
  reverseIntegrityFocusPoints,
  type IntegritySignal,
  type IntegritySignalDetail,
  type IntegritySignalSeverity,
  type IntegritySignalStatus,
} from "../api";

const STATUS_OPTIONS: Array<IntegritySignalStatus | "all"> = [
  "OPEN",
  "ACKNOWLEDGED",
  "RESOLVED",
  "DISMISSED",
  "all",
];

function when(value: string, language: Language): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(language === "ar" ? "ar-IQ" : "en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function severityTone(severity: IntegritySignalSeverity): string {
  if (severity === "BLOCK") return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-300/15 dark:bg-rose-300/[0.07] dark:text-rose-200";
  if (severity === "REVIEW") return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-300/15 dark:bg-amber-300/[0.07] dark:text-amber-100";
  return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-300/15 dark:bg-sky-300/[0.07] dark:text-sky-100";
}

export default function StudyIntegrityDashboard({ language }: { language: Language }) {
  const isRtl = language === "ar";
  const [status, setStatus] = useState<IntegritySignalStatus | "all">("OPEN");
  const [severity, setSeverity] = useState<IntegritySignalSeverity | "">("");
  const [query, setQuery] = useState("");
  const [signals, setSignals] = useState<IntegritySignal[]>([]);
  const [selected, setSelected] = useState<IntegritySignalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const copy = useMemo(() => isRtl ? {
    title: "سلامة الدراسة",
    subtitle: "إشارات تقنية خاصة لمراجعة النشاط غير المعتاد بدون افتراض سوء السلوك.",
    refresh: "تحديث",
    all: "الكل",
    open: "مفتوح",
    acknowledged: "تمت المراجعة",
    resolved: "محلول",
    dismissed: "مرفوض",
    block: "حظر تقني",
    review: "مراجعة",
    search: "ابحث بالمستخدم أو الإجراء أو القاعدة",
    empty: "لا توجد إشارات مطابقة.",
    detail: "تفاصيل الإشارة",
    occurrence: "مرات الظهور",
    rule: "القاعدة",
    action: "الإجراء",
    resource: "المورد",
    evidence: "الدليل",
    history: "سجل المراجعة",
    note: "ملاحظة داخلية اختيارية",
    acknowledge: "تأكيد المراجعة",
    resolve: "حل",
    dismiss: "استبعاد",
    reopen: "إعادة فتح",
    retry: "إعادة المحاولة",
    reversePoints: "عكس نقاط Focus",
    reverseConfirm: "سيتم إنشاء قيد عكس في سجل النقاط بدون حذف التاريخ. هل تريد المتابعة؟",
  } : {
    title: "Study Integrity",
    subtitle: "Private technical signals for reviewing unusual activity without presuming misconduct.",
    refresh: "Refresh",
    all: "All",
    open: "Open",
    acknowledged: "Acknowledged",
    resolved: "Resolved",
    dismissed: "Dismissed",
    block: "Technical block",
    review: "Review",
    search: "Search user, action, or rule",
    empty: "No matching integrity signals.",
    detail: "Signal detail",
    occurrence: "Occurrences",
    rule: "Rule",
    action: "Action",
    resource: "Resource",
    evidence: "Evidence",
    history: "Review history",
    note: "Optional private review note",
    acknowledge: "Acknowledge",
    resolve: "Resolve",
    dismiss: "Dismiss",
    reopen: "Reopen",
    retry: "Try again",
    reversePoints: "Reverse Focus points",
    reverseConfirm: "This creates an append-only reversal entry and keeps the original history. Continue?",
  }, [isRtl]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await listIntegritySignals({
        status,
        ...(severity ? { severity } : {}),
        limit: 100,
      });
      setSignals(page.items);
      if (selected && !page.items.some((signal) => signal.id === selected.signal.id)) {
        setSelected(null);
      }
    } catch {
      setError(isRtl ? "تعذر تحميل إشارات سلامة الدراسة." : "Study integrity signals could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [isRtl, selected, severity, status]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return signals;
    return signals.filter((signal) => [
      signal.userId,
      signal.actionType,
      signal.ruleId,
      signal.observationCode,
      signal.resourceId ?? "",
    ].some((value) => value.toLowerCase().includes(term)));
  }, [query, signals]);

  const openDetail = async (signal: IntegritySignal) => {
    setDetailLoading(true);
    setError(null);
    try {
      setSelected(await getIntegritySignal(signal.id));
      setNote("");
    } catch {
      setError(isRtl ? "تعذر تحميل تفاصيل الإشارة." : "Signal detail could not be loaded.");
    } finally {
      setDetailLoading(false);
    }
  };

  const review = async (action: "ACKNOWLEDGE" | "RESOLVE" | "DISMISS" | "REOPEN") => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await reviewIntegritySignal({
        signalId: selected.signal.id,
        action,
        expectedReviewVersion: selected.signal.reviewVersion,
        ...(note.trim() ? { note } : {}),
      });
      const detail = await getIntegritySignal(result.signal.id);
      setSelected(detail);
      setNote("");
      await load();
    } catch {
      setError(isRtl ? "تعذر حفظ قرار المراجعة. حدّث الصفحة وحاول مجددًا." : "Review action could not be saved. Refresh and try again.");
    } finally {
      setBusy(false);
    }
  };

  const reversePoints = async () => {
    if (!selected || busy) return;
    if (!window.confirm(copy.reverseConfirm)) return;
    setBusy(true);
    setError(null);
    try {
      await reverseIntegrityFocusPoints(selected.signal.id);
      setNote(
        isRtl
          ? "تم إنشاء قيد عكس لنقاط Focus المرتبطة بهذه الإشارة."
          : "A Focus points reversal entry was created for this signal.",
      );
    } catch {
      setError(isRtl ? "تعذر عكس نقاط Focus لهذه الإشارة." : "Focus points could not be reversed for this signal.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section dir={isRtl ? "rtl" : "ltr"} className="space-y-5">
      <header className="rounded-[26px] border border-neutral-200/80 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:bg-amber-300/10 dark:text-amber-200">
              <ShieldAlert className="size-6" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-neutral-950 dark:text-white">{copy.title}</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500 dark:text-neutral-400">{copy.subtitle}</p>
            </div>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-sm font-semibold text-neutral-700 shadow-sm transition active:scale-[.97] dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-100">
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
            {copy.refresh}
          </button>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,.92fr)]">
        <div className="min-w-0 rounded-[26px] border border-neutral-200/80 bg-white/90 p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((item) => (
              <button key={item} type="button" onClick={() => setStatus(item)} className={`rounded-full px-3 py-2 text-xs font-semibold transition active:scale-[.97] ${status === item ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-950" : "bg-neutral-100 text-neutral-600 dark:bg-white/[0.07] dark:text-neutral-300"}`}>
                {item === "all" ? copy.all : item === "OPEN" ? copy.open : item === "ACKNOWLEDGED" ? copy.acknowledged : item === "RESOLVED" ? copy.resolved : copy.dismissed}
              </button>
            ))}
            <select value={severity} onChange={(event) => setSeverity(event.target.value as IntegritySignalSeverity | "")} className="min-h-9 rounded-full border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-100">
              <option value="">{copy.all}</option>
              <option value="REVIEW">{copy.review}</option>
              <option value="BLOCK">{copy.block}</option>
            </select>
          </div>
          <label className="mt-3 flex min-h-11 items-center gap-2 rounded-2xl border border-neutral-200 bg-neutral-50 px-3 dark:border-white/10 dark:bg-white/[0.04]">
            <Search className="size-4 text-neutral-400" aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400" />
          </label>

          {error && <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-300/15 dark:bg-rose-300/[0.06] dark:text-rose-200">{error}</p>}

          <div className="mt-4 space-y-2">
            {loading ? Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-2xl bg-neutral-100 dark:bg-white/[0.05]" />) : filtered.length === 0 ? (
              <p className="rounded-2xl bg-neutral-50 p-6 text-center text-sm text-neutral-500 dark:bg-white/[0.03] dark:text-neutral-400">{copy.empty}</p>
            ) : filtered.map((signal) => (
              <button key={signal.id} type="button" onClick={() => void openDetail(signal)} className="flex w-full items-center gap-3 rounded-2xl border border-neutral-200/80 bg-white p-3 text-start shadow-[0_3px_12px_rgba(0,0,0,.025)] transition hover:-translate-y-px hover:shadow-md active:scale-[.99] dark:border-white/10 dark:bg-white/[0.025]">
                <span className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl border ${severityTone(signal.severity)}`}>
                  {signal.severity === "BLOCK" ? <XCircle className="size-5" /> : <AlertTriangle className="size-5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <strong className="truncate text-sm text-neutral-900 dark:text-white">{signal.observationCode}</strong>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${severityTone(signal.severity)}`}>{signal.severity}</span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-neutral-500 dark:text-neutral-400">{signal.actionType} · {signal.userId}</span>
                  <span className="mt-1 block text-[11px] text-neutral-400">{when(signal.lastOccurredAt, language)} · {copy.occurrence}: {signal.occurrenceCount}</span>
                </span>
                <ChevronRight className={`size-4 shrink-0 text-neutral-400 ${isRtl ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>

        <aside className="min-w-0 rounded-[26px] border border-neutral-200/80 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
          {detailLoading ? <div className="h-80 animate-pulse rounded-2xl bg-neutral-100 dark:bg-white/[0.05]" /> : !selected ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center text-center text-neutral-400">
              <ShieldCheck className="size-10" aria-hidden="true" />
              <p className="mt-3 text-sm">{copy.detail}</p>
            </div>
          ) : (
            <div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[.16em] text-neutral-400">{copy.detail}</p>
                  <h3 className="mt-1 text-lg font-bold text-neutral-950 dark:text-white">{selected.signal.observationCode}</h3>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${severityTone(selected.signal.severity)}`}>{selected.signal.severity}</span>
              </div>
              <dl className="mt-5 grid gap-3 text-sm">
                {[
                  [copy.action, selected.signal.actionType],
                  [copy.rule, `${selected.signal.ruleId} · ${selected.signal.ruleVersion}`],
                  [copy.resource, selected.signal.resourceKind && selected.signal.resourceId ? `${selected.signal.resourceKind}:${selected.signal.resourceId}` : "—"],
                  [copy.evidence, `${selected.signal.evidenceClass} · ${selected.signal.source}`],
                  [copy.occurrence, String(selected.signal.occurrenceCount)],
                ].map(([label, value]) => <div key={label} className="rounded-xl bg-neutral-50 p-3 dark:bg-white/[0.04]"><dt className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{label}</dt><dd className="mt-1 break-all font-medium text-neutral-800 dark:text-neutral-100">{value}</dd></div>)}
              </dl>

              <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder={copy.note} className="mt-4 min-h-24 w-full resize-y rounded-2xl border border-neutral-200 bg-neutral-50 p-3 text-sm outline-none focus:border-amber-400 dark:border-white/10 dark:bg-white/[0.04]" />
              <div className="mt-3 grid grid-cols-2 gap-2">
                {selected.signal.status === "OPEN" && <button type="button" disabled={busy} onClick={() => void review("ACKNOWLEDGE")} className="min-h-11 rounded-xl bg-amber-500 px-3 text-sm font-bold text-white disabled:opacity-50">{copy.acknowledge}</button>}
                {(selected.signal.status === "OPEN" || selected.signal.status === "ACKNOWLEDGED") && <button type="button" disabled={busy} onClick={() => void review("RESOLVE")} className="min-h-11 rounded-xl bg-emerald-600 px-3 text-sm font-bold text-white disabled:opacity-50">{copy.resolve}</button>}
                {(selected.signal.status === "OPEN" || selected.signal.status === "ACKNOWLEDGED") && <button type="button" disabled={busy} onClick={() => void review("DISMISS")} className="min-h-11 rounded-xl border border-neutral-200 bg-white px-3 text-sm font-bold text-neutral-700 disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-100">{copy.dismiss}</button>}
                {(selected.signal.status === "RESOLVED" || selected.signal.status === "DISMISSED") && <button type="button" disabled={busy} onClick={() => void review("REOPEN")} className="min-h-11 rounded-xl bg-neutral-900 px-3 text-sm font-bold text-white disabled:opacity-50 dark:bg-white dark:text-neutral-950">{copy.reopen}</button>}
              </div>
              {selected.signal.severity === "BLOCK" && selected.signal.resourceKind === "focus_session" && selected.signal.resourceId && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void reversePoints()}
                  className="mt-3 min-h-11 w-full rounded-xl border border-rose-200 bg-rose-50 px-3 text-sm font-bold text-rose-700 transition active:scale-[.98] disabled:opacity-50 dark:border-rose-300/15 dark:bg-rose-300/[0.06] dark:text-rose-200"
                >
                  {copy.reversePoints}
                </button>
              )}

              <div className="mt-6 border-t border-neutral-200 pt-4 dark:border-white/10">
                <h4 className="flex items-center gap-2 text-sm font-bold text-neutral-900 dark:text-white"><Clock3 className="size-4" />{copy.history}</h4>
                <div className="mt-3 space-y-2">
                  {selected.reviewHistory.length === 0 ? <p className="text-xs text-neutral-400">—</p> : selected.reviewHistory.map((item) => (
                    <div key={item.id} className="rounded-xl bg-neutral-50 p-3 text-xs dark:bg-white/[0.04]">
                      <p className="font-semibold text-neutral-700 dark:text-neutral-200">{item.actionType}: {item.fromStatus} → {item.toStatus}</p>
                      {item.note && <p className="mt-1 text-neutral-500 dark:text-neutral-400">{item.note}</p>}
                      <p className="mt-1 text-[10px] text-neutral-400">{when(item.createdAt, language)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
