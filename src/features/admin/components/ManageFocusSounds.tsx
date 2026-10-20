import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Headphones,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import type { FocusSharedSound } from "../../focus-audio/types";
import {
  deleteOwnerFocusSound,
  listOwnerFocusSounds,
  reorderOwnerFocusSounds,
  updateOwnerFocusSound,
  uploadOwnerFocusSound,
} from "../../focus-audio/adminApi";

export default function ManageFocusSounds({ language }: { language: "ar" | "en" }) {
  const isRtl = language === "ar";
  const [sounds, setSounds] = useState<FocusSharedSound[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const copy = useMemo(() => isRtl ? {
    title: "مكتبة أصوات التركيز",
    subtitle: "أضف وأدر الأصوات المشتركة التي تظهر للطلاب داخل Focus Audio. تبقى ملفاتهم المحلية خاصة بأجهزتهم.",
    upload: "رفع صوت جديد",
    name: "اسم الصوت",
    choose: "اختيار ملف صوتي",
    noFile: "لم يتم اختيار ملف",
    save: "رفع الصوت",
    empty: "لا توجد أصوات مشتركة بعد. لن تظهر أي عناصر وهمية للطلاب.",
    enabled: "مفعّل",
    disabled: "معطّل",
    rename: "حفظ الاسم",
    delete: "حذف",
    preview: "معاينة",
    stop: "إيقاف",
    reload: "تحديث",
    uploaded: "تم رفع الصوت بنجاح.",
    updated: "تم تحديث مكتبة الأصوات.",
    failed: "تعذر تحديث مكتبة أصوات التركيز.",
  } : {
    title: "Focus Sounds Library",
    subtitle: "Upload and manage shared sounds shown inside Focus Audio. Students' local files stay private on their devices.",
    upload: "Upload a new sound",
    name: "Sound name",
    choose: "Choose audio file",
    noFile: "No file selected",
    save: "Upload sound",
    empty: "No shared sounds yet. Students will not see placeholder tracks.",
    enabled: "Enabled",
    disabled: "Disabled",
    rename: "Save name",
    delete: "Delete",
    preview: "Preview",
    stop: "Stop",
    reload: "Refresh",
    uploaded: "Sound uploaded successfully.",
    updated: "Focus Sounds library updated.",
    failed: "Focus Sounds library could not be updated.",
  }, [isRtl]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listOwnerFocusSounds();
      setSounds(rows);
      setEditing(Object.fromEntries(rows.map((row) => [row.id, row.name])));
    } catch {
      setError(copy.failed);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => {
      previewAudioRef.current?.pause();
      previewAudioRef.current = null;
    };
  }, []);

  const upload = async () => {
    if (!file || !name.trim()) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await uploadOwnerFocusSound({ name: name.trim(), file });
      setName("");
      setFile(null);
      setSuccess(copy.uploaded);
      await load();
    } catch {
      setError(copy.failed);
    } finally {
      setBusy(false);
    }
  };

  const patch = async (sound: FocusSharedSound, change: { name?: string; isEnabled?: boolean }) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await updateOwnerFocusSound(sound.id, change);
      setSuccess(copy.updated);
      await load();
    } catch {
      setError(copy.failed);
    } finally {
      setBusy(false);
    }
  };

  const move = async (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= sounds.length) return;
    const reordered = [...sounds];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setSounds(reordered);
    setBusy(true);
    try {
      await reorderOwnerFocusSounds(reordered.map((row) => row.id));
      setSuccess(copy.updated);
    } catch {
      setError(copy.failed);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (sound: FocusSharedSound) => {
    if (!window.confirm(isRtl ? `حذف «${sound.name}» نهائيًا؟` : `Delete “${sound.name}” permanently?`)) return;
    setBusy(true);
    setError(null);
    try {
      if (previewId === sound.id) {
        previewAudioRef.current?.pause();
        previewAudioRef.current = null;
        setPreviewId(null);
      }
      await deleteOwnerFocusSound(sound.id);
      await load();
    } catch {
      setError(copy.failed);
    } finally {
      setBusy(false);
    }
  };

  const togglePreview = (sound: FocusSharedSound) => {
    if (previewId === sound.id && previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
      setPreviewId(null);
      return;
    }
    previewAudioRef.current?.pause();
    const audio = new Audio(sound.playbackUrl);
    audio.volume = 0.5;
    audio.onended = () => setPreviewId(null);
    audio.onerror = () => setPreviewId(null);
    previewAudioRef.current = audio;
    setPreviewId(sound.id);
    void audio.play().catch(() => setPreviewId(null));
  };

  return (
    <section dir={isRtl ? "rtl" : "ltr"} className="space-y-5">
      <div className="rounded-[28px] border border-sky-100 bg-gradient-to-br from-white via-sky-50/80 to-blue-50/60 p-5 shadow-[0_16px_42px_rgba(52,98,152,0.08)] dark:border-white/10 dark:from-white/[0.06] dark:via-white/[0.035] dark:to-blue-300/[0.04] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-blue-500 text-white shadow-[0_8px_20px_rgba(59,130,246,0.24)]">
              <Headphones className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-xl font-bold text-slate-950 dark:text-white">{copy.title}</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">{copy.subtitle}</p>
            </div>
          </div>
          <button type="button" disabled={loading || busy} onClick={() => void load()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-sky-100 bg-white/75 px-3 text-sm font-semibold text-slate-700 shadow-sm transition active:scale-[0.97] disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-200">
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> {copy.reload}
          </button>
        </div>

        <div className="mt-5 rounded-[22px] border border-sky-100/80 bg-white/72 p-4 dark:border-white/10 dark:bg-white/[0.035]">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{copy.upload}</h3>
          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
            <label className="min-w-0">
              <span className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">{copy.name}</span>
              <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-white/10 dark:bg-white/[0.05] dark:text-white dark:focus:ring-blue-400/15" />
            </label>
            <label className="min-w-0">
              <span className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">{copy.choose}</span>
              <span className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-200">
                <Music2 className="size-4 shrink-0 text-blue-500" />
                <span className="min-w-0 flex-1 truncate" dir="auto">{file?.name ?? copy.noFile}</span>
                <input type="file" accept="audio/*" className="sr-only" onChange={(e) => {
                  const next = e.target.files?.[0] ?? null;
                  setFile(next);
                  if (next && !name.trim()) setName(next.name.replace(/\.[^.]+$/, "").slice(0, 80));
                }} />
              </span>
            </label>
            <button type="button" disabled={busy || !file || !name.trim()} onClick={() => void upload()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(59,130,246,0.20)] transition active:scale-[0.97] disabled:opacity-45">
              <Upload className="size-4" /> {copy.save}
            </button>
          </div>
        </div>
      </div>

      {error && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-300/15 dark:bg-rose-300/[0.06] dark:text-rose-200">{error}</div>}
      {success && <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-300/15 dark:bg-emerald-300/[0.06] dark:text-emerald-200">{success}</div>}

      <div className="space-y-3">
        {!loading && sounds.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-sky-200 bg-sky-50/55 p-8 text-center text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.025] dark:text-slate-400">{copy.empty}</div>
        ) : sounds.map((sound, index) => (
          <article key={sound.id} className="rounded-[24px] border border-slate-200/80 bg-white/82 p-4 shadow-[0_12px_30px_rgba(36,62,97,0.06)] backdrop-blur dark:border-white/10 dark:bg-white/[0.04]">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <button type="button" onClick={() => togglePreview(sound)} className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 transition active:scale-[0.94] dark:bg-blue-400/10 dark:text-blue-300" aria-label={previewId === sound.id ? copy.stop : copy.preview}>
                  {previewId === sound.id ? <Pause className="size-5" /> : <Play className="size-5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <input value={editing[sound.id] ?? sound.name} maxLength={80} onChange={(e) => setEditing((prev) => ({ ...prev, [sound.id]: e.target.value }))} className="w-full rounded-lg border-0 bg-transparent px-1 py-1 text-base font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-blue-100 dark:text-white dark:focus:ring-blue-400/15" />
                  <p className="mt-1 text-xs text-slate-400"><bdi dir="ltr">{(sound.sizeBytes / 1024 / 1024).toFixed(1)} MB</bdi> · {sound.mimeType}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy || (editing[sound.id] ?? sound.name).trim() === sound.name} onClick={() => void patch(sound, { name: (editing[sound.id] ?? sound.name).trim() })} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition active:scale-[0.97] disabled:opacity-40 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-200"><Save className="size-3.5" /> {copy.rename}</button>
                <button type="button" disabled={busy} onClick={() => void patch(sound, { isEnabled: !sound.isEnabled })} className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition active:scale-[0.97] ${sound.isEnabled ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/15 dark:bg-emerald-300/[0.06] dark:text-emerald-200" : "border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400"}`}><Check className="size-3.5" /> {sound.isEnabled ? copy.enabled : copy.disabled}</button>
                <button type="button" disabled={busy || index === 0} onClick={() => void move(index, -1)} className="flex size-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 disabled:opacity-30 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300"><ArrowUp className="size-4" /></button>
                <button type="button" disabled={busy || index === sounds.length - 1} onClick={() => void move(index, 1)} className="flex size-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 disabled:opacity-30 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300"><ArrowDown className="size-4" /></button>
                <button type="button" disabled={busy} onClick={() => void remove(sound)} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition active:scale-[0.97] disabled:opacity-40 dark:border-rose-300/15 dark:bg-rose-300/[0.06] dark:text-rose-200"><Trash2 className="size-3.5" /> {copy.delete}</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
