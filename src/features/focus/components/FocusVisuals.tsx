import { Coffee, ListChecks, Target } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { useTranslation, type Language } from "../../../core/i18n/translations";
import "./FocusTimerScene.css";

export type FocusDisplayPhase = "focus" | "break" | "plan";

export function FocusCycleStrip({
  language,
  focusMinutes,
  breakMinutes,
  plannedSessions,
  activePhase = "focus",
  onPhaseChange,
  tabPanelId,
  idPrefix = "focus-cycle",
  className = "",
}: {
  language: Language;
  focusMinutes: number;
  breakMinutes: number;
  plannedSessions: number;
  activePhase?: FocusDisplayPhase;
  onPhaseChange?: (phase: FocusDisplayPhase) => void;
  tabPanelId?: string;
  idPrefix?: string;
  className?: string;
}) {
  const { t } = useTranslation(language);
  const numberFormat = new Intl.NumberFormat(language, { maximumFractionDigits: 0 });
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const phases = [
    {
      id: "focus",
      label: t("focusActiveStudyPhase"),
      detail: `${numberFormat.format(focusMinutes)} ${t("focusHubMinShort")}`,
      icon: Target,
    },
    {
      id: "break",
      label: t("focusHubShortBreak"),
      detail: `${numberFormat.format(breakMinutes)} ${t("focusHubMinShort")}`,
      icon: Coffee,
    },
    {
      id: "plan",
      label: t("focusHubCyclePlan"),
      detail: `${numberFormat.format(plannedSessions)} ${t("focusHubSessionCount").toLocaleLowerCase(language)}`,
      icon: ListChecks,
    },
  ] as const;

  return (
    <div
      role={onPhaseChange ? "tablist" : "group"}
      aria-label={t("focusHubCycleLabel")}
      className={`focus-hub-cycle order-2 flex min-w-0 items-center rounded-full border border-white/90 bg-white/80 p-1.5 shadow-[0_10px_28px_rgba(60,117,158,0.10)] backdrop-blur-sm lg:col-start-1 lg:row-start-2 ${className}`}
    >
      {phases.map(({ id, label, detail, icon: Icon }, index) => {
        const isActive = id === activePhase;
        const contents = (
          <>
            <Icon className={`size-4 shrink-0 sm:size-5 ${isActive ? "text-white" : "text-slate-500"}`} aria-hidden="true" />
            <span className="min-w-0 text-start leading-tight">
              <span className="block truncate text-[11px] font-semibold sm:text-sm">{label}</span>
              <span className={`mt-0.5 block truncate text-[9px] font-medium sm:text-[11px] ${isActive ? "text-white/85" : "text-slate-500"}`}>
                <bdi dir="auto">{detail}</bdi>
              </span>
            </span>
          </>
        );
        const optionClassName = `flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-1.5 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 sm:gap-2 sm:px-3 ${
          isActive
            ? "bg-gradient-to-r from-[#4294ec] to-[#4c66e8] text-white shadow-[0_5px_14px_rgba(59,111,223,0.28)]"
            : "text-slate-600 hover:bg-sky-50"
        }`;

        if (onPhaseChange) {
          return (
            <button
              key={id}
              ref={(element) => {
                buttonRefs.current[index] = element;
              }}
              id={`${idPrefix}-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={tabPanelId}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onPhaseChange(id)}
              onKeyDown={(event) => {
                const forwardKey = language === "ar" ? "ArrowLeft" : "ArrowRight";
                const backwardKey = language === "ar" ? "ArrowRight" : "ArrowLeft";
                let nextIndex: number | null = null;
                if (event.key === forwardKey) nextIndex = (index + 1) % phases.length;
                else if (event.key === backwardKey) nextIndex = (index - 1 + phases.length) % phases.length;
                else if (event.key === "Home") nextIndex = 0;
                else if (event.key === "End") nextIndex = phases.length - 1;
                if (nextIndex === null) return;
                event.preventDefault();
                onPhaseChange(phases[nextIndex].id);
                buttonRefs.current[nextIndex]?.focus();
              }}
              className={optionClassName}
            >
              {contents}
            </button>
          );
        }

        return (
          <div key={id} aria-current={isActive ? "step" : undefined} className={optionClassName}>
            {contents}
          </div>
        );
      })}
    </div>
  );
}

export function FocusTimerScene({
  children,
  progress = 0.74,
  className = "",
  variant = "standard",
  controls,
}: {
  children: ReactNode;
  progress?: number;
  className?: string;
  variant?: "standard" | "planner" | "active" | "break";
  controls?: ReactNode;
}) {
  const progressValue = Math.max(0, Math.min(1, progress));

  return (
    <div className={`focus-timer-scene focus-timer-scene--${variant} ${className}`}>
      <svg className="focus-timer-wave-art" viewBox="0 0 1280 540" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path
          className="focus-timer-wave-line focus-timer-wave-line--upper"
          d="M-60 142 C78 56 176 44 282 112 S468 196 592 112 S821 48 940 122 S1133 201 1340 76"
        />
        <path
          className="focus-timer-wave-line focus-timer-wave-line--middle"
          d="M-80 248 C66 161 181 172 291 235 S470 319 610 229 S833 161 958 238 S1149 307 1360 187"
        />
        <path
          className="focus-timer-wave-line focus-timer-wave-line--lower"
          d="M-80 402 C70 320 182 323 300 385 S478 469 620 381 S848 309 974 386 S1150 451 1360 324"
        />
      </svg>
      <span className="focus-timer-aura focus-timer-aura--left" aria-hidden="true" />
      <span className="focus-timer-aura focus-timer-aura--right" aria-hidden="true" />

      <div className="focus-timer-glass-panel">
        <div className="focus-timer-content">{children}</div>

        <div className="focus-timer-progress-track" aria-hidden="true">
          <span
            className="focus-timer-progress-fill"
            style={{ width: `${progressValue * 100}%` }}
          />
        </div>

        {controls && (
          <div className="focus-timer-controls">
            {controls}
          </div>
        )}
      </div>
    </div>
  );
}