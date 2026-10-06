import "./_group.css";
import { Pause } from "lucide-react";
import { FocusTimerScene } from "./src/features/focus/components/FocusVisuals";

function TimerMode({ dark, arabic }: { dark: boolean; arabic: boolean }) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 ${dark ? "dark" : ""}`}>
      <div className="flex items-center justify-between px-1">
        <h2 className={`text-sm font-semibold ${dark ? "text-slate-200" : "text-slate-700"}`}>
          {arabic
            ? dark ? "المظهر الداكن" : "المظهر الفاتح"
            : dark ? "Dark appearance" : "Light appearance"}
        </h2>
        <span className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>
          {arabic ? "جلسة نشطة" : "Active session"}
        </span>
      </div>
      <FocusTimerScene
        variant="active"
        progress={0.82}
        controls={
          <div className="focus-active-primary-controls">
            <button type="button" className="focus-timer-primary-action">
              <Pause aria-hidden="true" />
              {arabic ? "إيقاف مؤقت" : "Pause"}
            </button>
          </div>
        }
      >
        <time className="focus-timer-value" dir="ltr" aria-label="Focus session: 24 minutes 36 seconds">
          24:36
        </time>
        <span className="focus-timer-caption">{arabic ? "جلسة التركيز" : "Focus session"}</span>
      </FocusTimerScene>
    </section>
  );
}

export function ActiveTimerPreview() {
  const arabic = new URLSearchParams(window.location.search).get("lang") === "ar";
  return (
    <main
      dir={arabic ? "rtl" : "ltr"}
      className="grid min-h-[100dvh] grid-cols-1 content-center gap-5 bg-[#edf3fa] p-5 md:grid-cols-2 md:p-7"
    >
      <TimerMode arabic={arabic} dark={false} />
      <div className="rounded-[34px] bg-[#0c1423] p-2 shadow-[0_20px_55px_rgba(15,23,42,0.18)]">
        <TimerMode arabic={arabic} dark />
      </div>
    </main>
  );
}
