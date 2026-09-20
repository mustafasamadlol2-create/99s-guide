import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, FileUp, Loader2, Upload, X } from "lucide-react";
import { cancelCalendarImportJob, createCalendarImportJob, commitCalendarImportJob, updateCalendarImportReview } from "./api";
import { useCalendarImportJob } from "./useCalendarImportJob";
import { CalendarImportCandidate } from "./types";
import { useTranslation } from "../../../core/i18n/translations";
import { CALENDAR_TARGET_GROUPS } from "../../../../shared/calendarContracts";

interface Props {
  language?: "en" | "ar";
  onImported?: () => void;
}

const terminal = (status?: string) => ["COMPLETED", "FAILED", "CANCELLED"].includes((status || "").toUpperCase());
const initialGroups = ["ALL"];
export default function CalendarScheduleImporter({ language = "en", onImported }: Props) {
  const { t } = useTranslation(language);
  const copy = {
    title: t("calendarImportTitle"),
    help: t("calendarImportHelp"),
    choose: t("calendarImportChoose"),
    groups: t("calendarImportGroups"),
    upload: t("calendarImportUpload"),
    processing: t("calendarImportProcessing"),
    review: t("calendarImportReview"),
    confirm: t("calendarImportConfirm"),
    allDay: t("calendarImportAllDay"),
    invalid: t("calendarImportInvalid"),
    source: t("calendarImportSource"),
    image: t("calendarImportImage"),
    imported: t("calendarImportImported"),
    failed: t("calendarImportFailed"),
    noEvents: t("calendarImportNoEvents"),
    untitled: t("calendarImportUntitled"),
  };
  const rtl = language === "ar";
  const [files, setFiles] = useState<File[]>([]);
  const [groups, setGroups] = useState(initialGroups);
  const [jobId, setJobId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CalendarImportCandidate[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { job, error: pollingError } = useCalendarImportJob(jobId);

  useEffect(() => {
    if (!job) return;
    if (job.preview?.candidates) setCandidates(job.preview.candidates.map((candidate) => ({
      ...candidate,
      selected: candidate.selected ?? candidate.status === "VERIFIED",
    })));
    if (job.status === "FAILED") setMessage(job.error?.message || copy.failed);
  }, [job, language, copy.failed]);

  const selectable = useMemo(() => candidates.filter((c) => c.status !== "INVALID" && c.status !== "DUPLICATE"), [candidates]);
  const processing = Boolean(jobId && job && !terminal(job.status) && job.status !== "READY_FOR_REVIEW");
  const review = Boolean(job && (job.status === "READY_FOR_REVIEW" || candidates.length > 0));

  const toggleGroup = (group: string) => setGroups((current) => {
    if (group === "ALL") return ["ALL"];
    const next = current.filter((item) => item !== "ALL");
    if (next.includes(group)) next.splice(next.indexOf(group), 1);
    else next.push(group);
    return next.length ? next : ["ALL"];
  });

  const submit = async () => {
    if (files.length === 0) return;
    setBusy(true); setMessage(null);
    try {
      const created = await createCalendarImportJob({ files, targetGroups: groups, language });
      setJobId(created.id);
      if (created.preview?.candidates) setCandidates(created.preview.candidates);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : copy.failed);
    } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!jobId) return;
    setBusy(true); setMessage(null);
    try {
      await updateCalendarImportReview(jobId, candidates);
      const result = await commitCalendarImportJob(
        jobId,
        candidates
          .filter((candidate) => candidate.selected && candidate.status !== "INVALID" && candidate.status !== "DUPLICATE")
          .map((candidate) => candidate.candidateId),
      );
      setMessage(`${result.inserted} ${copy.imported}`);
      onImported?.();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : copy.failed);
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!jobId) return;
    setBusy(true);
    try {
      await cancelCalendarImportJob(jobId);
    } finally {
      reset();
      setBusy(false);
    }
  };

  const reset = () => { setFiles([]); setJobId(null); setCandidates([]); setMessage(null); };
  return (
    <section dir={rtl ? "rtl" : "ltr"} className="space-y-4 rounded-xl border border-rose-500/20 bg-rose-500/[0.03] p-4">
      <div className="flex items-start gap-3">
        <FileUp className="mt-1 h-5 w-5 shrink-0 text-rose-500" />
        <div><h3 className="font-semibold text-neutral-900 dark:text-white">{copy.title}</h3><p className="text-sm text-neutral-500 dark:text-[#EBEBF599]">{copy.help}</p></div>
      </div>
      {!jobId && <div className="space-y-3">
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-neutral-300 p-3 text-sm dark:border-white/20">
          <Upload className="h-4 w-4" /> <span>{files.length ? files.map((file) => file.name).join(", ") : copy.choose}</span>
          <input type="file" multiple accept=".pdf,image/png,image/jpeg,image/webp,image/heic,image/heif" className="sr-only" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        </label>
        <div><p className="mb-1 text-xs font-semibold">{copy.groups}</p><div className="flex flex-wrap gap-2">
           {CALENDAR_TARGET_GROUPS.map((group) => <button type="button" key={group} onClick={() => toggleGroup(group)} className={`rounded-md px-3 py-1 text-xs ${groups.includes(group) ? "bg-rose-500 text-white" : "bg-neutral-200 dark:bg-white/10"}`}>{group}</button>)}
        </div></div>
        <button type="button" disabled={!files.length || busy} onClick={submit} className="flex w-full items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{copy.upload}</button>
      </div>}
      {jobId && processing && <div className="flex items-center gap-2 py-3 text-sm"><Loader2 className="h-4 w-4 animate-spin text-rose-500" />{job?.stage || copy.processing}{job && job.progressTotal > 0 ? ` (${Math.round((job.progressCurrent / job.progressTotal) * 100)}%)` : ""}<button type="button" disabled={busy} onClick={cancel} className="ms-auto rounded border px-2 py-1 text-xs">{t("calendarImportCancel")}</button></div>}
      {(pollingError || message) && <div className="flex items-start gap-2 rounded-md bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/20 dark:text-rose-300"><AlertCircle className="h-4 w-4 shrink-0" />{pollingError || message}</div>}
      {review && <div className="space-y-3">
        <h4 className="font-semibold">{copy.review}</h4>
        {selectable.length === 0 && <p className="text-sm text-neutral-500">{copy.noEvents}</p>}
        {candidates.map((candidate, index) => {
          const invalid = candidate.status === "INVALID";
          return <label key={candidate.candidateId || index} className={`flex gap-3 rounded-lg border p-3 ${invalid ? "opacity-60" : ""}`}>
            <input type="checkbox" disabled={invalid || candidate.status === "DUPLICATE"} checked={!invalid && candidate.status !== "DUPLICATE" && candidate.selected} onChange={(e) => setCandidates((current) => current.map((item) => item.candidateId === candidate.candidateId ? { ...item, selected: e.target.checked } : item))} />
            <span className="min-w-0 flex-1 space-y-2">
              <span className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input aria-label={copy.title} className="min-w-0 rounded border bg-transparent px-2 py-1 text-sm" value={candidate.title ?? ""} onChange={(e) => setCandidates((current) => current.map((item) => item.candidateId === candidate.candidateId ? { ...item, title: e.target.value } : item))} />
                <select aria-label="Event type" className="rounded border bg-transparent px-2 py-1 text-sm" value={candidate.eventType ?? ""} onChange={(e) => setCandidates((current) => current.map((item) => item.candidateId === candidate.candidateId ? { ...item, eventType: e.target.value || null } : item))}>
                  <option value="">—</option><option value="LECTURE">LECTURE</option><option value="QUIZ">QUIZ</option><option value="EXAM">EXAM</option><option value="TASK">TASK</option><option value="PERSONAL">PERSONAL</option><option value="HOLIDAY">HOLIDAY</option>
                </select>
                <input aria-label="Date" type="date" className="rounded border bg-transparent px-2 py-1 text-sm" value={candidate.date ?? ""} onChange={(e) => setCandidates((current) => current.map((item) => item.candidateId === candidate.candidateId ? { ...item, date: e.target.value || null } : item))} />
                {!candidate.allDay && <span className="flex gap-2"><input aria-label="Start time" type="time" className="min-w-0 flex-1 rounded border bg-transparent px-2 py-1 text-sm" value={candidate.startTime ?? ""} onChange={(e) => setCandidates((current) => current.map((item) => item.candidateId === candidate.candidateId ? { ...item, startTime: e.target.value || null } : item))} /><input aria-label="End time" type="time" className="min-w-0 flex-1 rounded border bg-transparent px-2 py-1 text-sm" value={candidate.endTime ?? ""} onChange={(e) => setCandidates((current) => current.map((item) => item.candidateId === candidate.candidateId ? { ...item, endTime: e.target.value || null } : item))} /></span>}
              </span>
              <span className="block text-xs text-neutral-500">{candidate.date || "—"}{candidate.allDay ? ` · ${copy.allDay}` : candidate.startTime ? ` · ${candidate.startTime}${candidate.endTime ? `–${candidate.endTime}` : ""}` : ""}</span>
              {candidate.sourcePage !== null && <span className="block text-xs text-neutral-500">{copy.source}: {candidate.sourcePage}</span>}
              {candidate.sourceImageIndex !== null && <span className="block text-xs text-neutral-500">{copy.image}: {candidate.sourceImageIndex + 1}</span>}
              {candidate.warnings.map((warning) => <span key={warning} className="block text-xs text-amber-700">{warning}</span>)}
              {candidate.verification.issues.map((issue) => <span key={issue} className="block text-xs text-amber-700">{issue}</span>)}
              {candidate.sourceEvidence && <details className="text-xs text-neutral-500"><summary className="cursor-pointer">{copy.source}</summary><span className="mt-1 block whitespace-pre-wrap">{candidate.sourceEvidence}</span></details>}
            </span>
            <span className="text-xs font-semibold">{invalid ? copy.invalid : candidate.status}</span>
          </label>;
        })}
        <div className="flex gap-2"><button type="button" disabled={busy || selectable.every((c) => !c.selected)} onClick={confirm} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Check className="h-4 w-4" />{copy.confirm}</button><button type="button" onClick={reset} className="rounded-lg border px-3 py-2 text-sm"><X className="h-4 w-4" /></button></div>
      </div>}
    </section>
  );
}