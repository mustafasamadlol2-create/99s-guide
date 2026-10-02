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
      className="focus-audio-card min-w-0 rounded-[22px] border border-sky-100/90 bg-gradient-to-br from-sky-50/90 via-white/95 to-blue-50/70 p-4 shadow-[0_10px_28px_rgba(54,112,170,0.08)] dark:border-sky-300/15 dark:from-sky-300/[0.08] dark:via-white/[0.025] dark:to-blue-300/[0.05]"
    >
      <div className="focus-audio-heading flex min-w-0 items-start gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#315f75] text-white shadow-sm dark:bg-sky-300 dark:text-slate-950">
          <Headphones className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-sm font-semibold text-slate-950 dark:text-white">
            {t("focusHubAudioTitle")}
          </h3>
          <p className="mt-0.5 text-xs leading-4 text-slate-600 dark:text-slate-400">
            {t("focusHubAudioSubtitle")}
          </p>
        </div>
      </div>

      <div className="focus-audio-source mt-3 flex min-h-11 items-center justify-between gap-2 rounded-xl border border-sky-100 bg-white/80 px-2.5 dark:border-white/10 dark:bg-black/10">
        {audio.userAudioArtworkUrl && (
          <img
            src={audio.userAudioArtworkUrl}
            alt=""
            draggable={false}
            className="size-12 shrink-0 rounded-lg border border-slate-200/70 object-cover shadow-sm dark:border-white/10"
          />
        )}
        <div className="min-w-0">
          <p className="focus-audio-source-name truncate text-sm font-medium text-slate-800 dark:text-slate-100" dir="auto">
            {audio.userAudioDisplayName ?? t("focusHubAudioNoSource")}
          </p>
          {hasSelection && (
            <p className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">
              {t("focusHubAudioLocalOnly")}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void chooseFile()}
          disabled={busy}
          className="flex min-h-10 shrink-0 items-center justify-center rounded-lg px-2.5 text-xs font-semibold text-sky-800 transition hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50 dark:text-sky-200 dark:hover:bg-white/10"
        >
          {t("focusHubAudioChooseFile")}
        </button>
      </div>

      {hasSelection && (
        <p className="focus-audio-session mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
          {t("focusHubAudioSessionOnly")}
        </p>
      )}

      <div className="focus-audio-preview mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void togglePreview()}
          disabled={!hasSelection || busy}
          aria-label={isPlaying ? t("focusHubAudioPause") : t("focusHubAudioPlay")}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#315f75] px-4 text-sm font-semibold text-white transition hover:bg-[#264f64] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-sky-300 dark:text-slate-950 dark:hover:bg-sky-200"
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Play className={`h-4 w-4 ${isRtl ? "rotate-180" : ""}`} aria-hidden="true" />
          )}
          {isPlaying ? t("focusHubAudioPause") : t("focusHubAudioPlay")}
        </button>
      </div>

      <div className="focus-audio-controls mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <label className="focus-audio-volume flex min-h-10 items-center gap-2.5 rounded-xl border border-sky-100/80 bg-white/55 px-2.5 dark:border-white/[0.07] dark:bg-white/[0.025]">
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
            className="h-2 min-w-0 flex-1 accent-sky-700"
          />
          <output className="min-w-10 text-end text-xs tabular-nums text-slate-500 dark:text-slate-400">
            <bdi dir="ltr">{Math.round(audio.volume * 100)}%</bdi>
          </output>
        </label>

        <label className="focus-audio-loop flex min-h-10 items-center gap-2 rounded-xl border border-sky-100/80 bg-white/55 px-2.5 text-xs font-medium text-slate-700 dark:border-white/[0.07] dark:bg-white/[0.025] dark:text-slate-200 sm:border-0 sm:bg-transparent sm:px-1">
          <input
            type="checkbox"
            checked={audio.loop}
            onChange={(event) => audioContext.setLoop(event.target.checked)}
            className="size-4 rounded border-slate-300 accent-sky-700"
          />
          <Repeat2 className="size-4 text-slate-500" aria-hidden="true" />
          {t("focusHubAudioLoop")}
        </label>
      </div>

      {(localError || audio.state === "ERROR") && (
        <p role="status" className="focus-audio-status mt-2 text-sm text-rose-700 dark:text-rose-300">
          {t("focusHubAudioError")}
        </p>
      )}
    </section>
  );
}