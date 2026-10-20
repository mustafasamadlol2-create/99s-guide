import { ArrowLeft, CheckCircle2, Clock3, RotateCcw } from "lucide-react";
import type { GroupFocusMyRuntimeSummary } from "../../../../shared/group-focus-reconciliation/contract";
import {
  GroupFocusButton,
  GroupFocusError,
  GroupFocusPageHeader,
  GroupFocusPanel,
  GroupFocusShell,
  GroupFocusSkeleton,
  useGroupFocusCopy,
  type GroupFocusLanguage,
} from "./groupFocusUi";

export interface GroupFocusSummaryProps {
  language: GroupFocusLanguage;
  summary: GroupFocusMyRuntimeSummary | null;
  status: "loading" | "ready" | "error";
  onBack: () => void;
  onRetry: () => void;
  error?: string;
}

function duration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function reasonLabel(reason: GroupFocusMyRuntimeSummary["run"]["terminalReason"], t: ReturnType<typeof useGroupFocusCopy>["t"]) {
  if (reason === "COMPLETED") return t("completedReason");
  if (reason === "HOST_CLOSED") return t("hostClosedReason");
  if (reason === "CANONICAL_ROOM_CLOSED") return t("roomClosedReason");
  return t("idleReason");
}

export function GroupFocusSummary({ language, summary, status, onBack, onRetry, error }: GroupFocusSummaryProps) {
  const { t } = useGroupFocusCopy(language);
  return (
    <GroupFocusShell language={language}>
      <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-4 sm:px-7 sm:pt-5 lg:px-10">
        <button type="button" onClick={onBack} className="mb-7 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-[#475569] hover:bg-[#f0f9ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0ea5e9]">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t("backToRooms")}
        </button>
        <GroupFocusPageHeader language={language} eyebrow={t("terminal")} title={t("summaryTitle")} description={t("summarySubtitle")} />
        <div className="mt-6">
          {status === "loading" && <GroupFocusSkeleton rows={2} label={t("summaryLoading")} />}
          {status === "error" && (
            <GroupFocusError message={error || t("summaryError")} onRetry={onRetry} retryLabel={t("retrySummary")} />
          )}
          {status === "ready" && summary && (
            <div className="space-y-5">
              <section className="overflow-hidden rounded-[1.8rem] border border-[#dbeafe] bg-[#eef6ff] p-5 sm:p-8">
                <div className="flex items-center gap-3 text-[#0284c7]">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e0f2fe]">
                    <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em]">{t("endedReason")}</p>
                    <p className="mt-1 text-sm font-semibold text-[#334155]">{reasonLabel(summary.run.terminalReason, t)}</p>
                  </div>
                </div>
                <div className="mt-8 grid gap-4 sm:grid-cols-[1.25fr_0.75fr]">
                  <div className="rounded-2xl bg-[#ffffff] p-5 sm:p-7">
                    <p className="text-sm font-semibold text-[#64748b]">{t("verifiedTime")}</p>
                    <p className="mt-3 font-mono text-5xl font-medium tracking-[-0.07em] text-[#0f2744] tabular-nums sm:text-6xl" dir="ltr">
                      {duration(summary.participant.verifiedFocusSeconds)}
                    </p>
                    <p className="mt-2 text-xs text-[#94a3b8]">
                      {Math.floor(summary.participant.verifiedFocusSeconds / 3600) > 0
                        ? t("durationHoursFormat")
                        : t("durationMinutesFormat")}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-1">
                    <Metric label={t("completedRounds")} value={`${summary.run.completedRounds}`} />
                    <Metric label={t("plannedRounds")} value={`${summary.run.roundCount}`} />
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-[#f8fafc]/80 px-4 py-3 text-sm text-[#64748b]">
                  <span className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4" aria-hidden="true" />{t("focus")} <b className="font-semibold text-[#334155]" dir="ltr">{summary.run.focusDurationSeconds / 60} {t("minutesShort")}</b></span>
                  <span className="inline-flex items-center gap-2"><RotateCcw className="h-4 w-4" aria-hidden="true" />{t("rounds")} <b className="font-semibold text-[#334155]" dir="ltr">{summary.run.completedRounds}/{summary.run.roundCount}</b></span>
                </div>
              </section>

              <GroupFocusPanel title={t("roundDetails")}>
                {summary.participant.rounds.length > 0 ? (
                  <ol className="divide-y divide-[#e2e8f0]">
                    {summary.participant.rounds.map((round) => {
                      const plannedSeconds = summary.run.focusDurationSeconds;
                      const verified = Math.max(0, round.verifiedFocusSeconds);
                      const width = plannedSeconds > 0 ? Math.min(100, (verified / plannedSeconds) * 100) : 0;
                      return (
                        <li key={round.roundNumber} className="flex items-center gap-4 py-4 first:pt-1 last:pb-1">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#eff6ff] text-sm font-semibold text-[#0284c7] tabular-nums">{round.roundNumber}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3 text-sm">
                              <span className="font-medium text-[#475569]">{t("round")} {round.roundNumber}</span>
                              <span className="shrink-0 font-mono text-sm font-semibold text-[#334155] tabular-nums" dir="ltr">{duration(verified)}</span>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e2e8f0]" aria-hidden="true">
                              <div className="h-full rounded-full bg-[#3b82f6]" style={{ width: `${width}%` }} />
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="rounded-xl bg-[#f8fafc] p-4 text-sm text-[#64748b]">{t("noRounds")}</p>
                )}
              </GroupFocusPanel>
              <div className="flex justify-end">
                <GroupFocusButton variant="secondary" onClick={onBack}>{t("backToRooms")}</GroupFocusButton>
              </div>
            </div>
          )}
          {status === "ready" && !summary && (
            <GroupFocusError message={t("summaryError")} onRetry={onRetry} retryLabel={t("retrySummary")} />
          )}
        </div>
      </div>
    </GroupFocusShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#dbeafe] bg-[#f8fafc] p-4 sm:p-5">
      <p className="text-xs leading-5 text-[#64748b]">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[#334155] tabular-nums" dir="ltr">{value}</p>
    </div>
  );
}