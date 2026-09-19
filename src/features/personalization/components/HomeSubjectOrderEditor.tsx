import React, { memo } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical } from "lucide-react";
import {
  useTranslation,
  type Language,
} from "../../../core/i18n/translations";
import {
  moveSubject,
} from "../homeSubjectOrder";
import type { SubjectId } from "../../../../shared/personalization";
import {
  getHomeSubjectVisibilityReason,
  type SemesterVisibility,
} from "../homeSubjectVisibility";

export const HOME_SUBJECT_NAME_KEYS = {
  ID: "my99SubjectIdName",
  NT: "my99SubjectNtName",
  RM: "my99SubjectRmName",
  CA: "my99SubjectCaName",
  PHC: "my99SubjectPhcName",
  ImD: "my99SubjectImdName",
  SSC: "my99SubjectSscName",
} as const satisfies Record<SubjectId, string>;

interface HomeSubjectOrderEditorProps {
  language: Language;
  subjectOrder: readonly SubjectId[];
  hiddenSubjectIds: readonly SubjectId[];
  semesterVisibility: SemesterVisibility;
  onChange: (subjectOrder: SubjectId[]) => void;
  onHiddenSubjectIdsChange: (hiddenSubjectIds: SubjectId[]) => void;
}

export const HomeSubjectOrderEditor = memo(function HomeSubjectOrderEditor({
  language,
  subjectOrder,
  hiddenSubjectIds,
  semesterVisibility,
  onChange,
  onHiddenSubjectIdsChange,
}: HomeSubjectOrderEditorProps) {
  const { t } = useTranslation(language);
  return (
    <ol
      className="space-y-2"
      aria-label={t("my99HomeSubjectOrderTitle")}
    >
      {subjectOrder.map((subjectId, index) => {
        const subjectName = t(HOME_SUBJECT_NAME_KEYS[subjectId]);
        const isFirst = index === 0;
        const isLast = index === subjectOrder.length - 1;
        const isManuallyHidden = hiddenSubjectIds.includes(subjectId);
        const visibilityReason = getHomeSubjectVisibilityReason(
          subjectId,
          hiddenSubjectIds,
          semesterVisibility,
        );
        const effectiveStatus =
          visibilityReason === "visible"
            ? t("my99ShownOnHome")
            : visibilityReason === "hidden-manually"
              ? t("my99HiddenManually")
              : visibilityReason === "hidden-by-semester-1"
                ? t("my99HiddenBySemester1")
                : t("my99HiddenBySemester2");

        return (
          <li
            key={subjectId}
            className="flex items-center gap-2 rounded-xl border border-semantic-border-default bg-semantic-surface-primary px-3 py-2.5 shadow-elevation-1"
          >
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-semantic-surface-muted text-xs font-semibold text-semantic-content-secondary"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <GripVertical
              className="h-4 w-4 shrink-0 text-semantic-content-subtle"
              aria-hidden="true"
            />
              <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-semantic-content-primary">
                {subjectName}
              </span>
               <span className="text-xs text-semantic-content-secondary">{subjectId}</span>
               <span className="mt-1 block text-xs font-medium text-semantic-content-secondary">
                 {effectiveStatus}
               </span>
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label={`${t("my99MoveUp")} ${subjectName}`}
                onClick={() =>
                  onChange(moveSubject(subjectOrder, subjectId, "up"))
                }
                disabled={isFirst}
                className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-semantic-content-secondary transition-colors hover:bg-semantic-chrome-surface-hover hover:text-semantic-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-focus-ring disabled:pointer-events-none disabled:opacity-35"
              >
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`${t("my99MoveDown")} ${subjectName}`}
                onClick={() =>
                  onChange(moveSubject(subjectOrder, subjectId, "down"))
                }
                disabled={isLast}
                className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-semantic-content-secondary transition-colors hover:bg-semantic-chrome-surface-hover hover:text-semantic-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-focus-ring disabled:pointer-events-none disabled:opacity-35"
              >
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-pressed={!isManuallyHidden}
                aria-label={`${isManuallyHidden ? t("my99ShowSubject") : t("my99HideSubject")} ${subjectName}`}
                onClick={() => {
                  const next = hiddenSubjectIds.filter((id) => id !== subjectId);
                  if (!isManuallyHidden) next.push(subjectId);
                  onHiddenSubjectIdsChange(next);
                }}
                className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-semantic-content-secondary transition-colors hover:bg-semantic-chrome-surface-hover hover:text-semantic-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-focus-ring"
              >
                {isManuallyHidden ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
});