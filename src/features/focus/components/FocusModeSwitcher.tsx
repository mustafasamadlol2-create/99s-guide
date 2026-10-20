import { useId, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Target } from "lucide-react";
import type { Language } from "../../../core/i18n/translations";

export function FocusModeSwitcher({
  language,
  mode,
  onSolo,
  onGroup,
}: {
  language: Language;
  mode: "solo" | "group";
  onSolo: () => void;
  onGroup: () => void;
}) {
  const solo = language === "ar" ? "تركيز فردي" : "Solo Focus";
  const group = language === "ar" ? "تركيز جماعي" : "Group Focus";
  const layoutId = useId();
  const tab = (value: "solo" | "group", label: string, onClick: () => void) => {
    const selected = mode === value;
    return (
      <motion.button
        type="button"
        role="tab"
        aria-selected={selected}
        onClick={onClick}
        whileTap={{ scale: 0.965 }}
        transition={{ type: "spring", stiffness: 560, damping: 36, mass: 0.55 }}
        className={`relative isolate min-h-8 overflow-hidden rounded-xl px-3.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 sm:px-4 sm:text-sm ${selected ? "text-white" : "text-slate-500 hover:text-sky-700 dark:text-slate-300 dark:hover:text-white"}`}
      >
        {selected && (
          <motion.span
            layoutId={`focus-mode-pill-${layoutId}`}
            className="absolute inset-0 -z-10 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 shadow-[0_5px_15px_rgba(59,130,246,0.28)]"
            transition={{ type: "spring", stiffness: 470, damping: 34, mass: 0.62 }}
          />
        )}
        <span className="relative z-10">{label}</span>
      </motion.button>
    );
  };
  return (
    <motion.div
      role="tablist"
      aria-label={language === "ar" ? "نوع جلسة التركيز" : "Focus mode"}
      className="inline-flex min-h-10 shrink-0 items-center rounded-2xl border border-sky-100/90 bg-white/75 p-1 shadow-[0_6px_20px_rgba(58,116,173,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.05]"
      initial={false}
      animate={{ scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 38 }}
    >
      {tab("solo", solo, onSolo)}
      {tab("group", group, onGroup)}
    </motion.div>
  );
}

export function FocusHubRouteHeader({
  language,
  action,
}: {
  language: Language;
  action: ReactNode;
}) {
  return (
    <header className="mx-auto flex w-full max-w-[1440px] items-center justify-between gap-3 px-4 pt-4 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-sky-200/80 bg-white text-blue-600 shadow-[0_7px_18px_rgba(58,116,173,0.12)] dark:border-white/10 dark:bg-white/[0.06] dark:text-sky-200">
          <Target className="size-6" aria-hidden="true" />
        </span>
        <h1 className="truncate text-2xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-[28px]">
          {language === "ar" ? "مركز التركيز" : "Focus Hub"}
        </h1>
      </div>
      {action}
    </header>
  );
}
