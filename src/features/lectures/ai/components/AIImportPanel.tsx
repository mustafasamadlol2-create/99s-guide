import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  FileImage,
  FileText,
  ImagePlus,
  LoaderCircle,
  RefreshCcw,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { apiClient } from "../../../../core/api/apiClient";
import type { Language } from "../../../../core/i18n/translations";
import { useTreeSelection } from "../../../../core/hooks/useTreeSelection";
import type { SubjectId } from "../../../../core/types";
import { aiText } from "../i18n";
import { useAIPreview } from "../hooks/useAIPreview";
import { AIPreviewError } from "../api/aiPreviewApi";
import { isArabicText } from "../validation/reviewValidation";
import { AIReviewStudio } from "./AIReviewStudio";
import type {
  AIMCQCandidate,
  AIFlashcardCandidate,
  AIPreviewInputKind,
  AIPreviewOperation,
  AIPreviewOptions,
  AIPreviewRequest,
  AIPreviewResponse,
  MCQDifficulty,
  MCQCategory,
  MCQQuestionStyle,
} from "../types/aiPreview";

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BATCH_BYTES = 100 * 1024 * 1024;
const MAX_IMAGES = 20;
const MAX_TEXT_BYTES = 1024 * 1024;

interface Lecture {
  id: string;
  name: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function extension(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || extension(file) === "pdf";
}

function isImage(file: File): boolean {
  return ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.type.toLowerCase()) ||
    ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(extension(file));
}

function SourcePreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/") || !URL.createObjectURL) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return (
    <div className="flex min-w-0 items-center gap-2">
      {url ? (
        <img src={url} alt="" className="h-10 w-10 rounded-md border border-neutral-200 object-cover dark:border-white/[0.1]" />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-neutral-100 dark:bg-white/[0.08]">
          {file.type.startsWith("image/") ? <FileImage className="h-5 w-5 text-neutral-500" /> : <FileText className="h-5 w-5 text-rose-500" />}
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-neutral-700 dark:text-neutral-200">{file.name}</p>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{formatBytes(file.size)}</p>
      </div>
    </div>
  );
}

function LectureTargetSelector({
  language,
  lectureId,
  onLectureChange,
}: {
  language: Language;
  lectureId: string;
  onLectureChange: (id: string) => void;
}) {
  const {
    mainSubject,
    subSubject,
    trackMode,
    department,
    setMainSubject,
    setSubSubject,
    setTrackMode,
    setDepartment,
    subSubjectOptions,
    trackModeOptions,
    departmentOptions,
    requiresDepartmentSelection,
    canProceedToLecture,
    treeConfig,
  } = useTreeSelection();
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadLectures = useCallback(async () => {
    if (!canProceedToLecture) {
      setLectures([]);
      onLectureChange("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (mainSubject) params.set("mainSubject", mainSubject);
      if (subSubject) params.set("subSubject", subSubject);
      if (trackMode) params.set("trackMode", trackMode);
      if (department) params.set("department", department);
      const response = await apiClient(`/api/lectures?${params.toString()}`);
      const data = await response.json() as Lecture[];
      if (!response.ok) throw new Error("Unable to load lectures.");
      setLectures(data);
      onLectureChange(data.some((lecture) => lecture.id === lectureId) ? lectureId : (data[0]?.id ?? ""));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load lectures.");
      setLectures([]);
      onLectureChange("");
    } finally {
      setLoading(false);
    }
  }, [canProceedToLecture, department, lectureId, mainSubject, onLectureChange, subSubject, trackMode]);

  useEffect(() => {
    void loadLectures();
  }, [loadLectures]);

  const optionButton = (active: boolean) =>
    `rounded-lg border px-3 py-2 text-start text-xs font-semibold transition ${
      active
        ? "border-rose-500 bg-rose-500 text-white"
        : "border-neutral-200 bg-white text-neutral-700 hover:border-rose-300 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-neutral-200"
    }`;

  return (
    <section className="space-y-3 rounded-xl border border-neutral-200/80 bg-white p-4 dark:border-white/[0.08] dark:bg-[#1C1C1E]/70">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">{aiText(language, "chooseLecture")}</h3>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Select the lecture context required by the preview API.</p>
        </div>
        <button type="button" onClick={() => void loadLectures()} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/[0.08]" aria-label={aiText(language, "reload")}>
          <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
          <span className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">{aiText(language, "chooseSubject")}</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.keys(treeConfig) as SubjectId[]).map((subject) => (
              <button key={subject} type="button" className={optionButton(mainSubject === subject)} onClick={() => setMainSubject(subject)}>
                <span className="font-mono">{subject}</span>
                <span className="ms-1 opacity-80">{treeConfig[subject].name}</span>
              </button>
            ))}
          </div>
        </div>
        {!!subSubjectOptions.length && (
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">{aiText(language, "subSubject")}</span>
            <select value={subSubject ?? ""} onChange={(event) => setSubSubject(event.target.value || null)} className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-white">
              <option value="">—</option>
              {subSubjectOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
        )}
        {!!trackModeOptions.length && (
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">{aiText(language, "track")}</span>
            <select value={trackMode ?? ""} onChange={(event) => setTrackMode(event.target.value || null)} className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-white">
              <option value="">—</option>
              {trackModeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
        )}
        {requiresDepartmentSelection && (
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">{aiText(language, "department")}</span>
            <select value={department ?? ""} onChange={(event) => setDepartment(event.target.value || null)} className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-white">
              <option value="">—</option>
              {departmentOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
        )}
      </div>
      {canProceedToLecture && (
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400" htmlFor="ai-target-lecture">{aiText(language, "chooseLecture")}</label>
          {loading ? <div className="h-10 animate-pulse rounded-lg bg-neutral-100 dark:bg-white/[0.06]" /> : (
            <select id="ai-target-lecture" value={lectureId} onChange={(event) => onLectureChange(event.target.value)} className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 outline-none focus:border-rose-400 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-white">
              <option value="">{lectures.length ? "—" : aiText(language, "noLectures")}</option>
              {lectures.map((lecture) => <option key={lecture.id} value={lecture.id}>{lecture.name}</option>)}
            </select>
          )}
        </div>
      )}
      {error && <p className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-300"><AlertCircle className="h-3.5 w-3.5" />{error}</p>}
    </section>
  );
}

function OperationSelector({
  language,
  target,
  operation,
  onChange,
}: {
  language: Language;
  target: "mcq" | "flashcard";
  operation: AIPreviewOperation;
  onChange: (operation: AIPreviewOperation) => void;
}) {
  const options: Array<[AIPreviewOperation, string, string]> = target === "mcq"
    ? [
      ["extract", aiText(language, "extractMcq"), aiText(language, "extractDescription")],
      ["generate", aiText(language, "generateMcq"), aiText(language, "generateDescription")],
      ["enhance", aiText(language, "enhanceMcq"), aiText(language, "enhanceDescription")],
    ]
    : [
      ["extract", aiText(language, "extractFlashcards"), aiText(language, "extractDescription")],
      ["generate", aiText(language, "generateFlashcards"), aiText(language, "generateDescription")],
      ["enhance", aiText(language, "enhanceFlashcards"), aiText(language, "enhanceDescription")],
    ];
  return (
    <section className="space-y-3 rounded-xl border border-neutral-200/80 bg-white p-4 dark:border-white/[0.08] dark:bg-[#1C1C1E]/70">
      <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">{aiText(language, "operation")}</h3>
      <div className="grid gap-2 md:grid-cols-3">
        {options.map(([value, label, description]) => (
          <button key={value} type="button" onClick={() => onChange(value)} className={`rounded-lg border p-3 text-start transition ${operation === value ? "border-rose-400 bg-rose-50/70 dark:border-rose-400/60 dark:bg-rose-400/[0.08]" : "border-neutral-200 hover:border-rose-300 dark:border-white/[0.1] dark:hover:border-rose-400/40"}`} aria-pressed={operation === value}>
            <span className="block text-sm font-semibold text-neutral-800 dark:text-white">{label}</span>
            <span className="mt-1 block text-xs leading-5 text-neutral-500 dark:text-neutral-400">{description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function AIImportModeSelector({
  language,
  mode,
  onChange,
}: {
  language: Language;
  mode: "manual" | "ai";
  onChange: (mode: "manual" | "ai") => void;
}) {
  return (
    <div role="tablist" aria-label={language === "ar" ? "طريقة الإنشاء" : "Creation method"} className="mb-5 flex w-full max-w-md rounded-xl border border-neutral-200 bg-neutral-100/80 p-1 dark:border-white/[0.1] dark:bg-white/[0.05]">
      {(["manual", "ai"] as const).map((value) => (
        <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => onChange(value)} className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${mode === value ? "bg-white text-neutral-900 shadow-sm dark:bg-[#2C2C2E] dark:text-white" : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-white"}`}>
          {value === "manual" ? aiText(language, "manual") : aiText(language, "aiImport")}
        </button>
      ))}
    </div>
  );
}

export default function AIImportPanel({
  language,
  target,
}: {
  language: Language;
  target: "mcq" | "flashcard";
}) {
  const [lectureId, setLectureId] = useState("");
  const [operation, setOperation] = useState<AIPreviewOperation>("extract");
  const [inputKind, setInputKind] = useState<AIPreviewInputKind>("text");
  const [text, setText] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState<AIPreviewResponse<AIMCQCandidate | AIFlashcardCandidate> | null>(null);
  const [mcqCount, setMcqCount] = useState(20);
  const [mcqCategory, setMcqCategory] = useState<MCQCategory>("AI_GENERATED");
  const [mcqExtractDifficulty, setMcqExtractDifficulty] = useState<Exclude<MCQDifficulty, "mixed">>("Medium");
  const [mcqStyle, setMcqStyle] = useState<MCQQuestionStyle>("mixed");
  const [includeHints, setIncludeHints] = useState(true);
  const [includeExplanations, setIncludeExplanations] = useState(true);
  const [enhanceHint, setEnhanceHint] = useState(false);
  const [enhanceExplanation, setEnhanceExplanation] = useState(false);
  const [flashcardCount, setFlashcardCount] = useState(20);
  const [focus, setFocus] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { stage, isBusy, error, submit, cancel, clearError } = useAIPreview();

  const sourceHasContent = inputKind === "text" ? Boolean(text.trim()) : inputKind === "pdf" ? Boolean(pdf) : images.length > 0;
  const stageLabel = stage === "preparing" ? aiText(language, "preparing") : stage === "analyzing" ? aiText(language, "analyzing") : aiText(language, "structuring");

  const resetSource = useCallback(() => {
    setText("");
    setPdf(null);
    setImages([]);
    setMessage("");
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const changeInputKind = (next: AIPreviewInputKind) => {
    if (next === inputKind) return;
    if (sourceHasContent && !window.confirm(language === "ar" ? "سيؤدي تغيير المصدر إلى مسح المحتوى الحالي. هل تريد المتابعة؟" : "Changing source type will clear the current source. Continue?")) return;
    resetSource();
    setInputKind(next);
  };

  const acceptFiles = (incoming: File[]) => {
    clearError();
    if (inputKind === "pdf") {
      const file = incoming[0];
      if (!file || !isPdf(file)) {
        setMessage(language === "ar" ? "يرجى اختيار ملف PDF صالح." : "Please choose a valid PDF file.");
      } else if (file.size > MAX_PDF_BYTES) {
        setMessage(language === "ar" ? "يجب ألا يتجاوز ملف PDF حجم 50 ميغابايت." : "PDF files must be 50 MiB or smaller.");
      } else {
        setPdf(file);
        setMessage("");
      }
      return;
    }
    const invalid = incoming.find((file) => !isImage(file) || file.size > MAX_IMAGE_BYTES);
    const next = [...images, ...incoming.filter((file) => isImage(file) && file.size <= MAX_IMAGE_BYTES)];
    const total = next.reduce((sum, file) => sum + file.size, 0);
    if (invalid) {
      setMessage(language === "ar" ? "توجد صورة غير مدعومة أو تتجاوز 20 ميغابايت." : "One or more images are unsupported or exceed 20 MiB.");
      return;
    }
    if (next.length > MAX_IMAGES) {
      setMessage(language === "ar" ? "الحد الأقصى هو 20 صورة." : "A maximum of 20 images is allowed.");
      return;
    }
    if (total > MAX_IMAGE_BATCH_BYTES) {
      setMessage(language === "ar" ? "يجب ألا يتجاوز مجموع الصور 100 ميغابايت." : "The image batch must be 100 MiB or smaller.");
      return;
    }
    setImages(next);
    setMessage("");
  };

  const removeImage = (index: number) => setImages((files) => files.filter((_, fileIndex) => fileIndex !== index));

  const options = useMemo<AIPreviewOptions>(() => {
    if (target === "mcq") {
      // Keep extraction payload backwards-compatible with already-deployed AI routes.
      // Category/difficulty are local review metadata and are applied to returned
      // candidates below, so they do not need to be sent to the model endpoint.
      if (operation === "extract") return {} as Record<string, never>;
      if (operation === "generate") return {
        count: mcqCount,
        difficulty: "mixed",
        questionStyle: mcqStyle,
        includeHints,
        includeExplanations,
      };
      // Older deployed enhancement routes only accept hint/explanation. Keep the
      // wire contract minimal; review metadata is applied after the response.
      return {
        hint: enhanceHint,
        explanation: enhanceExplanation,
      };
    }
    if (operation === "generate") return { count: flashcardCount, focus: focus.trim() || null };
    if (operation === "enhance") return { explanation: true as const };
    return {} as Record<string, never>;
  }, [enhanceExplanation, enhanceHint, focus, flashcardCount, includeExplanations, includeHints, mcqCategory, mcqCount, mcqExtractDifficulty, mcqStyle, operation, target]);

  const handleSubmit = async () => {
    setMessage("");
    clearError();
    if (!lectureId) return setMessage(language === "ar" ? "يرجى اختيار المحاضرة المستهدفة." : "Choose a target lecture first.");
    if (!sourceHasContent) return setMessage(language === "ar" ? "يرجى إضافة مصدر قبل المتابعة." : "Add a source before continuing.");
    if (inputKind === "text" && new TextEncoder().encode(text).length > MAX_TEXT_BYTES) return setMessage(language === "ar" ? "حجم النص يتجاوز 1 ميغابايت." : "Pasted text must be 1 MiB or smaller.");
    if (target === "mcq" && operation === "enhance" && !enhanceHint && !enhanceExplanation) return setMessage(language === "ar" ? "اختر حقلاً واحداً على الأقل للتحسين." : "Choose at least one field to enhance.");
    if (target === "mcq" && operation === "generate" && (!Number.isInteger(mcqCount) || mcqCount < 1 || mcqCount > 100)) return setMessage("Question count must be between 1 and 100.");
    if (target === "flashcard" && operation === "generate" && (!Number.isInteger(flashcardCount) || flashcardCount < 1 || flashcardCount > 100)) return setMessage("Card count must be between 1 and 100.");

    const request: AIPreviewRequest = {
      target,
      lectureId,
      operation,
      options,
      source: inputKind === "text"
        ? { inputKind, text }
        : inputKind === "pdf"
          ? { inputKind, file: pdf ?? undefined }
          : { inputKind, files: images },
    };
    const result = await submit(request);
    if (result) {
      if (target === "mcq") {
        const category = operation === "generate" ? "AI_GENERATED" : mcqCategory;
        const reviewDifficulty = operation === "generate" ? null : mcqExtractDifficulty;
        setResponse({
          ...result,
          result: {
            ...result.result,
            items: result.result.items.map((item) =>
              "question" in item
                ? {
                    ...item,
                    category,
                    ...(reviewDifficulty ? { difficulty: reviewDifficulty } : {}),
                  }
                : item,
            ),
          },
        } as AIPreviewResponse<AIMCQCandidate | AIFlashcardCandidate>);
      } else {
        setResponse(result);
      }
    }
  };

  const friendlyError = (caught: AIPreviewError | null): string => {
    if (!caught) return "";
    if (caught.code === "APP_AI_RATE_LIMIT" || caught.code === "AI_RATE_LIMITED") return language === "ar" ? "طلبات الذكاء الاصطناعي كثيرة حالياً. يرجى المحاولة بعد قليل." : "Too many AI requests. Try again after the indicated wait.";
    if (caught.code === "AI_OPERATION_IN_PROGRESS") return language === "ar" ? "توجد معاينة أخرى قيد التشغيل لحسابك." : "Another AI preview is already running for your account.";
    if (caught.code === "AI_NOT_CONFIGURED") return language === "ar" ? "لم يتم إعداد استيراد الذكاء الاصطناعي على الخادم بعد." : "AI Import is not configured on the server yet.";
    return caught.message;
  };

  if (response) {
    return (
      <div dir={language === "ar" ? "rtl" : "ltr"}>
        <AIReviewStudio language={language} target={target} response={response} onNewPreview={() => setResponse(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-4" dir={language === "ar" ? "rtl" : "ltr"}>
      <div className="rounded-xl border border-rose-200/70 bg-rose-50/50 p-4 dark:border-rose-400/20 dark:bg-rose-400/[0.05]">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
          <div>
            <h2 className="text-base font-semibold text-neutral-900 dark:text-white">{target === "mcq" ? aiText(language, "generateMcq") : aiText(language, "generateFlashcards")}</h2>
            <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-300">{aiText(language, "previewOnly")}</p>
          </div>
        </div>
      </div>
      <LectureTargetSelector language={language} lectureId={lectureId} onLectureChange={setLectureId} />
      <OperationSelector language={language} target={target} operation={operation} onChange={setOperation} />

      <section className="space-y-3 rounded-xl border border-neutral-200/80 bg-white p-4 dark:border-white/[0.08] dark:bg-[#1C1C1E]/70">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">{aiText(language, "source")}</h3>
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-neutral-100/80 p-1 dark:bg-white/[0.05]">
          {(["text", "pdf", "image"] as const).map((value) => (
            <button key={value} type="button" onClick={() => changeInputKind(value)} className={`rounded-md px-2 py-2 text-xs font-semibold transition ${inputKind === value ? "bg-white text-neutral-900 shadow-sm dark:bg-[#2C2C2E] dark:text-white" : "text-neutral-500 dark:text-neutral-400"}`}>
              {value === "text" ? aiText(language, "pasteText") : value === "pdf" ? aiText(language, "pdf") : aiText(language, "images")}
            </button>
          ))}
        </div>

        {inputKind === "text" && (
          <div className="space-y-2">
            <textarea value={text} onChange={(event) => setText(event.target.value)} dir={isArabicText(text) ? "rtl" : "auto"} rows={9} placeholder={aiText(language, "textPlaceholder")} className="w-full resize-y rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm leading-6 text-neutral-800 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-white" />
            <div className="text-end text-[11px] text-neutral-500 dark:text-neutral-400">{text.length.toLocaleString()} {aiText(language, "characters")}</div>
          </div>
        )}

        {inputKind !== "text" && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inputRef.current?.click(); } }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); acceptFiles(Array.from(event.dataTransfer.files)); }}
            className="rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50/60 p-5 text-center transition hover:border-rose-400 dark:border-white/[0.12] dark:bg-white/[0.03]"
          >
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept={inputKind === "pdf" ? "application/pdf,.pdf" : "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"}
              multiple={inputKind === "image"}
              onChange={(event) => { acceptFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }}
            />
            {inputKind === "pdf" ? <Upload className="mx-auto h-7 w-7 text-rose-500" /> : <ImagePlus className="mx-auto h-7 w-7 text-rose-500" />}
            <p className="mt-2 text-sm font-semibold text-neutral-700 dark:text-neutral-200">{aiText(language, "browse")}</p>
            <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">{inputKind === "pdf" ? aiText(language, "maxPdf") : aiText(language, "imageLimits")}</p>
          </div>
        )}

        {pdf && inputKind === "pdf" && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 p-2.5 dark:border-white/[0.1]">
            <SourcePreview file={pdf} />
            <button type="button" onClick={() => setPdf(null)} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/[0.08]" aria-label={aiText(language, "remove")}><X className="h-4 w-4" /></button>
          </div>
        )}
        {images.length > 0 && inputKind === "image" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
              <span>{images.length} / {MAX_IMAGES} {aiText(language, "images")}</span>
              <button type="button" onClick={() => setImages([])} className="text-rose-600 hover:text-rose-500 dark:text-rose-300">{aiText(language, "clearAll")}</button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {images.map((file, index) => (
                <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center gap-2 rounded-lg border border-neutral-200 p-2 dark:border-white/[0.1]">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-600 dark:bg-white/[0.08] dark:text-neutral-200">{index + 1}</span>
                  <SourcePreview file={file} />
                  <button type="button" onClick={() => removeImage(index)} className="ms-auto rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/[0.08]" aria-label={`${aiText(language, "remove")} ${index + 1}`}><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <p className="text-end text-[11px] text-neutral-500 dark:text-neutral-400">{formatBytes(images.reduce((sum, file) => sum + file.size, 0))}</p>
          </div>
        )}
      </section>

      {(target === "mcq" || operation === "generate" || operation === "enhance") && (
        <section className="space-y-4 rounded-xl border border-neutral-200/80 bg-white p-4 dark:border-white/[0.08] dark:bg-[#1C1C1E]/70">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">{target === "mcq" ? aiText(language, "operation") : aiText(language, "operation")}</h3>
          {target === "mcq" && operation === "generate" && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1.5 text-xs font-semibold text-neutral-600 dark:text-neutral-300">{aiText(language, "count")}<input type="number" min={1} max={100} value={mcqCount} onChange={(event) => setMcqCount(Number(event.target.value))} className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-normal text-neutral-800 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-white" /></label>
              <label className="space-y-1.5 text-xs font-semibold text-neutral-600 dark:text-neutral-300">{aiText(language, "style")}<select value={mcqStyle} onChange={(event) => setMcqStyle(event.target.value as MCQQuestionStyle)} className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-normal dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-white"><option value="mixed">{aiText(language, "mixed")}</option><option value="direct">{aiText(language, "direct")}</option><option value="understanding">{aiText(language, "understanding")}</option><option value="clinical">{aiText(language, "clinical")}</option></select></label>
              <div className="space-y-2 pt-5 text-xs text-neutral-700 dark:text-neutral-200"><label className="flex items-center gap-2"><input type="checkbox" checked={includeHints} onChange={(event) => setIncludeHints(event.target.checked)} className="accent-rose-500" />{aiText(language, "generateHints")}</label><label className="flex items-center gap-2"><input type="checkbox" checked={includeExplanations} onChange={(event) => setIncludeExplanations(event.target.checked)} className="accent-rose-500" />{aiText(language, "generateExplanations")}</label></div>
            </div>
          )}
          {target === "mcq" && operation === "enhance" && (
            <div className="space-y-3 text-sm text-neutral-700 dark:text-neutral-200">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{aiText(language, "enhanceMcqNote")}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                  {aiText(language, "category")}
                  <select value={mcqCategory} onChange={(event) => setMcqCategory(event.target.value as MCQCategory)} className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-normal dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-white">
                    <option value="AI_GENERATED">{language === "ar" ? "مولدة بالذكاء الاصطناعي" : "AI Generated"}</option>
                    <option value="PREVIOUS_YEAR">{language === "ar" ? "السنوات السابقة" : "Previous Year"}</option>
                    <option value="RESOURCE">{language === "ar" ? "المصادر" : "Resources"}</option>
                  </select>
                </label>
                <label className="space-y-1.5 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                  {aiText(language, "difficulty")}
                  <select value={mcqExtractDifficulty} onChange={(event) => setMcqExtractDifficulty(event.target.value as Exclude<MCQDifficulty, "mixed">)} className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-normal dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-white">
                    <option value="Easy">{aiText(language, "easy")}</option>
                    <option value="Medium">{aiText(language, "medium")}</option>
                    <option value="Hard">{aiText(language, "hard")}</option>
                  </select>
                </label>
              </div>
              <label className="flex items-center gap-2"><input type="checkbox" checked={enhanceHint} onChange={(event) => setEnhanceHint(event.target.checked)} className="accent-rose-500" />{aiText(language, "addMissingHints")}</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={enhanceExplanation} onChange={(event) => setEnhanceExplanation(event.target.checked)} className="accent-rose-500" />{aiText(language, "addMissingExplanations")}</label>
            </div>
          )}
          {target === "mcq" && operation === "extract" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                  {aiText(language, "category")}
                  <select value={mcqCategory} onChange={(event) => setMcqCategory(event.target.value as MCQCategory)} className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-normal dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-white">
                    <option value="AI_GENERATED">{language === "ar" ? "مولدة بالذكاء الاصطناعي" : "AI Generated"}</option>
                    <option value="PREVIOUS_YEAR">{language === "ar" ? "السنوات السابقة" : "Previous Year"}</option>
                    <option value="RESOURCE">{language === "ar" ? "المصادر" : "Resources"}</option>
                  </select>
                </label>
                <label className="space-y-1.5 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                  {aiText(language, "difficulty")}
                  <select value={mcqExtractDifficulty} onChange={(event) => setMcqExtractDifficulty(event.target.value as Exclude<MCQDifficulty, "mixed">)} className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-normal dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-white">
                    <option value="Easy">{aiText(language, "easy")}</option>
                    <option value="Medium">{aiText(language, "medium")}</option>
                    <option value="Hard">{aiText(language, "hard")}</option>
                  </select>
                </label>
              </div>
              <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">{aiText(language, "extractNote")}</p>
            </>
          )}
          {target === "flashcard" && operation === "generate" && <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1.5 text-xs font-semibold text-neutral-600 dark:text-neutral-300">{aiText(language, "count")}<input type="number" min={1} max={100} value={flashcardCount} onChange={(event) => setFlashcardCount(Number(event.target.value))} className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-normal text-neutral-800 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-white" /></label><label className="space-y-1.5 text-xs font-semibold text-neutral-600 dark:text-neutral-300">{aiText(language, "focus")}<input maxLength={200} value={focus} onChange={(event) => setFocus(event.target.value)} placeholder={aiText(language, "focusPlaceholder")} className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-normal text-neutral-800 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-white" /></label></div>}
          {target === "flashcard" && operation === "extract" && <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">{aiText(language, "extractNote")}</p>}
          {target === "flashcard" && operation === "enhance" && <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">{aiText(language, "enhanceFlashcardNote")}</p>}
        </section>
      )}

      {(message || error) && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-400/20 dark:bg-rose-400/[0.07] dark:text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p>{message || friendlyError(error)}</p>
            {error?.requestId && <p className="mt-1 text-xs opacity-75">Reference: {error.requestId.slice(0, 12)}</p>}
            {error?.retryable && <button type="button" onClick={() => void handleSubmit()} className="mt-2 font-semibold underline">{aiText(language, "tryAgain")}</button>}
          </div>
        </div>
      )}

      {isBusy ? (
        <div className="flex flex-col gap-3 rounded-xl border border-neutral-200/80 bg-white p-4 dark:border-white/[0.08] dark:bg-[#1C1C1E]/70 sm:flex-row sm:items-center sm:justify-between" role="status" aria-live="polite">
          <div className="flex items-center gap-3"><LoaderCircle className="h-5 w-5 animate-spin text-rose-500" /><span className="text-sm font-semibold text-neutral-800 dark:text-white">{stageLabel}</span></div>
          <button type="button" onClick={cancel} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 hover:border-rose-300 dark:border-white/[0.12] dark:text-neutral-200">{aiText(language, "cancel")}</button>
        </div>
      ) : (
        <button type="button" onClick={() => void handleSubmit()} disabled={!lectureId || !sourceHasContent || (target === "mcq" && operation === "enhance" && !enhanceHint && !enhanceExplanation)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-rose-600 px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 dark:disabled:bg-white/[0.08] dark:disabled:text-neutral-500">
          <Sparkles className="h-4 w-4" />
          {target === "mcq"
            ? operation === "extract" ? aiText(language, "submitExtractMcq") : operation === "generate" ? `${aiText(language, "submitGenerateMcq")} ${mcqCount}` : aiText(language, "submitEnhanceMcq")
            : operation === "extract" ? aiText(language, "submitExtractFlashcards") : operation === "generate" ? `${aiText(language, "submitGenerateFlashcards")} ${flashcardCount}` : aiText(language, "submitEnhanceFlashcards")}
        </button>
      )}
    </div>
  );
}