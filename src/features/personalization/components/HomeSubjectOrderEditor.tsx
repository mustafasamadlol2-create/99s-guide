import React, { memo, useMemo } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import {
  useTranslation,
  type Language,
} from "../../../core/i18n/translations";
import {
  moveSubject,
} from "../homeSubjectOrder";
import type { SubjectId } from "../../../../shared/personalization";

const SUBJECT_NAME_KEYS = {
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
  onChange: (subjectOrder: SubjectId[]) => void;
}

export const HomeSubjectOrderEditor = memo(function HomeSubjectOrderEditor({
  language,
  subjectOrder,
  onChange,
}: HomeSubjectOrderEditorProps) {
  const { t } = useTranslation(language);
  return (
    <ol
      className="space-y-2"
      aria-label={t("my99HomeSubjectOrderTitle")}
    >
      {subjectOrder.map((subjectId, index) => {
        const subjectName = t(SUBJECT_NAME_KEYS[subjectId]);
        const isFirst = index === 0;
        const isLast = index === subjectOrder.length - 1;

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
              <span className="text-xs text-semantic-content-secondary">
                {subjectId}
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
            </div>
          </li>
        );
      })}
    </ol>
  );
});