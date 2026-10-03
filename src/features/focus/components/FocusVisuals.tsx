import { Coffee, ListChecks, Target } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";
import { useTranslation, type Language } from "../../../core/i18n/translations";

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
}: {
  children: ReactNode;
  progress?: number;
  className?: string;
  variant?: "standard" | "planner";
}) {
  const rawId = useId().replace(/:/g, "");
  const progressValue = Math.max(0, Math.min(1, progress));
  const circumference = 2 * Math.PI * 139;
  const plannerScene = variant === "planner";
  const backWavePath = plannerScene
    ? "M0 136 C95 99 132 155 215 124 C296 95 342 151 429 123 C524 92 581 156 655 117 C699 96 727 102 760 84 V360 H0Z"
    : "M0 183 C95 145 132 194 215 165 C296 137 342 193 429 166 C524 137 581 192 655 157 C699 137 727 143 760 130 V360 H0Z";
  const frontWavePath = plannerScene
    ? "M0 181 C91 145 149 200 240 165 C328 130 385 194 483 157 C586 119 655 182 760 139 V360 H0Z"
    : "M0 231 C91 190 149 245 240 207 C328 170 385 237 483 196 C586 153 655 218 760 181 V360 H0Z";
  const nearWavePath = plannerScene
    ? "M0 228 C111 189 181 245 285 210 C381 175 449 230 540 198 C630 165 686 206 760 176 V360 H0Z"
    : "M0 272 C111 229 181 290 285 250 C381 214 449 271 540 242 C630 213 686 251 760 228 V360 H0Z";

  return (
    <div
      className={`relative isolate flex min-h-[330px] items-center justify-center overflow-hidden rounded-[30px] border border-sky-100 bg-[radial-gradient(ellipse_at_50%_40%,rgba(255,255,255,0.98)_0%,rgba(237,247,255,0.88)_42%,rgba(223,239,255,0.82)_100%)] px-3 py-6 shadow-[0_18px_45px_rgba(55,119,171,0.10)] dark:border-sky-300/15 dark:bg-[radial-gradient(ellipse_at_50%_40%,rgba(36,54,77,0.92)_0%,rgba(22,36,55,0.95)_50%,rgba(15,27,43,0.98)_100%)] sm:min-h-[365px] sm:px-5 ${className}`}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-12 -top-20 size-56 rounded-full bg-white/85 blur-3xl dark:bg-sky-300/10" />
        <div className="absolute -right-12 top-4 size-48 rounded-full bg-sky-200/60 blur-3xl dark:bg-blue-400/10" />
        <svg className={`focus-timer-landscape absolute inset-x-0 bottom-0 h-[76%] w-full opacity-70 dark:opacity-20 ${plannerScene ? "focus-timer-landscape-planner" : ""}`} viewBox="0 0 760 360" preserveAspectRatio="none" focusable="false">
          <defs>
            <linearGradient id={`focus-mountain-back-${rawId}`} x1="0" x2="0" y1="0" y2="1">
              <stop className="focus-mountain-back-start" offset="0%" stopColor="#d9eaff" stopOpacity="0.74" />
              <stop className="focus-mountain-back-end" offset="100%" stopColor="#b8d6f5" stopOpacity="0.32" />
            </linearGradient>
            <linearGradient id={`focus-mountain-front-${rawId}`} x1="0" x2="0" y1="0" y2="1">
              <stop className="focus-mountain-front-start" offset="0%" stopColor="#c8e0fa" stopOpacity="0.72" />
              <stop className="focus-mountain-front-end" offset="100%" stopColor="#a8cbee" stopOpacity="0.36" />
            </linearGradient>
          </defs>
          <path d={backWavePath} fill={`url(#focus-mountain-back-${rawId})`} />
          <path d={frontWavePath} fill={`url(#focus-mountain-front-${rawId})`} />
          <path className="focus-landscape-near" d={nearWavePath} fill="#dceeff" fillOpacity="0.62" />
        </svg>
        {plannerScene && (
          <span
            className="focus-timer-orb absolute right-[10%] top-[14%] block aspect-square w-[8.5%] min-w-8 max-w-[54px] rounded-full border border-white/50 bg-white/30 shadow-[0_0_30px_rgba(137,181,244,0.24)] dark:border-white/10 dark:bg-blue-300/20"
            aria-hidden="true"
          />
        )}
      </div>

      <div className={`focus-timer-ring relative z-10 aspect-square w-[min(74vw,340px)] max-w-full sm:w-[min(42vw,380px)] lg:w-[min(34vw,400px)] ${plannerScene ? "focus-timer-ring-planner" : ""}`}>
        <svg className="focus-timer-ring-svg absolute inset-0 size-full -rotate-90 drop-shadow-[0_10px_16px_rgba(47,113,218,0.18)]" viewBox="0 0 320 320" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={`focus-ring-gradient-${rawId}`} x1="0" x2="1" y1="0" y2="1">
              <stop className="focus-ring-start" offset="0%" stopColor="#4eb8f5" />
              <stop className="focus-ring-middle" offset="55%" stopColor="#347be8" />
              <stop className="focus-ring-end" offset="100%" stopColor="#574fe5" />
            </linearGradient>
          </defs>
          <circle className="focus-timer-ring-track" cx="160" cy="160" r="139" fill="none" stroke="#d9e9fa" strokeWidth="12" />
          <circle cx="160" cy="160" r="128" fill="none" stroke="white" strokeOpacity="0.8" strokeWidth="2" />
          <circle
            className="focus-timer-ring-progress"
            cx="160"
            cy="160"
            r="139"
            fill="none"
            stroke={`url(#focus-ring-gradient-${rawId})`}
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progressValue)}
          />
          <circle className="focus-timer-ring-marker" cx="299" cy="160" r="8" fill="#38a9f2" stroke="white" strokeWidth="5" />
        </svg>
        <div className="focus-timer-ring-center absolute inset-[9%] grid place-items-center rounded-full border border-white/90 bg-white/80 shadow-[inset_0_6px_22px_rgba(85,144,202,0.10),0_8px_28px_rgba(58,116,173,0.10)] backdrop-blur-md dark:border-white/10 dark:bg-slate-950/45">
          <div className="flex flex-col items-center justify-center px-3 text-center">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}