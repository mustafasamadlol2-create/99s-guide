import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, Search, X } from "lucide-react";
import type { DatabaseLecture, Subject } from "../../../core/types";
import { useTranslation, type Language } from "../../../core/i18n/translations";
import type { FocusPlanDraftItem } from "../focusHubModel";

type LectureCatalogStatus = "loading" | "ready" | "error";

interface FocusLecturePickerProps {
  isOpen: boolean;
  lectures: DatabaseLecture[];
  subjects: Subject[];
  queuedItems: FocusPlanDraftItem[];
  language: Language;
  catalogStatus: LectureCatalogStatus;
  onClose: () => void;
  onSelect: (lecture: DatabaseLecture) => void;
  onRefresh: () => Promise<void>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function FocusLecturePicker({
  isOpen,
  lectures,
  subjects,
  queuedItems,
  language,
  catalogStatus,
  onClose,
  onSelect,
  onRefresh,
}: FocusLecturePickerProps) {
  const isRtl = language === "ar";
  const [search, setSearch] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const { t } = useTranslation(language);

  const canonicalLectures = useMemo(
    () => lectures.filter((lecture) => UUID_PATTERN.test(lecture.id)),
    [lectures],
  );
  const subjectMap = useMemo(
    () => new Map(subjects.map((subject) => [subject.id, subject])),
    [subjects],
  );
  const subjectsInCatalog = useMemo(
    () => Array.from(new Set(canonicalLectures.map((lecture) => lecture.mainSubject))).sort(),
    [canonicalLectures],
  );
  const queuedIds = useMemo(
    () => new Set(queuedItems.map((item) => item.lectureId)),
    [queuedItems],
  );

  const filteredLectures = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(language);
    return canonicalLectures.filter((lecture) => {
      if (subjectId && lecture.mainSubject !== subjectId) return false;
      if (!query) return true;
      const subject = subjectMap.get(lecture.mainSubject as Subject["id"]);
      const searchable = [
        lecture.name,
        lecture.subSubject ?? "",
        lecture.mainSubject,
        subject?.name ?? "",
        subject?.nameAr ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase(language);
      return searchable.includes(query);
    });
  }, [canonicalLectures, language, search, subjectId, subjectMap]);

  useEffect(() => {
    if (!isOpen) return;
    triggerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    searchRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      triggerRef.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const getSubjectName = (id: string) => {
    const subject = subjectMap.get(id as Subject["id"]);
    return subject
      ? isRtl
        ? subject.nameAr || subject.name
        : subject.name
      : id;
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } catch {
      // The catalog's own status supplies the retry state and message.
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm md:items-center md:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="focus-lecture-picker-title"
        dir={isRtl ? "rtl" : "ltr"}
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] border border-white/70 bg-white shadow-2xl dark:border-white/10 dark:bg-[#17191f] md:rounded-[28px]"
        style={{
          paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-200/80 px-5 py-4 dark:border-white/10 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-200">
              <BookOpen className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="focus-lecture-picker-title" className="text-lg font-semibold text-slate-950 dark:text-white">
                {t("focusHubChooseLecture")}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t("focusHubFilterSubject")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("focusHubClose")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-white/10 dark:text-slate-300"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(180px,0.55fr)] sm:px-6">
          <label className="relative block">
            <span className="sr-only">{t("focusHubSearchLectures")}</span>
            <Search
              className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 ${isRtl ? "right-4" : "left-4"}`}
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("focusHubSearchLectures")}
              dir="auto"
              className={`h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 dark:border-white/10 dark:bg-white/[0.04] dark:text-white ${isRtl ? "pr-11 pl-4" : "pl-11 pr-4"}`}
            />
          </label>
          <label className="block">
            <span className="sr-only">{t("focusHubFilterSubject")}</span>
            <select
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
            >
              <option value="">{t("focusHubAllSubjects")}</option>
              {subjectsInCatalog.map((id) => (
                <option key={id} value={id}>
                  {getSubjectName(id)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 sm:px-6">
          {catalogStatus === "loading" && (
            <div className="space-y-3 py-2" aria-label={t("focusHubLoading")} aria-busy="true">
              {[0, 1, 2].map((index) => (
                <div key={index} className="h-[68px] animate-pulse rounded-2xl bg-slate-100 dark:bg-white/[0.05]" />
              ))}
            </div>
          )}

          {catalogStatus === "error" && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center dark:border-amber-400/20 dark:bg-amber-300/[0.06]">
              <p className="font-medium text-slate-900 dark:text-white">{t("focusHubNoLectures")}</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t("focusHubNoLecturesHelp")}</p>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={refreshing}
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
              >
                {refreshing ? t("focusHubLoading") : t("focusHubRetryLectures")}
              </button>
            </div>
          )}

          {catalogStatus === "ready" && canonicalLectures.length === 0 && (
            <div className="py-12 text-center">
              <p className="font-medium text-slate-900 dark:text-white">{t("focusHubNoLectures")}</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("focusHubNoLecturesHelp")}</p>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={refreshing}
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 disabled:opacity-60 dark:border-white/10 dark:text-slate-200"
              >
                {refreshing ? t("focusHubLoading") : t("focusHubRetryLectures")}
              </button>
            </div>
          )}

          {catalogStatus === "ready" && canonicalLectures.length > 0 && filteredLectures.length === 0 && (
            <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              {t("focusHubNoMatches")}
            </p>
          )}

          {catalogStatus === "ready" && filteredLectures.length > 0 && (
            <ul className="space-y-2">
              {filteredLectures.map((lecture) => {
                const isQueued = queuedIds.has(lecture.id);
                return (
                  <li key={lecture.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(lecture)}
                      className="flex min-h-[68px] w-full items-center gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 text-start transition hover:border-indigo-300 hover:bg-indigo-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-white/10 dark:bg-white/[0.025] dark:hover:border-indigo-300/30 dark:hover:bg-indigo-300/[0.06]"
                    >
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isQueued ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200" : "bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-300"}`}>
                        {isQueued ? <Check className="h-4 w-4" aria-hidden="true" /> : <BookOpen className="h-4 w-4" aria-hidden="true" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span dir="auto" className="block truncate font-medium text-slate-900 dark:text-white">
                          {lecture.name}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
                          {getSubjectName(lecture.mainSubject)}
                          {lecture.subSubject ? ` · ${lecture.subSubject}` : ""}
                        </span>
                      </span>
                      {isQueued && (
                        <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
                          {t("focusHubInQueue")}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}