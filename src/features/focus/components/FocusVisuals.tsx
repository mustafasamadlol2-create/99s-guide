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
}: {
  children: ReactNode;
  progress?: number;
  className?: string;
}) {
  const rawId = useId().replace(/:/g, "");
  const progressValue = Math.max(0, Math.min(1, progress));
  const circumference = 2 * Math.PI * 139;

  return (
    <div
      className={`relative isolate flex min-h-[330px] items-center justify-center overflow-hidden rounded-[30px] border border-sky-100 bg-[radial-gradient(ellipse_at_50%_40%,rgba(255,255,255,0.98)_0%,rgba(237,247,255,0.88)_42%,rgba(223,239,255,0.82)_100%)] px-3 py-6 shadow-[0_18px_45px_rgba(55,119,171,0.10)] dark:border-sky-300/15 dark:bg-[radial-gradient(ellipse_at_50%_40%,rgba(36,54,77,0.92)_0%,rgba(22,36,55,0.95)_50%,rgba(15,27,43,0.98)_100%)] sm:min-h-[365px] sm:px-5 ${className}`}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-12 -top-20 size-56 rounded-full bg-white/85 blur-3xl dark:bg-sky-300/10" />
        <div className="absolute -right-12 top-4 size-48 rounded-full bg-sky-200/60 blur-3xl dark:bg-blue-400/10" />
        <svg className="focus-timer-waves absolute inset-x-0 bottom-0 h-[76%] w-full opacity-70" viewBox="0 0 760 360" preserveAspectRatio="none" focusable="false">
          <defs>
            <linearGradient id={`focus-mountain-back-${rawId}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#d9eaff" stopOpacity="0.74" />
              <stop offset="100%" stopColor="#b8d6f5" stopOpacity="0.32" />
            </linearGradient>
            <linearGradient id={`focus-mountain-front-${rawId}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#c8e0fa" stopOpacity="0.72" />
              <stop offset="100%" stopColor="#a8cbee" stopOpacity="0.36" />
            </linearGradient>
          </defs>
          <circle cx="646" cy="106" r="34" fill="#fff" fillOpacity=".66" />
          <path d="M0 183 C95 145 132 194 215 165 C296 137 342 193 429 166 C524 137 581 192 655 157 C699 137 727 143 760 130 V360 H0Z" fill={`url(#focus-mountain-back-${rawId})`} />
          <path d="M0 231 C91 190 149 245 240 207 C328 170 385 237 483 196 C586 153 655 218 760 181 V360 H0Z" fill={`url(#focus-mountain-front-${rawId})`} />
          <path d="M0 268 C86 238 153 269 230 251 C330 227 382 266 471 247 C575 225 661 253 760 225 V360 H0Z" fill="#dceeff" fillOpacity="0.62" />
          <path d="M0 284 C115 256 190 294 294 277 C400 259 478 290 568 272 C651 256 707 273 760 261 V360 H0Z" fill="#c8e3fb" fillOpacity="0.55" />
          <path d="M0 302 C113 285 200 309 302 297 C403 285 503 311 596 295 C669 282 724 297 760 289" fill="none" stroke="#f8fcff" strokeOpacity=".78" strokeWidth="3" />
          <path d="M0 320 C104 306 210 330 326 315 C442 301 537 328 648 312 C703 304 735 310 760 307" fill="none" stroke="#f8fcff" strokeOpacity=".56" strokeWidth="2" />
          <path d="M0 339 C122 326 217 346 332 334 C452 322 545 348 650 332 C700 325 739 331 760 328" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="2" />
        </svg>
      </div>

      <div className="focus-timer-ring relative z-10 aspect-square w-[min(74vw,340px)] max-w-full sm:w-[min(42vw,380px)] lg:w-[min(34vw,400px)]">
        <svg className="absolute inset-0 size-full -rotate-90 drop-shadow-[0_10px_16px_rgba(47,113,218,0.18)]" viewBox="0 0 320 320" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={`focus-ring-gradient-${rawId}`} x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#4eb8f5" />
              <stop offset="55%" stopColor="#347be8" />
              <stop offset="100%" stopColor="#574fe5" />
            </linearGradient>
          </defs>
          <circle cx="160" cy="160" r="139" fill="none" stroke="#d9e9fa" strokeWidth="12" />
          <circle cx="160" cy="160" r="128" fill="none" stroke="white" strokeOpacity="0.8" strokeWidth="2" />
          <circle
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
          <circle cx="299" cy="160" r="8" fill="#38a9f2" stroke="white" strokeWidth="5" />
        </svg>
        <div className="absolute inset-[9%] grid place-items-center rounded-full border border-white/90 bg-white/80 shadow-[inset_0_6px_22px_rgba(85,144,202,0.10),0_8px_28px_rgba(58,116,173,0.10)] backdrop-blur-md dark:border-white/10 dark:bg-slate-950/45">
          <div className="flex flex-col items-center justify-center px-3 text-center">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}