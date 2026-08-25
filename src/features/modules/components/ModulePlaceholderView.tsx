import React, { memo } from "react";
import { ChevronLeft } from "lucide-react";
import type { Subject } from "../../../core/types";
import { getSubjectIconInfo } from "../../../core/utils/subjectIcons";

interface ModulePlaceholderViewProps {
  subject: Subject;
  onBack: () => void;
  language: "en" | "ar";
}

export const ModulePlaceholderView = memo(function ModulePlaceholderView({ subject, onBack, language }: ModulePlaceholderViewProps) {
  const iconInfo = getSubjectIconInfo(subject.id);
  const Icon = iconInfo.icon;

  return (
    <section className="min-h-[70vh] w-full pt-2">
      <button
        type="button"
        onClick={onBack}
        className="mb-7 inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-[15px] font-medium text-blue-600 transition-opacity hover:opacity-80 active:opacity-60 dark:text-blue-400"
      >
        <ChevronLeft className="h-5 w-5" />
        {language === "ar" ? "رجوع" : "Back"}
      </button>

      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${iconInfo.bg} ${iconInfo.text}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-neutral-400 dark:text-neutral-500">{subject.id} Module</div>
          <h1 className="mt-1 text-large-title font-display font-semibold tracking-[-0.025em] text-neutral-950 dark:text-white">{subject.name}</h1>
        </div>
      </div>

      <div className="min-h-[52vh]" aria-hidden="true" />
    </section>
  );
});

export default ModulePlaceholderView;
