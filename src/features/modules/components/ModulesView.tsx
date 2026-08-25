import React, { memo } from "react";
import { BookOpen, Database, GraduationCap } from "lucide-react";
import type { Subject, SubjectId } from "../../../core/types";
import { getSubjectIconInfo } from "../../../core/utils/subjectIcons";

import clinicalAttachmentImage from "../assets/clinical-attachment.webp";
import immuneDisturbancesImage from "../assets/immune-disturbances.webp";
import infectiousDiseasesImage from "../assets/infectious-diseases.webp";
import nutritionImage from "../assets/nutrition.webp";
import publicHealthCareImage from "../assets/public-health-care.webp";
import researchMethodologyImage from "../assets/research-methodology.webp";
import studentSelectedComponentImage from "../assets/student-selected-component.webp";

interface ModulesViewProps {
  subjects: Subject[];
  lectureCounts: Record<string, number>;
  progressBySubject: Map<string, { totalTasks: number; completedTasks: number; progressPercentage: number }>;
  onSelectModule: (subjectId: SubjectId) => void;
  language: "en" | "ar";
}

const MODULE_ORDER: SubjectId[] = ["PHC", "RM", "CA", "SSC", "ImD", "ID", "NT"];

const MODULE_META: Record<SubjectId, {
  credits: number;
  hours: number;
  image: string;
  accent: string;
  accentRgb: string;
  surfaceClass: string;
}> = {
  ID: { credits: 5, hours: 15, image: infectiousDiseasesImage, accent: "#34D399", accentRgb: "52,211,153", surfaceClass: "bg-[#F0FBF7] dark:bg-[#11241F]" },
  NT: { credits: 3, hours: 9, image: nutritionImage, accent: "#A78BFA", accentRgb: "167,139,250", surfaceClass: "bg-[#F7F3FF] dark:bg-[#211D2B]" },
  RM: { credits: 3, hours: 9, image: researchMethodologyImage, accent: "#7DD3FC", accentRgb: "125,211,252", surfaceClass: "bg-[#F1FAFE] dark:bg-[#17252B]" },
  CA: { credits: 4, hours: 12, image: clinicalAttachmentImage, accent: "#FDA4AF", accentRgb: "253,164,175", surfaceClass: "bg-[#FFF4F5] dark:bg-[#2B1D21]" },
  PHC: { credits: 2, hours: 6, image: publicHealthCareImage, accent: "#F6C76F", accentRgb: "246,199,111", surfaceClass: "bg-[#FFF9EB] dark:bg-[#282217]" },
  ImD: { credits: 3, hours: 9, image: immuneDisturbancesImage, accent: "#A5B4FC", accentRgb: "165,180,252", surfaceClass: "bg-[#F4F5FF] dark:bg-[#20212D]" },
  SSC: { credits: 2, hours: 6, image: studentSelectedComponentImage, accent: "#D1D5DB", accentRgb: "209,213,219", surfaceClass: "bg-[#F7F7F8] dark:bg-[#202124]" },
};

function MetricChip({ icon: Icon, value, label }: {
  icon: React.ComponentType<{ className?: string }>;
  value: React.ReactNode;
  label: string;
}) {
  return (
    <div className="inline-flex items-center gap-2.5 rounded-xl border border-black/[0.045] bg-neutral-100/90 px-4 py-2.5 shadow-sm dark:border-white/[0.07] dark:bg-[#1C1C1E] dark:shadow-none">
      <Icon className="h-4 w-4 text-neutral-500 dark:text-[#EBEBF599]" />
      <span className="text-[13px] font-medium text-neutral-700 dark:text-[#EBEBF599]">
        <strong className="font-semibold text-neutral-950 dark:text-white">{value}</strong>{" "}{label}
      </span>
    </div>
  );
}

export const ModulesView = memo(function ModulesView({ subjects, lectureCounts, progressBySubject, onSelectModule, language }: ModulesViewProps) {
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  const orderedSubjects = MODULE_ORDER.map((id) => subjectById.get(id)).filter((subject): subject is Subject => Boolean(subject));
  const totalLectures = orderedSubjects.reduce((sum, subject) => sum + (lectureCounts[subject.id] || 0), 0);

  return (
    <section className="w-full pb-8" aria-label={language === "ar" ? "الموديولات" : "Modules"}>
      <header className="flex flex-col gap-5 pt-4 pb-7">
        <div className="flex flex-col gap-2.5">
          <h1 className="hidden md:block text-large-title font-display font-semibold tracking-[-0.025em] text-neutral-950 dark:text-white">
            {language === "ar" ? "الموديولات" : "Modules"}
          </h1>
          <p className="max-w-2xl text-subhead font-medium text-neutral-500 dark:text-[#EBEBF599]">
            {language === "ar" ? "استعرض كل موديول مع الكريديت والمحاضرات والساعات الدراسية." : "Explore each module with its credits, lectures, and lecture hours."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <MetricChip icon={Database} value={orderedSubjects.length} label={language === "ar" ? "موديولات" : "Modules"} />
          <MetricChip icon={BookOpen} value={totalLectures} label={language === "ar" ? "محاضرة" : "Lectures"} />
          <MetricChip icon={GraduationCap} value={30} label={language === "ar" ? "ساعة كريديت" : "Credit Hours"} />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {orderedSubjects.map((subject, index) => {
          const meta = MODULE_META[subject.id];
          const iconInfo = getSubjectIconInfo(subject.id);
          const Icon = iconInfo.icon;
          const lectures = lectureCounts[subject.id] || 0;
          const progress = progressBySubject.get(subject.id)?.progressPercentage || 0;

          return (
            <button
              key={subject.id}
              type="button"
              onClick={() => onSelectModule(subject.id)}
              className="group relative isolate flex min-h-[372px] w-full flex-col overflow-hidden rounded-[22px] border border-black/[0.06] text-left shadow-[0_12px_34px_rgba(15,23,42,0.08)] transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(15,23,42,0.12)] active:translate-y-0 dark:border-white/[0.08] dark:shadow-[0_16px_40px_rgba(0,0,0,0.28)]"
              aria-label={`${subject.name} module`}
            >
              <div className="relative aspect-[16/9] w-full overflow-hidden bg-neutral-100 dark:bg-neutral-900">
                <img
                  src={meta.image}
                  alt=""
                  loading={index < 4 ? "eager" : "lazy"}
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.015]"
                  draggable={false}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-black/10" />
                <div
                  className="absolute left-4 top-4 flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur-xl"
                  style={{
                    color: meta.accent,
                    backgroundColor: `rgba(${meta.accentRgb},0.18)`,
                    borderColor: `rgba(${meta.accentRgb},0.32)`,
                    boxShadow: `0 8px 22px rgba(${meta.accentRgb},0.14)`,
                  }}
                >
                  <Icon className="h-5 w-5" />
                </div>
              </div>

              <div
                className={`flex flex-1 flex-col px-[18px] pb-[18px] pt-4 ${meta.surfaceClass}`}
                style={{ backgroundImage: `linear-gradient(180deg, rgba(${meta.accentRgb},0.045), transparent 48%)` }}
              >
                <h2 className="min-h-[56px] text-[19px] font-semibold leading-[1.22] tracking-[-0.02em] text-neutral-950 dark:text-white sm:text-[20px]">
                  {subject.name}
                </h2>

                <div className="mt-3 grid grid-cols-3 border-y border-black/[0.07] py-3.5 dark:border-white/[0.08]">
                  <div className="pr-3">
                    <div className="text-[11px] font-medium text-neutral-500 dark:text-[#EBEBF599]">Credits</div>
                    <div className="mt-1 text-[20px] font-medium leading-none text-neutral-900 dark:text-white">{meta.credits}</div>
                  </div>
                  <div className="border-x border-black/[0.07] px-3 dark:border-white/[0.08]">
                    <div className="text-[11px] font-medium text-neutral-500 dark:text-[#EBEBF599]">Lectures</div>
                    <div className="mt-1 text-[20px] font-medium leading-none text-neutral-900 dark:text-white">{lectures}</div>
                  </div>
                  <div className="pl-3 text-right">
                    <div className="text-[11px] font-medium text-neutral-500 dark:text-[#EBEBF599]">Hours</div>
                    <div className="mt-1 text-[20px] font-medium leading-none text-neutral-900 dark:text-white">{meta.hours}</div>
                  </div>
                </div>

                <div className="mt-auto flex items-center justify-between pt-4">
                  <span className="text-[12px] font-medium text-neutral-500 dark:text-[#EBEBF599]">{progress >= 100 ? "Completed" : "In progress"}</span>
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-full border text-[11px] font-bold"
                    style={{
                      color: meta.accent,
                      borderColor: `rgba(${meta.accentRgb},0.20)`,
                      backgroundColor: `rgba(${meta.accentRgb},0.08)`,
                      boxShadow: `inset 0 0 0 3px rgba(${meta.accentRgb},0.06)`,
                    }}
                  >
                    {progress}%
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
});

export default ModulesView;
