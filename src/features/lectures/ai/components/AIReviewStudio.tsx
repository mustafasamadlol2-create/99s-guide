import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileText,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
} from "lucide-react";
import type { Language } from "../../../../core/i18n/translations";
import { aiText } from "../i18n";
import { requestAIImportCheck, requestAIImportCommit, type AIImportCandidate } from "../api/importApi";
import {
  validateFlashcardCandidate,
  validateMCQCandidate,
} from "../validation/reviewValidation";
import type {
  AIMCQCandidate,
  AIFlashcardCandidate,
  AIPreviewResponse,
  LocalFlashcardCandidate,
  LocalMCQCandidate,
} from "../types/aiPreview";
import { MCQ_CATEGORIES, MCQ_CATEGORY_LABELS } from "../../../../../shared/mcqMetadata";

type Filter = "all" | "ready" | "review" | "selected";

function localMCQ(candidate: AIMCQCandidate): LocalMCQCandidate {
  const original = { ...candidate, warnings: [...candidate.warnings] };
  return {
    original,
    draft: { ...original, warnings: [...original.warnings] },
    selected: false,
    edited: false,
    localValidation: validateMCQCandidate(original),
  };
}

function localFlashcard(candidate: AIFlashcardCandidate): LocalFlashcardCandidate {
  const original = { ...candidate, warnings: [...candidate.warnings] };
  return {
    original,
    draft: { ...original, warnings: [...original.warnings] },
    selected: false,
    edited: false,
    localValidation: validateFlashcardCandidate(original),
  };
}

function provenanceLabel(language: Language, value: string): string {
  if (value === "extracted") return aiText(language, "extracted");
  if (value === "generated") return aiText(language, "generatedLabel");
  return aiText(language, "enhanced");
}

function SourceEvidence({
  language,
  source,
}: {
  language: Language;
  source: AIMCQCandidate["source"];
}) {
  const [expanded, setExpanded] = useState(false);
  if (!source) {
    return (
      <div className="text-xs text-neutral-500 dark:text-neutral-400">
        {aiText(language, "sourceEvidence")}: —
      </div>
    );
  }
  const locator = source.inputType === "pdf"
    ? `${aiText(language, "page")} ${source.page ?? "—"}`
    : source.inputType === "image"
      ? `${aiText(language, "image")} ${(source.imageIndex ?? 0) + 1}`
      : source.section || source.label || aiText(language, "sourceText");
  return (
    <div className="space-y-2 rounded-lg border border-neutral-200/70 bg-neutral-50/70 p-3 text-xs dark:border-white/[0.08] dark:bg-white/[0.03]">
      <div className="flex items-center gap-2 text-neutral-600 dark:text-neutral-300">
        <FileText className="h-3.5 w-3.5 shrink-0 text-rose-500" />
        <span>{aiText(language, "sourceEvidence")}: {locator}</span>
      </div>
      {source.supportingExcerpt && (
        <>
          <button
            type="button"
            className="flex items-center gap-1 font-semibold text-rose-600 hover:text-rose-500 dark:text-rose-400"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {expanded ? aiText(language, "sourceText") : aiText(language, "sourceEvidence")}
          </button>
          {expanded && (
            <p className="whitespace-pre-wrap text-neutral-600 dark:text-neutral-300">
              {source.supportingExcerpt}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function CandidateMeta({
  language,
  candidate,
  validation,
}: {
  language: Language;
  candidate: AIMCQCandidate | AIFlashcardCandidate;
  validation: { ready: boolean; errors: string[] };
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <span className="rounded-full bg-neutral-100 px-2 py-1 font-semibold text-neutral-600 dark:bg-white/[0.08] dark:text-neutral-300">
        {provenanceLabel(language, candidate.provenance)}
      </span>
      <span className="rounded-full bg-sky-50 px-2 py-1 font-semibold text-sky-700 dark:bg-sky-400/10 dark:text-sky-300">
        {aiText(language, "confidence")}: {Math.round(candidate.confidence * 100)}%
      </span>
      <span className={`rounded-full px-2 py-1 font-semibold ${
        validation.ready
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
          : "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300"
      }`}>
        {validation.ready ? aiText(language, "readyForReview") : aiText(language, "needsReview")}
      </span>
    </div>
  );
}

function WarningBlock({
  language,
  warnings,
  errors,
}: {
  language: Language;
  warnings: string[];
  errors: string[];
}) {
  if (!warnings.length && !errors.length) return null;
  return (
    <details className="rounded-lg border border-amber-200/80 bg-amber-50/70 p-3 text-xs dark:border-amber-400/20 dark:bg-amber-400/[0.07]">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
        <CircleAlert className="h-4 w-4 shrink-0" />
        {aiText(language, "warnings")} ({warnings.length + errors.length})
      </summary>
      <ul className="mt-2 space-y-1 ps-6 text-amber-800 dark:text-amber-200">
        {errors.map((warning) => <li key={`local-${warning}`}>{warning}</li>)}
        {warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
      </ul>
    </details>
  );
}

function MCQEditor({
  language,
  item,
  onChange,
}: {
  language: Language;
  item: LocalMCQCandidate;
  onChange: (next: AIMCQCandidate) => void;
}) {
  const { draft } = item;
  const update = (patch: Partial<AIMCQCandidate>) => onChange({ ...draft, ...patch });
  const fields: Array<[keyof AIMCQCandidate, string]> = [
    ["question", aiText(language, "question")],
    ["optionA", aiText(language, "optionA")],
    ["optionB", aiText(language, "optionB")],
    ["optionC", aiText(language, "optionC")],
    ["optionD", aiText(language, "optionD")],
  ];
  return (
    <div className="space-y-4">
      {fields.map(([key, label]) => (
        <label key={key} className="block space-y-1.5">
          <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">{label}</span>
          {key === "question" ? (
            <textarea
              value={String(draft[key] ?? "")}
              onChange={(event) => update({ [key]: event.target.value } as Partial<AIMCQCandidate>)}
              rows={3}
              className="min-h-20 w-full resize-y rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-white"
            />
          ) : (
            <input
              value={String(draft[key] ?? "")}
              onChange={(event) => update({ [key]: event.target.value } as Partial<AIMCQCandidate>)}
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-white"
            />
          )}
        </label>
      ))}
      <div className="space-y-2">
        <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">{aiText(language, "correctAnswer")}</span>
        <div className="grid grid-cols-4 gap-2">
          {(["A", "B", "C", "D"] as const).map((answer) => (
            <button
              key={answer}
              type="button"
              onClick={() => update({ correctAnswer: answer })}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                draft.correctAnswer === answer
                  ? "border-rose-500 bg-rose-500 text-white"
                  : "border-neutral-200 bg-white text-neutral-700 hover:border-rose-300 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-neutral-200"
              }`}
              aria-pressed={draft.correctAnswer === answer}
            >
              {answer}
            </button>
          ))}
        </div>
        {!draft.correctAnswer && <p className="text-xs font-medium text-amber-700 dark:text-amber-300">{aiText(language, "noAnswer")}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {(["hint", "explanation"] as const).map((key) => (
          <label key={key} className="block space-y-1.5">
            <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">{aiText(language, key)}</span>
            <textarea
              value={draft[key] ?? ""}
              onChange={(event) => update({ [key]: event.target.value || null })}
              rows={3}
              className="w-full resize-y rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-white"
            />
          </label>
        ))}
      </div>
      <label className="block max-w-xs space-y-1.5">
        <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">{aiText(language, "difficulty")}</span>
        <select
          value={draft.difficulty ?? ""}
          onChange={(event) => update({ difficulty: (event.target.value || null) as AIMCQCandidate["difficulty"] })}
          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 outline-none dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-white"
        >
          <option value="">—</option>
          <option value="Easy">{aiText(language, "easy")}</option>
          <option value="Medium">{aiText(language, "medium")}</option>
          <option value="Hard">{aiText(language, "hard")}</option>
        </select>
      </label>
      <label className="block max-w-xs space-y-1.5">
        <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">{language === "ar" ? "الفئة" : "Category"}</span>
        <select
          value={draft.category}
          disabled={draft.provenance === "generated"}
          onChange={(event) => update({ category: event.target.value as AIMCQCandidate["category"] })}
          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 outline-none disabled:cursor-not-allowed disabled:opacity-70 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-white"
        >
          {MCQ_CATEGORIES.map((category) => (
            <option key={category} value={category}>{MCQ_CATEGORY_LABELS[category][language === "ar" ? "ar" : "en"]}</option>
          ))}
        </select>
        {draft.provenance === "generated" && (
          <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
            {language === "ar" ? "يتم تثبيت فئة الأسئلة المنشأة بالذكاء الاصطناعي." : "Generated MCQs are always AI Generated."}
          </span>
        )}
      </label>
    </div>
  );
}

function FlashcardEditor({
  language,
  item,
  onChange,
}: {
  language: Language;
  item: LocalFlashcardCandidate;
  onChange: (next: AIFlashcardCandidate) => void;
}) {
  return (
    <div className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">{aiText(language, "clinicalConcept")}</span>
        <textarea
          value={item.draft.clinicalConcept}
          onChange={(event) => onChange({ ...item.draft, clinicalConcept: event.target.value })}
          rows={3}
          className="min-h-20 w-full resize-y rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-white"
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">{aiText(language, "explanation")}</span>
        <textarea
          value={item.draft.explanation ?? ""}
          onChange={(event) => onChange({ ...item.draft, explanation: event.target.value || null })}
          rows={6}
          className="w-full resize-y rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-white"
        />
      </label>
    </div>
  );
}

export function AIReviewStudio({
  language,
  target,
  response,
  onNewPreview,
}: {
  language: Language;
  target: "mcq" | "flashcard";
  response: AIPreviewResponse<AIMCQCandidate | AIFlashcardCandidate>;
  onNewPreview: () => void;
}) {
  const [mcqs, setMcqs] = useState<LocalMCQCandidate[]>([]);
  const [flashcards, setFlashcards] = useState<LocalFlashcardCandidate[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [lastRemoved, setLastRemoved] = useState<LocalMCQCandidate | LocalFlashcardCandidate | null>(null);
  const [importCheck, setImportCheck] = useState<import("../types/aiPreview").AIImportCheckResponse | null>(null);
  const [importPayload, setImportPayload] = useState<AIImportCandidate[] | null>(null);
  const [importResult, setImportResult] = useState<import("../types/aiPreview").AIImportCommitResponse | null>(null);
  const [importBusy, setImportBusy] = useState<"check" | "commit" | null>(null);
  const [importError, setImportError] = useState("");

  useEffect(() => {
    if (target === "mcq") {
      const next = (response.result.items as AIMCQCandidate[]).map(localMCQ);
      setMcqs(next);
      setFlashcards([]);
      setActiveId(next[0]?.draft.candidateId ?? null);
    } else {
      const next = (response.result.items as AIFlashcardCandidate[]).map(localFlashcard);
      setFlashcards(next);
      setMcqs([]);
      setActiveId(next[0]?.draft.candidateId ?? null);
    }
    setFilter("all");
    setSearch("");
    setLastRemoved(null);
    setImportCheck(null);
    setImportPayload(null);
    setImportResult(null);
    setImportBusy(null);
    setImportError("");
  }, [response, target]);

  const candidates = target === "mcq" ? mcqs : flashcards;
  const selectedCount = candidates.filter((item) => item.selected && !item.importStatus).length;
  const readyCount = candidates.filter((item) => item.localValidation.ready).length;
  const reviewCount = candidates.length - readyCount;

  const filteredCandidates = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return candidates.filter((item) => {
      const draft = item.draft;
      const searchable = target === "mcq"
        ? (draft as AIMCQCandidate).question
        : (draft as AIFlashcardCandidate).clinicalConcept;
      const matchesSearch = !term || searchable.toLocaleLowerCase().includes(term);
      const matchesFilter =
        filter === "all" ||
        (filter === "ready" && item.localValidation.ready) ||
        (filter === "review" && !item.localValidation.ready) ||
        (filter === "selected" && item.selected);
      return matchesSearch && matchesFilter;
    });
  }, [candidates, filter, search, target]);

  const active = candidates.find((item) => item.draft.candidateId === activeId) ?? null;

  const updateCandidate = (next: AIMCQCandidate | AIFlashcardCandidate) => {
    if (target === "mcq") {
      setMcqs((items) => items.map((item) => {
        if (item.draft.candidateId !== next.candidateId || item.importStatus || importCheck) return item;
        const draft = next as AIMCQCandidate;
        return {
          ...item,
          draft,
          edited: JSON.stringify(draft) !== JSON.stringify(item.original),
          localValidation: validateMCQCandidate(draft),
          selected: item.selected && validateMCQCandidate(draft).ready,
        };
      }));
    } else {
      setFlashcards((items) => items.map((item) => {
        if (item.draft.candidateId !== next.candidateId || item.importStatus || importCheck) return item;
        const draft = next as AIFlashcardCandidate;
        return {
          ...item,
          draft,
          edited: JSON.stringify(draft) !== JSON.stringify(item.original),
          localValidation: validateFlashcardCandidate(draft),
          selected: item.selected && validateFlashcardCandidate(draft).ready,
        };
      }));
    }
  };

  const toggleSelection = (id: string) => {
    if (importBusy || importCheck) return;
    if (target === "mcq") {
      setMcqs((items) => items.map((item) => item.draft.candidateId === id && item.localValidation.ready
        ? { ...item, selected: !item.selected }
        : item));
    } else {
      setFlashcards((items) => items.map((item) => item.draft.candidateId === id && item.localValidation.ready
        ? { ...item, selected: !item.selected }
        : item));
    }
  };

  const selectAllReady = () => {
    if (importBusy || importCheck) return;
    if (target === "mcq") setMcqs((items) => items.map((item) => ({ ...item, selected: item.localValidation.ready && !item.importStatus })));
    else setFlashcards((items) => items.map((item) => ({ ...item, selected: item.localValidation.ready && !item.importStatus })));
  };

  const clearSelection = () => {
    if (importBusy || importCheck) return;
    if (target === "mcq") setMcqs((items) => items.map((item) => ({ ...item, selected: false })));
    else setFlashcards((items) => items.map((item) => ({ ...item, selected: false })));
  };

  const removeCandidate = (id: string) => {
    if (importBusy || importCheck) return;
    if (target === "mcq") {
      const item = mcqs.find((candidate) => candidate.draft.candidateId === id);
      if (item) setLastRemoved(item);
      setMcqs((items) => items.filter((candidate) => candidate.draft.candidateId !== id));
    } else {
      const item = flashcards.find((candidate) => candidate.draft.candidateId === id);
      if (item) setLastRemoved(item);
      setFlashcards((items) => items.filter((candidate) => candidate.draft.candidateId !== id));
    }
    setActiveId(null);
  };

  const undoRemove = () => {
    if (!lastRemoved) return;
    if ("draft" in lastRemoved && "question" in lastRemoved.draft) {
      setMcqs((items) => [...items, lastRemoved as LocalMCQCandidate]);
    } else {
      setFlashcards((items) => [...items, lastRemoved as LocalFlashcardCandidate]);
    }
    setLastRemoved(null);
  };

  const resetCandidate = () => {
    if (!active || active.importStatus || importCheck) return;
    if (target === "mcq") {
      const item = active as LocalMCQCandidate;
      updateCandidate({ ...item.original, warnings: [...item.original.warnings] });
    } else {
      const item = active as LocalFlashcardCandidate;
      updateCandidate({ ...item.original, warnings: [...item.original.warnings] });
    }
  };

  const importLabel = (key: "import" | "checking" | "confirm" | "cancel" | "imported" | "exact" | "possible" | "saved") => {
    const arabic: Record<typeof key, string> = {
      import: "استيراد المحدد",
      checking: "جارٍ تحليل التكرار…",
      confirm: "تأكيد الاستيراد",
      cancel: "إلغاء",
      imported: "تم الاستيراد",
      exact: "تكرار مطابق",
      possible: "تكرار محتمل",
      saved: "تم الحفظ بنجاح",
    };
    const english: Record<typeof key, string> = {
      import: "Import Selected",
      checking: "Checking duplicates…",
      confirm: "Confirm Import",
      cancel: "Cancel",
      imported: "Imported",
      exact: "Exact duplicate",
      possible: "Possible duplicate",
      saved: "Saved successfully",
    };
    return language === "ar" ? arabic[key] : english[key];
  };

  const buildImportPayload = (): AIImportCandidate[] => {
    if (target === "mcq") {
      return mcqs
        .filter((item) => item.selected && item.localValidation.ready && !item.importStatus)
        .map(({ draft }) => ({
          clientKey: draft.candidateId,
          question: draft.question,
          optionA: draft.optionA,
          optionB: draft.optionB,
          optionC: draft.optionC,
          optionD: draft.optionD,
          correctAnswer: draft.correctAnswer!,
          hint: draft.hint,
          explanation: draft.explanation,
          difficulty: draft.difficulty,
          category: draft.category,
        }));
    }
    return flashcards
      .filter((item) => item.selected && item.localValidation.ready && !item.importStatus)
      .map(({ draft }) => ({
        clientKey: draft.candidateId,
        clinicalConcept: draft.clinicalConcept,
        explanation: draft.explanation!,
      }));
  };

  const handleImportSelected = async () => {
    if (importBusy || selectedCount === 0) return;
    const payload = buildImportPayload();
    if (payload.length === 0) return;
    setImportBusy("check");
    setImportError("");
    try {
      const checked = await requestAIImportCheck(target, response.lecture.id, payload);
      setImportPayload(payload);
      setImportCheck(checked);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Import check failed.");
    } finally {
      setImportBusy(null);
    }
  };

  const cancelImport = () => {
    if (importBusy) return;
    setImportCheck(null);
    setImportPayload(null);
    setImportError("");
  };

  const confirmImport = async () => {
    if (!importPayload || !importCheck || importBusy || importCheck.summary.newCount === 0) return;
    setImportBusy("commit");
    setImportError("");
    try {
      const result = await requestAIImportCommit(target, response.lecture.id, importPayload);
      setImportResult(result);
      const statuses = new Map(result.items.map((item) => [item.clientKey, item.status]));
      if (target === "mcq") {
        setMcqs((items) => items.map((item) => {
          const status = statuses.get(item.draft.candidateId);
          return status ? { ...item, selected: false, importStatus: status } : item;
        }));
      } else {
        setFlashcards((items) => items.map((item) => {
          const status = statuses.get(item.draft.candidateId);
          return status ? { ...item, selected: false, importStatus: status } : item;
        }));
      }
      setImportCheck(null);
      setImportPayload(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Import failed. No review items were changed.");
    } finally {
      setImportBusy(null);
    }
  };

  const filterLabels: Array<[Filter, string]> = [
    ["all", aiText(language, "all")],
    ["ready", aiText(language, "ready")],
    ["review", aiText(language, "needsReview")],
    ["selected", aiText(language, "selected")],
  ];

  return (
    <section className="space-y-4" aria-label={aiText(language, "results")}>
      <div className="flex flex-col gap-3 rounded-xl border border-emerald-200/70 bg-emerald-50/75 p-4 dark:border-emerald-400/20 dark:bg-emerald-400/[0.07] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-300" />
          <div>
            <p className="font-semibold text-emerald-900 dark:text-emerald-200">{aiText(language, "previewOnly")}</p>
            <p className="mt-1 text-xs text-emerald-800/80 dark:text-emerald-200/80">
              {language === "ar" ? "راجع المحتوى ثم استورد العناصر المحددة" : "Review content, then import selected items"} · {response.lecture.name} · {response.requestId.slice(0, 8)}
            </p>
          </div>
        </div>
        <button type="button" onClick={onNewPreview} className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-400/30 dark:text-emerald-200 dark:hover:bg-emerald-400/10">
          {aiText(language, "newPreview")}
        </button>
      </div>

      {response.result.truncated && (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/[0.07] dark:text-amber-200">
          <AlertCircle className="h-4 w-4 shrink-0" /> {aiText(language, "truncated")}
        </div>
      )}
      {response.result.status === "incomplete" && (
        <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-400/20 dark:bg-rose-400/[0.07] dark:text-rose-200">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {language === "ar"
            ? "اكتملت المعالجة جزئياً فقط. راجع التحذيرات ولا تعتبر النتيجة الفارغة دليلاً على خلو المصدر."
            : "Visual source processing was incomplete. Review the warnings; an empty result is not proof that the source contained no items."}
        </div>
      )}
      {response.result.status === "empty" && (
        <div className="flex gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-400/20 dark:bg-sky-400/[0.07] dark:text-sky-200">
          <FileText className="h-4 w-4 shrink-0" />
          {language === "ar"
            ? "لم يتم العثور على عناصر قابلة للاستخراج في المصدر."
            : "No extractable items were found in the source."}
        </div>
      )}
      {!!response.result.warnings.length && (
        <details className="rounded-lg border border-amber-200/70 bg-amber-50/60 p-3 text-sm dark:border-amber-400/20 dark:bg-amber-400/[0.05]">
          <summary className="cursor-pointer font-semibold text-amber-800 dark:text-amber-200">{aiText(language, "warnings")} ({response.result.warnings.length})</summary>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-amber-800 dark:text-amber-200">
            {response.result.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
          </ul>
        </details>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          [aiText(language, "generated"), response.result.counts.returnedCount],
          [aiText(language, "ready"), readyCount],
          [aiText(language, "needsReview"), reviewCount],
          [aiText(language, "skipped"), response.result.counts.skippedCount],
          [aiText(language, "selected"), selectedCount],
        ].map(([label, count]) => (
          <div key={label} className="rounded-lg border border-neutral-200/80 bg-white p-3 dark:border-white/[0.08] dark:bg-white/[0.04]">
            <div className="text-xl font-semibold text-neutral-900 dark:text-white">{count}</div>
            <div className="mt-1 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">{label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-neutral-200/80 bg-white p-3 dark:border-white/[0.08] dark:bg-[#1C1C1E]/70 sm:p-4">
        <div className="flex flex-col gap-3 border-b border-neutral-200/70 pb-3 dark:border-white/[0.08] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {filterLabels.map(([value, label]) => (
              <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${filter === value ? "bg-rose-500 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-white/[0.08] dark:text-neutral-300 dark:hover:bg-white/[0.12]"}`}>
                {label}
              </button>
            ))}
          </div>
          <label className="relative block min-w-48 flex-1 lg:max-w-xs">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={aiText(language, "search")} className="w-full rounded-lg border border-neutral-200 bg-neutral-50 py-2 ps-9 pe-3 text-sm outline-none focus:border-rose-400 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-white" />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200/70 py-3 dark:border-white/[0.08]">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={selectAllReady} disabled={!readyCount} className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.12] dark:text-neutral-200">{aiText(language, "selectAllReady")}</button>
            <button type="button" onClick={clearSelection} disabled={!selectedCount} className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.12] dark:text-neutral-200">{aiText(language, "clearSelection")}</button>
          </div>
          {lastRemoved && <button type="button" onClick={undoRemove} className="flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-400/10"><Undo2 className="h-3.5 w-3.5" /> {aiText(language, "undo")}</button>}
        </div>

        <div className="grid gap-4 pt-4 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.6fr)]">
          <div className="space-y-2">
            {filteredCandidates.map((item, index) => {
              const title = target === "mcq"
                ? (item.draft as AIMCQCandidate).question
                : (item.draft as AIFlashcardCandidate).clinicalConcept;
              return (
                <div key={item.draft.candidateId} className={`rounded-lg border transition ${activeId === item.draft.candidateId ? "border-rose-400 bg-rose-50/60 dark:border-rose-400/60 dark:bg-rose-400/[0.08]" : "border-neutral-200/80 dark:border-white/[0.08]"}`}>
                  <div className="flex items-start gap-2 p-2.5">
                    <input type="checkbox" aria-label={`${aiText(language, "selected")} ${index + 1}`} checked={item.selected} disabled={!item.localValidation.ready || Boolean(item.importStatus) || Boolean(importBusy)} onChange={() => toggleSelection(item.draft.candidateId)} className="mt-1 h-4 w-4 accent-rose-500" />
                    <button type="button" onClick={() => setActiveId(item.draft.candidateId)} className="min-w-0 flex-1 text-start">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">
                        <span>{index + 1}</span>
                        <span className={item.importStatus === "imported" ? "text-emerald-600 dark:text-emerald-300" : item.importStatus ? "text-amber-600 dark:text-amber-300" : item.localValidation.ready ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300"}>
                          {item.importStatus === "imported" ? importLabel("imported") : item.importStatus === "exact_duplicate" ? importLabel("exact") : item.importStatus === "possible_duplicate" ? importLabel("possible") : item.localValidation.ready ? aiText(language, "ready") : aiText(language, "needsReview")}
                        </span>
                      </div>
                      <p className="line-clamp-3 text-sm font-medium text-neutral-800 dark:text-neutral-100">{title || "—"}</p>
                    </button>
                  </div>
                </div>
              );
            })}
            {!filteredCandidates.length && <p className="rounded-lg bg-neutral-50 p-4 text-center text-sm text-neutral-500 dark:bg-white/[0.03] dark:text-neutral-400">{aiText(language, "noCandidates")}</p>}
          </div>

          <div className="min-w-0">
            {active ? (
              <div className="space-y-4 rounded-lg border border-neutral-200/80 p-3 sm:p-4 dark:border-white/[0.08]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{active.draft.candidateId.slice(0, 8)}</span>
                      {active.edited && <span className="rounded-full bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 dark:bg-sky-400/10 dark:text-sky-300">{aiText(language, "edited")}</span>}
                      {active.importStatus && <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${active.importStatus === "imported" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300"}`}>{active.importStatus === "imported" ? importLabel("imported") : active.importStatus === "exact_duplicate" ? importLabel("exact") : importLabel("possible")}</span>}
                    </div>
                    <CandidateMeta language={language} candidate={active.draft} validation={active.localValidation} />
                  </div>
                  <div className="flex gap-1">
                    {active.edited && <button type="button" onClick={resetCandidate} title={aiText(language, "reset")} aria-label={aiText(language, "reset")} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/[0.08]"><RotateCcw className="h-4 w-4" /></button>}
                    {!active.importStatus && <button type="button" onClick={() => removeCandidate(active.draft.candidateId)} title={aiText(language, "reject")} aria-label={aiText(language, "reject")} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-400/10"><Trash2 className="h-4 w-4" /></button>}
                  </div>
                </div>
                <WarningBlock language={language} warnings={active.draft.warnings} errors={active.localValidation.errors} />
                {target === "mcq"
                  ? <MCQEditor language={language} item={active as LocalMCQCandidate} onChange={updateCandidate} />
                  : <FlashcardEditor language={language} item={active as LocalFlashcardCandidate} onChange={updateCandidate} />}
                <SourceEvidence language={language} source={active.draft.source} />
              </div>
            ) : (
              <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-neutral-200 p-6 text-center text-sm text-neutral-500 dark:border-white/[0.1] dark:text-neutral-400">
                {aiText(language, "noCandidates")}
              </div>
            )}
          </div>
        </div>
      </div>

      {!!response.result.skippedItems.length && (
        <details className="rounded-xl border border-neutral-200/80 bg-white p-4 dark:border-white/[0.08] dark:bg-[#1C1C1E]/70">
          <summary className="cursor-pointer text-sm font-semibold text-neutral-800 dark:text-white">
            {response.result.skippedItems.length} {aiText(language, "skippedItems")}
          </summary>
          <div className="mt-3 space-y-2">
            {response.result.skippedItems.map((item, index) => (
              <div key={`${item.reason}-${index}`} className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600 dark:bg-white/[0.04] dark:text-neutral-300">
                <span className="font-semibold">{item.reason}</span>{item.summary ? ` — ${item.summary}` : ""}
                {item.source && <span className="ms-2 text-neutral-500">({item.source.inputType}{item.source.page ? `, ${aiText(language, "page")} ${item.source.page}` : ""})</span>}
              </div>
            ))}
          </div>
        </details>
      )}

      {importError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-400/20 dark:bg-rose-400/[0.07] dark:text-rose-200">
          {importError}
        </div>
      )}

      {importResult && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-400/[0.07] dark:text-emerald-200">
          <p className="font-semibold">{importLabel("saved")}</p>
          <p className="mt-1">
            {language === "ar"
              ? `تم استيراد ${importResult.summary.importedCount} ${target === "mcq" ? "سؤالاً" : "بطاقة"} وتخطي ${importResult.summary.exactDuplicateSkipped + importResult.summary.possibleDuplicateSkipped} مكررات.`
              : `Imported ${importResult.summary.importedCount} ${target === "mcq" ? "MCQs" : "flashcards"}; skipped ${importResult.summary.exactDuplicateSkipped + importResult.summary.possibleDuplicateSkipped} duplicates.`}
          </p>
          {importResult.sync.warning && <p className="mt-2 text-xs">{importResult.sync.warning}</p>}
        </div>
      )}

      {importCheck && (
        <section className="space-y-3 rounded-xl border border-rose-200 bg-rose-50/70 p-4 dark:border-rose-400/20 dark:bg-rose-400/[0.07]">
          <div>
            <h3 className="font-semibold text-neutral-900 dark:text-white">{language === "ar" ? "جاهز للاستيراد" : "Ready to import"}</h3>
            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">
              {importCheck.summary.newCount} {language === "ar" ? "جديد" : "new"} · {importCheck.summary.exactDuplicateCount + importCheck.summary.possibleDuplicateCount} {language === "ar" ? "سيتم تخطيه" : "duplicates will be skipped"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              [language === "ar" ? "المحدد" : "Selected", importCheck.summary.submittedCount],
              [language === "ar" ? "جديد" : "New", importCheck.summary.newCount],
              [language === "ar" ? "تكرار مطابق" : "Exact duplicates", importCheck.summary.exactDuplicateCount],
              [language === "ar" ? "تكرار محتمل" : "Possible duplicates", importCheck.summary.possibleDuplicateCount],
            ].map(([label, count]) => <div key={String(label)} className="rounded-lg bg-white/80 p-2.5 dark:bg-white/[0.06]"><div className="text-lg font-semibold text-neutral-900 dark:text-white">{count}</div><div className="text-[11px] text-neutral-600 dark:text-neutral-300">{label}</div></div>)}
          </div>
          {(importCheck.summary.exactDuplicateCount > 0 || importCheck.summary.possibleDuplicateCount > 0) && (
            <details className="rounded-lg bg-white/70 p-3 text-xs dark:bg-white/[0.05]">
              <summary className="cursor-pointer font-semibold text-neutral-800 dark:text-neutral-100">{language === "ar" ? "عرض تفاصيل المكررات" : "Review duplicate details"}</summary>
              <div className="mt-2 max-h-48 space-y-2 overflow-auto">
                {importCheck.items.filter((item) => item.status !== "new").map((item) => (
                  <div key={item.clientKey} className="rounded-md border border-neutral-200/70 p-2 dark:border-white/[0.08]">
                    <div className="font-semibold">{item.status === "exact_duplicate" ? importLabel("exact") : importLabel("possible")} · {item.duplicateScope}</div>
                    {item.matchedPreview && <div className="mt-1 text-neutral-600 dark:text-neutral-300">{item.matchedPreview}</div>}
                    {item.similarity !== undefined && <div className="mt-1 text-neutral-500">{Math.round(item.similarity * 100)}%</div>}
                  </div>
                ))}
              </div>
            </details>
          )}
          {importCheck.summary.newCount === 0 && <p className="text-xs font-medium text-amber-800 dark:text-amber-200">{language === "ar" ? "تبدو جميع العناصر المحددة موجودة في هذه المحاضرة." : "All selected items already appear to exist in this Lecture."}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={cancelImport} disabled={Boolean(importBusy)} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold text-neutral-700 dark:border-white/[0.14] dark:text-neutral-200">{importLabel("cancel")}</button>
            <button type="button" onClick={() => void confirmImport()} disabled={Boolean(importBusy) || importCheck.summary.newCount === 0} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{importBusy === "commit" ? importLabel("checking") : importLabel("confirm")}</button>
          </div>
        </section>
      )}

      <div className="flex flex-col gap-1 border-t border-neutral-200/70 pt-3 text-sm text-neutral-600 dark:border-white/[0.08] dark:text-neutral-300 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{selectedCount} {aiText(language, "selectedForImport")}</span>
          <button type="button" onClick={() => void handleImportSelected()} disabled={selectedCount === 0 || Boolean(importBusy) || Boolean(importCheck)} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{importBusy === "check" ? importLabel("checking") : importLabel("import")}</button>
        </div>
        <span className="text-xs">{language === "ar" ? "تبقى العناصر المستوردة ظاهرة للمراجعة" : "Imported items remain visible for review"}</span>
      </div>
    </section>
  );
}