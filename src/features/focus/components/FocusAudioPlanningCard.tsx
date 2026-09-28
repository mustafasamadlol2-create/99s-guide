import { useState } from "react";
import { Headphones, Pause, Play, Repeat2, Volume2 } from "lucide-react";
import { useTranslation, type Language } from "../../../core/i18n/translations";
import { useFocusAudio } from "../../focus-audio/hooks";

interface FocusAudioPlanningCardProps {
  language: Language;
  idPrefix?: string;
}

export function FocusAudioPlanningCard({
  language,
  idPrefix = "focus-audio",
}: FocusAudioPlanningCardProps) {
  const isRtl = language === "ar";
  const { t } = useTranslation(language);
  const audioContext = useFocusAudio();
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState(false);
  const audio = audioContext.audio;
  const hasSelection = audio.sourceType !== "NONE";
  const isPlaying = audio.state === "PLAYING";
  const isPaused = audio.state === "PAUSED" || audio.state === "INTERRUPTED";
  const titleId = `${idPrefix}-title`;

  const chooseFile = async () => {
    setBusy(true);
    setLocalError(false);
    try {
      const result = await audioContext.pickUserAudio();
      if (!result.ok) setLocalError(true);
    } catch {
      setLocalError(true);
    } finally {
      setBusy(false);
    }
  };

  const togglePreview = async () => {
    if (isPlaying) {
      audioContext.pause();
      return;
    }
    setBusy(true);
    setLocalError(false);
    try {
      const result = isPaused
        ? await audioContext.resume()
        : await audioContext.play();
      if (!result.ok) setLocalError(true);
    } catch {
      setLocalError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      dir={isRtl ? "rtl" : "ltr"}
      aria-labelledby={titleId}
      className="rounded-[24px] border border-indigo-100 bg-gradient-to-br from-indigo-50/90 via-white to-violet-50/80 p-5 dark:border-indigo-300/10 dark:from-indigo-300/[0.08] dark:via-white/[0.025] dark:to-violet-300/[0.06]"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm shadow-indigo-900/15">
          <Headphones className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="font-semibold text-slate-950 dark:text-white">
            {t("focusHubAudioTitle")}
          </h3>
          <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-400">
            {t("focusHubAudioSubtitle")}
          </p>
        </div>
      </div>

      <div className="mt-4 flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/75 px-3 dark:border-white/10 dark:bg-black/10">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100" dir="auto">
            {audio.userAudioDisplayName ?? t("focusHubAudioNoSource")}
          </p>
          {hasSelection && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {t("focusHubAudioLocalOnly")}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void chooseFile()}
          disabled={busy}
          className="flex min-h-11 shrink-0 items-center justify-center rounded-xl px-3 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 dark:text-indigo-200 dark:hover:bg-white/10"
        >
          {t("focusHubAudioChooseFile")}
        </button>
      </div>

      {hasSelection && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {t("focusHubAudioSessionOnly")}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void togglePreview()}
          disabled={!hasSelection || busy}
          aria-label={isPlaying ? t("focusHubAudioPause") : t("focusHubAudioPlay")}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-white dark:text-slate-950 dark:hover:bg-indigo-50"
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Play className={`h-4 w-4 ${isRtl ? "rotate-180" : ""}`} aria-hidden="true" />
          )}
          {isPlaying ? t("focusHubAudioPause") : t("focusHubAudioPlay")}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <label className="flex min-h-11 items-center gap-3">
          <Volume2 className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
          <span className="sr-only">{t("focusHubAudioVolume")}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={audio.volume}
            onChange={(event) => audioContext.setVolume(Number(event.target.value))}
            aria-label={t("focusHubAudioVolume")}
            className="h-2 min-w-0 flex-1 accent-indigo-600"
          />
          <output className="min-w-10 text-end text-xs tabular-nums text-slate-500 dark:text-slate-400">
            <bdi dir="ltr">{Math.round(audio.volume * 100)}%</bdi>
          </output>
        </label>

        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={audio.loop}
            onChange={(event) => audioContext.setLoop(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
          />
          <Repeat2 className="h-4 w-4 text-slate-500" aria-hidden="true" />
          {t("focusHubAudioLoop")}
        </label>
      </div>

      {(localError || audio.state === "ERROR") && (
        <p role="status" className="mt-3 text-sm text-rose-700 dark:text-rose-300">
          {t("focusHubAudioError")}
        </p>
      )}
    </section>
  );
}