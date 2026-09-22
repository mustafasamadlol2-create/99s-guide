import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, CheckCircle2, FileText, Loader2, Trash2, UploadCloud, X } from "lucide-react";
import {
  MODULE_RESOURCE_LABELS,
  MODULE_RESOURCE_MODULES,
  MAX_MODULE_RESOURCE_PDF_BYTES,
  MODULE_RESOURCE_TITLE_MAX_LENGTH,
  type ModuleResourceModuleId,
} from "../../../../shared/moduleResources";
import {
  abortModuleResourceUpload,
  deleteModuleResource,
  formatModuleResourceSize,
  listModuleResources,
  uploadModuleResource,
  type ModuleResource,
  type ModuleResourceUploadStage,
} from "../moduleResourcesApi";

interface UploadModuleResourceProps {
  language: "en" | "ar";
  onSuccess?: () => void;
}

const stageLabel: Record<ModuleResourceUploadStage, { en: string; ar: string }> = {
  preparing: { en: "Preparing upload", ar: "جارٍ تجهيز الرفع" },
  uploading: { en: "Uploading", ar: "جارٍ الرفع" },
  verifying: { en: "Verifying PDF", ar: "جارٍ التحقق من PDF" },
  saving: { en: "Saving resource", ar: "جارٍ حفظ المصدر" },
  completed: { en: "Completed", ar: "اكتمل" },
  cancelled: { en: "Cancelled", ar: "تم الإلغاء" },
  error: { en: "Upload failed", ar: "فشل الرفع" },
};

function formatDate(value: string, language: "en" | "ar"): string {
  return new Intl.DateTimeFormat(language === "ar" ? "ar-IQ" : "en", {
    dateStyle: "medium",
  }).format(new Date(value));
}

export default function UploadModuleResource({
  language,
  onSuccess,
}: UploadModuleResourceProps) {
  const isRtl = language === "ar";
  const [moduleId, setModuleId] = useState<ModuleResourceModuleId>("CA");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [resources, setResources] = useState<ModuleResource[]>([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const [stage, setStage] = useState<ModuleResourceUploadStage | "idle">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadResources = useCallback(async () => {
    setLoadingResources(true);
    try {
      setResources(await listModuleResources(moduleId));
    } catch (loadError: any) {
      setError(loadError?.message || (isRtl ? "تعذر تحميل المصادر." : "Could not load resources."));
    } finally {
      setLoadingResources(false);
    }
  }, [isRtl, moduleId]);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  const chooseFile = (candidate: File | null) => {
    if (!candidate) return;
    if (
      candidate.type !== "application/pdf" &&
      !candidate.name.toLowerCase().endsWith(".pdf")
    ) {
      setError(isRtl ? "يُسمح بملفات PDF فقط." : "PDF files only.");
      return;
    }
    if (candidate.size <= 0 || candidate.size > MAX_MODULE_RESOURCE_PDF_BYTES) {
      setError(isRtl ? "حجم الملف يتجاوز الحد الأقصى 5 جيجابايت." : "File exceeds the 5 GiB limit.");
      return;
    }
    setError("");
    setFile(candidate);
  };

  const resetForm = () => {
    setFile(null);
    setTitle("");
    setProgress(0);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleUpload = async () => {
    if (!file || !title.trim()) {
      setError(isRtl ? "أدخل عنوان المصدر واختر ملف PDF." : "Enter a title and choose a PDF.");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    setStage("preparing");
    setProgress(0);
    try {
      await uploadModuleResource(
        file,
        moduleId,
        title,
        controller.signal,
        setStage,
        (uploaded, total) => setProgress(Math.min(100, Math.round((uploaded / total) * 100))),
      );
      setStage("completed");
      resetForm();
      await loadResources();
      onSuccess?.();
    } catch (uploadError: any) {
      if (uploadError?.name === "AbortError") {
        setStage("cancelled");
      } else {
        setStage("error");
        setError(uploadError?.message || (isRtl ? "فشل رفع المصدر." : "Upload failed."));
      }
    } finally {
      abortRef.current = null;
    }
  };

  const cancelUpload = () => {
    abortRef.current?.abort();
  };

  const handleDelete = async (resource: ModuleResource) => {
    const confirmed = window.confirm(
      isRtl
        ? `حذف "${resource.title}"؟\nسيؤدي ذلك إلى إزالة ملف PDF نهائياً.`
        : `Delete "${resource.title}"?\nThis permanently removes the Resource PDF.`,
    );
    if (!confirmed) return;
    try {
      await deleteModuleResource(resource.id);
      setResources((current) => current.filter((item) => item.id !== resource.id));
    } catch (deleteError: any) {
      setError(deleteError?.message || (isRtl ? "تعذر حذف المصدر." : "Could not delete the resource."));
    }
  };

  const busy = stage !== "idle" && stage !== "completed" && stage !== "cancelled" && stage !== "error";
  const selectedLabel = MODULE_RESOURCE_LABELS[moduleId][language === "ar" ? "ar" : "en"];

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className="space-y-5">
      <div>
        <h3 className="flex items-center gap-2 text-lg font-display font-semibold text-neutral-900 dark:text-white">
          <BookOpen className="h-5 w-5 text-rose-500" />
          {isRtl ? "مصادر الموديولات" : "Module Resources"}
        </h3>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {isRtl ? "ارفع ملفات PDF خاصة بالموديول، بحد أقصى 5 جيجابايت." : "Upload private module PDFs up to 5 GiB."}
        </p>
      </div>

      <div className="rounded-2xl border border-neutral-200/70 bg-neutral-50/70 p-4 dark:border-white/[0.10] dark:bg-white/[0.03]">
        <div className="grid gap-4 md:grid-cols-[minmax(180px,0.7fr)_minmax(220px,1fr)]">
          <label className="space-y-1.5 text-sm font-medium text-neutral-700 dark:text-neutral-200">
            <span>{isRtl ? "اختيار الموديول" : "Select Module"}</span>
            <select
              value={moduleId}
              onChange={(event) => setModuleId(event.target.value as ModuleResourceModuleId)}
              disabled={busy}
              className="h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-rose-400 dark:border-white/[0.12] dark:bg-[#111317]"
            >
              {MODULE_RESOURCE_MODULES.map((id) => (
                <option key={id} value={id}>
                  {id} — {MODULE_RESOURCE_LABELS[id][language === "ar" ? "ar" : "en"]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-sm font-medium text-neutral-700 dark:text-neutral-200">
            <span>{isRtl ? "عنوان المصدر" : "Resource Title"}</span>
            <input
              value={title}
              maxLength={MODULE_RESOURCE_TITLE_MAX_LENGTH}
              onChange={(event) => setTitle(event.target.value)}
              disabled={busy}
              placeholder={isRtl ? "مثال: مرجع الرعاية الصحية الأولية" : "e.g. Primary Health Care Reference"}
              className="h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none placeholder:text-neutral-400 focus:border-rose-400 dark:border-white/[0.12] dark:bg-[#111317]"
            />
          </label>
        </div>

        <div
          role="button"
          tabIndex={busy ? -1 : 0}
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(event) => {
            if (!busy && (event.key === "Enter" || event.key === " ")) inputRef.current?.click();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!busy) chooseFile(event.dataTransfer.files?.[0] || null);
          }}
          className={`mt-4 flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 text-center transition ${
            dragging ? "border-rose-400 bg-rose-50 dark:bg-rose-500/10" : "border-neutral-300 bg-white/70 dark:border-white/[0.16] dark:bg-black/10"
          } ${busy ? "cursor-not-allowed opacity-70" : ""}`}
        >
          <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(event) => chooseFile(event.target.files?.[0] || null)} />
          <UploadCloud className="mb-2 h-7 w-7 text-rose-500" />
          <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            {file ? file.name : (isRtl ? "اختر ملف PDF أو اسحبه هنا" : "Choose a PDF or drag it here")}
          </span>
          <span className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {file ? formatModuleResourceSize(file.size) : (isRtl ? "PDF فقط — الحد الأقصى 5 جيجابايت" : "PDF only — maximum 5 GiB")}
          </span>
        </div>

        {busy && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-neutral-600 dark:text-neutral-300">
              <span>{stageLabel[stage as ModuleResourceUploadStage][language === "ar" ? "ar" : "en"]}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-white/[0.10]">
              <div className="h-full rounded-full bg-rose-500 transition-[width]" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {stage === "completed" && (
          <p className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            {isRtl ? "اكتمل رفع المصدر." : "Resource uploaded successfully."}
          </p>
        )}
        {error && <p className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleUpload()}
            disabled={busy || !file || !title.trim()}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-rose-500 px-4 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {isRtl ? "رفع المصدر" : "Upload Resource"}
          </button>
          {busy && (
            <button type="button" onClick={cancelUpload} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-neutral-200 px-4 text-sm font-semibold text-neutral-700 dark:border-white/[0.12] dark:text-neutral-200">
              <X className="h-4 w-4" />
              {isRtl ? "إلغاء" : "Cancel"}
            </button>
          )}
        </div>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="text-base font-semibold text-neutral-900 dark:text-white">
            {isRtl ? `مصادر ${selectedLabel}` : `${selectedLabel} Resources`}
          </h4>
          {loadingResources && <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />}
        </div>
        {resources.length === 0 && !loadingResources ? (
          <div className="rounded-2xl border border-dashed border-neutral-200 p-6 text-center text-sm text-neutral-500 dark:border-white/[0.12] dark:text-neutral-400">
            {isRtl ? "لم تتم إضافة مصادر لهذا الموديول بعد." : "No resources have been added for this module yet."}
          </div>
        ) : (
          <div className="space-y-2">
            {resources.map((resource) => (
              <div key={resource.id} className="flex min-w-0 items-center gap-3 rounded-2xl border border-neutral-200/70 bg-white p-3 dark:border-white/[0.10] dark:bg-white/[0.03]">
                <FileText className="h-5 w-5 shrink-0 text-rose-500" />
                <div className="min-w-0 flex-1">
                  <div className="break-words text-sm font-semibold text-neutral-800 dark:text-white">{resource.title}</div>
                  <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    {formatModuleResourceSize(resource.fileSizeBytes)} · {formatDate(resource.createdAt, language)}
                  </div>
                </div>
                <button type="button" onClick={() => void handleDelete(resource)} className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10" aria-label={isRtl ? "حذف" : "Delete"}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}