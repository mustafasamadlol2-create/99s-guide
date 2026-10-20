import { useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Layers3,
  Plus,
  Trash2,
  Video,
} from "lucide-react";
import type { DatabaseLecture, Subject } from "../../../core/types";
import type { Language } from "../../../core/i18n/translations";
import { FocusLecturePicker } from "../../focus/components/FocusLecturePicker";
import {
  focusResourcesForLecture,
  type FocusPlanDraftItem,
} from "../../focus/focusHubModel";
import type {
  GroupFocusStudyPlanItem,
  GroupFocusStudyResourceSelection,
} from "../../../../shared/group-focus-study-plan/contract";

export type { GroupFocusStudyPlanItem };

type Props = {
  language: Language;
  lectures: DatabaseLecture[];
  subjects: Subject[];
  catalogStatus: "loading" | "ready" | "error";
  value: GroupFocusStudyPlanItem[];
  onChange: (value: GroupFocusStudyPlanItem[]) => void;
  onRefresh?: () => Promise<void>;
  title?: string;
  description?: string;
  required?: boolean;
};

function normalizePlan(items: readonly GroupFocusStudyPlanItem[]): GroupFocusStudyPlanItem[] {
  return items.map((item, index) => ({
    ...item,
    sequence: index + 1,
    resources: item.resources.map((resource, resourceIndex) => ({
      ...resource,
      sequence: resourceIndex + 1,
    })),
  }));
}

function resourceLabel(
  lecture: DatabaseLecture,
  resource: GroupFocusStudyResourceSelection,
  language: Language,
): string {
  if (resource.resourceType === "MCQ_SET") return language === "ar" ? "الأسئلة MCQ" : "MCQs";
  if (resource.resourceType === "FLASHCARD_SET") return language === "ar" ? "البطاقات" : "Flashcards";
  const material = lecture.materials?.find((candidate) => candidate.id === resource.resourceId);
  if (material?.title) return material.title;
  if (resource.resourceType === "VIDEO") return language === "ar" ? "فيديو" : "Video";
  if (resource.resourceType === "NOTE") return language === "ar" ? "الملاحظات" : "Notes";
  return language === "ar" ? "ملف PDF" : "PDF";
}

function ResourceIcon({ type }: { type: GroupFocusStudyResourceSelection["resourceType"] }) {
  if (type === "VIDEO") return <Video className="h-3.5 w-3.5" aria-hidden="true" />;
  if (type === "MCQ_SET" || type === "FLASHCARD_SET") {
    return <Layers3 className="h-3.5 w-3.5" aria-hidden="true" />;
  }
  return <FileText className="h-3.5 w-3.5" aria-hidden="true" />;
}

export function GroupFocusStudyPlanEditor({
  language,
  lectures,
  subjects,
  catalogStatus,
  value,
  onChange,
  onRefresh,
  title,
  description,
  required = true,
}: Props) {
  const isRtl = language === "ar";
  const [pickerOpen, setPickerOpen] = useState(false);
  const lectureMap = useMemo(() => new Map(lectures.map((lecture) => [lecture.id, lecture])), [lectures]);

  const queuedItems = useMemo<FocusPlanDraftItem[]>(() => value.map((item) => ({
    lectureId: item.lectureId,
    sessionCount: 1,
    includeMcq: item.resources.some((resource) => resource.resourceType === "MCQ_SET"),
    includeFlashcards: item.resources.some((resource) => resource.resourceType === "FLASHCARD_SET"),
    includeVideo: item.resources.some((resource) => resource.resourceType === "VIDEO"),
    resources: item.resources,
  })), [value]);

  const copy = isRtl ? {
    title: title || "خطة الدراسة",
    description: description || "أضف محاضرة أو أكثر وحدد المصادر التي ستدرسها داخل كل محاضرة.",
    add: "إضافة محاضرة",
    selectAll: "تحديد الكل",
    clear: "إلغاء الكل",
    resources: "مصادر الدراسة",
    noResources: "لا توجد مصادر دراسة متاحة لهذه المحاضرة.",
    remove: "حذف المحاضرة",
    up: "تحريك للأعلى",
    down: "تحريك للأسفل",
    empty: "لم تضف أي محاضرة بعد.",
    emptyHelp: "يمكنك إضافة عدة محاضرات وترتيبها كما تريد.",
    required: "أضف محاضرة واحدة على الأقل ومصدر دراسة واحد على الأقل.",
  } : {
    title: title || "Study plan",
    description: description || "Add one or more lectures and choose exactly what you want to study in each one.",
    add: "Add lecture",
    selectAll: "Select all",
    clear: "Clear",
    resources: "Study resources",
    noResources: "No study resources are available for this lecture.",
    remove: "Remove lecture",
    up: "Move up",
    down: "Move down",
    empty: "No lectures added yet.",
    emptyHelp: "Add several lectures and arrange them in the order you want to study.",
    required: "Add at least one lecture and at least one study resource.",
  };

  const addLecture = (lecture: DatabaseLecture) => {
    if (value.some((item) => item.lectureId === lecture.id)) return;
    const resources = focusResourcesForLecture(lecture).map((resource, index) => ({
      resourceType: resource.resourceType,
      resourceId: resource.resourceId,
      sequence: index + 1,
    })) as GroupFocusStudyResourceSelection[];
    onChange(normalizePlan([...value, {
      lectureId: lecture.id,
      sequence: value.length + 1,
      resources,
    }]));
    setPickerOpen(false);
  };

  const updateResources = (lectureId: string, resources: GroupFocusStudyResourceSelection[]) => {
    onChange(normalizePlan(value.map((item) => item.lectureId === lectureId
      ? { ...item, resources }
      : item)));
  };

  const toggleResource = (lectureId: string, resource: GroupFocusStudyResourceSelection) => {
    const item = value.find((candidate) => candidate.lectureId === lectureId);
    if (!item) return;
    const exists = item.resources.some((candidate) =>
      candidate.resourceType === resource.resourceType && candidate.resourceId === resource.resourceId);
    const next = exists
      ? item.resources.filter((candidate) => !(candidate.resourceType === resource.resourceType && candidate.resourceId === resource.resourceId))
      : [...item.resources, resource];
    updateResources(lectureId, next.map((candidate, index) => ({ ...candidate, sequence: index + 1 })));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(normalizePlan(next));
  };

  const isValid = !required || (value.length > 0 && value.every((item) => item.resources.length > 0));

  return (
    <section className="rounded-[24px] border border-sky-100/90 bg-white/75 p-4 shadow-[0_14px_40px_rgba(52,105,160,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.045] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-blue-600 dark:bg-sky-300/10 dark:text-sky-200">
              <BookOpen className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{copy.title}</h3>
              <p className="mt-0.5 max-w-2xl text-xs leading-5 text-slate-500 dark:text-slate-400">{copy.description}</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 px-4 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(59,130,246,0.22)] transition hover:brightness-[1.03] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />{copy.add}
        </button>
      </div>

      {value.length === 0 ? (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="mt-4 flex w-full flex-col items-center justify-center rounded-2xl border border-dashed border-sky-200 bg-sky-50/45 px-4 py-7 text-center transition hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-sky-300/15 dark:bg-sky-300/[0.04]"
        >
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{copy.empty}</span>
          <span className="mt-1 text-xs text-slate-500 dark:text-slate-400">{copy.emptyHelp}</span>
        </button>
      ) : (
        <ol className="mt-4 space-y-3">
          {value.map((item, index) => {
            const lecture = lectureMap.get(item.lectureId);
            if (!lecture) return null;
            const allResources = focusResourcesForLecture(lecture).map((resource, resourceIndex) => ({
              resourceType: resource.resourceType,
              resourceId: resource.resourceId,
              sequence: resourceIndex + 1,
            })) as GroupFocusStudyResourceSelection[];
            const selectedKeys = new Set(item.resources.map((resource) => `${resource.resourceType}:${resource.resourceId}`));
            return (
              <li key={item.lectureId} className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 dark:border-white/10 dark:bg-white/[0.035]">
                <div className="flex items-center gap-3 border-b border-slate-100 px-3 py-3 dark:border-white/10 sm:px-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-bold text-slate-600 dark:bg-white/[0.07] dark:text-slate-200">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-white" dir="auto">{lecture.name}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{item.resources.length} / {allResources.length} {copy.resources.toLocaleLowerCase(language)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={copy.up} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-25 dark:hover:bg-white/10 dark:hover:text-white"><ChevronUp className="h-4 w-4" /></button>
                    <button type="button" onClick={() => move(index, 1)} disabled={index === value.length - 1} aria-label={copy.down} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-25 dark:hover:bg-white/10 dark:hover:text-white"><ChevronDown className="h-4 w-4" /></button>
                    <button type="button" onClick={() => onChange(normalizePlan(value.filter((candidate) => candidate.lectureId !== item.lectureId)))} aria-label={copy.remove} className="flex h-9 w-9 items-center justify-center rounded-xl text-rose-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-400/10"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                <div className="px-3 py-3 sm:px-4">
                  <div className="mb-2.5 flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">{copy.resources}</p>
                    {allResources.length > 0 && (
                      <div className="flex items-center gap-3 text-[11px] font-semibold">
                        <button type="button" onClick={() => updateResources(item.lectureId, allResources)} className="text-sky-600 hover:text-sky-700 dark:text-sky-300">{copy.selectAll}</button>
                        <button type="button" onClick={() => updateResources(item.lectureId, [])} className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white">{copy.clear}</button>
                      </div>
                    )}
                  </div>
                  {allResources.length === 0 ? (
                    <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500 dark:bg-white/[0.04] dark:text-slate-400">{copy.noResources}</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {allResources.map((resource) => {
                        const key = `${resource.resourceType}:${resource.resourceId}`;
                        const selected = selectedKeys.has(key);
                        return (
                          <button
                            type="button"
                            key={key}
                            onClick={() => toggleResource(item.lectureId, resource)}
                            aria-pressed={selected}
                            className={`inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${selected
                              ? "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-300/30 dark:bg-sky-300/10 dark:text-sky-100"
                              : "border-slate-200 bg-white text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400"}`}
                          >
                            {selected ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <ResourceIcon type={resource.resourceType} />}
                            <span dir="auto">{resourceLabel(lecture, resource, language)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {!isValid && value.length > 0 && (
        <p className="mt-3 text-xs font-medium text-rose-600 dark:text-rose-300">{copy.required}</p>
      )}

      <FocusLecturePicker
        isOpen={pickerOpen}
        lectures={lectures}
        subjects={subjects}
        queuedItems={queuedItems}
        language={language}
        catalogStatus={catalogStatus}
        onClose={() => setPickerOpen(false)}
        onSelect={addLecture}
        onRefresh={onRefresh}
      />
    </section>
  );
}
