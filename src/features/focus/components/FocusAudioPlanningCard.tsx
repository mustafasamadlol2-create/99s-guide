import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { Headphones, Music2, Pause, Play, Repeat2, Volume2 } from "lucide-react";
import { useTranslation, type Language } from "../../../core/i18n/translations";
import { AUDIO_FILE_PICKER_ACCEPT } from "../../focus-audio/constants";
import { useFocusAudio } from "../../focus-audio/hooks";
import { resolveFocusAudioArtworkUrl } from "./focusAudioArtwork";
import { listFocusSharedSounds } from "../../focus-audio/sharedSoundsApi";
import type { FocusSharedSound } from "../../focus-audio/types";

interface FocusAudioPlanningCardProps {
  language: Language;
  idPrefix?: string;
  plannerPresentation?: boolean;
}

export function FocusAudioPlanningCard({
  language,
  idPrefix = "focus-audio",
  plannerPresentation = false,
}: FocusAudioPlanningCardProps) {
  const isRtl = language === "ar";
  const { t } = useTranslation(language);
  const audioContext = useFocusAudio();
  const audioFileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [selectingFile, setSelectingFile] = useState(false);
  const [localError, setLocalError] = useState(false);
  const [failedArtworkUrl, setFailedArtworkUrl] = useState<string | null>(null);
  const [sharedSounds, setSharedSounds] = useState<FocusSharedSound[]>([]);
  const [sharedSoundBusyId, setSharedSoundBusyId] = useState<string | null>(null);
  const audio = audioContext.audio;
  const hasSelection = audio.sourceType !== "NONE";
  const isPlaying = audio.state === "PLAYING";
  const isPaused = audio.state === "PAUSED" || audio.state === "INTERRUPTED";
  const titleId = `${idPrefix}-title`;
  const artworkUrl = resolveFocusAudioArtworkUrl(
    audio.userAudioArtworkUrl,
    failedArtworkUrl,
  );
  const sourceDisplayName = audio.sourceDisplayName ?? audio.userAudioDisplayName;

  useEffect(() => {
    let active = true;
    void listFocusSharedSounds().then((sounds) => {
      if (active) setSharedSounds(sounds);
    }).catch(() => {
      if (active) setSharedSounds([]);
    });
    return () => { active = false; };
  }, []);

  const chooseSharedSound = async (sound: FocusSharedSound) => {
    const wasPlaying = audio.state === "PLAYING";
    setSharedSoundBusyId(sound.id);
    setLocalError(false);
    try {
      const result = await audioContext.selectSharedAudio(sound);
      if (!result.ok) {
        setLocalError(true);
        return;
      }
      // A user-initiated shared-sound switch during an active Focus session
      // continues playback seamlessly; initial selection still waits for Preview.
      if (wasPlaying) {
        const playResult = await audioContext.play();
        if (!playResult.ok) setLocalError(true);
      }
    } catch {
      setLocalError(true);
    } finally {
      setSharedSoundBusyId(null);
    }
  };

  const chooseFile = async (file: File) => {
    setBusy(true);
    setSelectingFile(true);
    setLocalError(false);
    try {
      const result = await audioContext.selectUserAudio(file);
      if (!result.ok) setLocalError(true);
    } catch {
      setLocalError(true);
    } finally {
      setBusy(false);
      setSelectingFile(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (file) void chooseFile(file);
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
      aria-busy={selectingFile}
      className={`focus-audio-card min-w-0 rounded-[22px] border border-sky-100/90 bg-gradient-to-br from-sky-50/90 via-white/95 to-blue-50/70 p-4 shadow-[0_10px_28px_rgba(54,112,170,0.08)] dark:border-sky-300/15 dark:from-sky-300/[0.08] dark:via-white/[0.025] dark:to-blue-300/[0.05] ${
        plannerPresentation ? "focus-audio-card-planner" : ""
      }`}
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

      {sharedSounds.length > 0 && (
        <div className="focus-audio-shared-library mt-3 min-w-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
              {isRtl ? "أصوات التركيز" : "Focus sounds"}
            </p>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">
              {isRtl ? "مشتركة" : "Shared"}
            </span>
          </div>
          <div className="focus-audio-shared-list flex gap-2 overflow-x-auto pb-1">
            {sharedSounds.map((sound) => {
              const selected = audio.sourceType === "AMBIENT" && audio.ambientTrackId === sound.id;
              return (
                <button
                  key={sound.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={busy || sharedSoundBusyId !== null}
                  onClick={() => void chooseSharedSound(sound)}
                  className={`focus-audio-shared-chip inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition active:scale-[0.97] disabled:opacity-50 ${
                    selected
                      ? "border-blue-400 bg-blue-500 text-white shadow-[0_5px_14px_rgba(59,130,246,0.22)]"
                      : "border-sky-100 bg-white/70 text-slate-700 hover:bg-sky-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]"
                  }`}
                >
                  <Music2 className="size-3.5" aria-hidden="true" />
                  <span className="max-w-36 truncate" dir="auto">{sound.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div
        className={`focus-audio-source min-w-0 ${
          plannerPresentation ? "" : "flex items-start gap-3"
        }`}
      >
        <img
          src={artworkUrl}
          alt=""
          draggable={false}
          onError={() => {
            if (audio.userAudioArtworkUrl) {
              setFailedArtworkUrl(audio.userAudioArtworkUrl);
            }
          }}
          className={`focus-audio-artwork ${
            plannerPresentation
              ? ""
              : "h-28 w-28 shrink-0 rounded-2xl border border-slate-200/80 object-cover shadow-sm dark:border-white/10"
          } ${
            !audio.userAudioArtworkUrl || failedArtworkUrl === audio.userAudioArtworkUrl
              ? "focus-audio-artwork-fallback"
              : ""
          }`}
        />
        <div
          className={`focus-audio-source-details min-w-0 ${
            plannerPresentation
              ? ""
              : "flex flex-1 flex-col justify-center gap-2 rounded-xl border border-slate-200/80 bg-white/55 p-3 dark:border-white/10 dark:bg-white/[0.025]"
          }`}
        >
          <p
            className="focus-audio-source-name truncate text-sm font-medium text-slate-800 dark:text-slate-100"
            dir="auto"
            aria-live="polite"
          >
            {sourceDisplayName ?? t("focusHubAudioNoSource")}
          </p>
          {hasSelection && (
            <p className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">
              {t("focusHubAudioLocalOnly")}
            </p>
          )}
          <input
            ref={audioFileInputRef}
            type="file"
            accept={AUDIO_FILE_PICKER_ACCEPT}
            tabIndex={-1}
            aria-hidden="true"
            className="sr-only"
            onChange={handleFileChange}
          />
          <button
            type="button"
            onClick={() => audioFileInputRef.current?.click()}
            disabled={busy}
            className="focus-audio-choose-button flex min-h-10 shrink-0 items-center justify-center rounded-lg px-2.5 text-xs font-semibold text-sky-800 transition hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50 dark:text-sky-200 dark:hover:bg-white/10"
          >
            {plannerPresentation && <Music2 className="focus-audio-picker-icon size-4" aria-hidden="true" />}
            {selectingFile
              ? t("focusHubAudioLoading")
              : t(plannerPresentation ? "focusHubAudioChooseAudio" : "focusHubAudioChooseFile")}
          </button>
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
              className={`min-w-0 flex-1 ${
                plannerPresentation ? "focus-audio-volume-slider h-7" : "h-2 accent-sky-700"
              }`}
              style={{ "--focus-audio-volume": `${audio.volume * 100}%` } as CSSProperties}
            />
            <output className="min-w-9 text-end text-xs tabular-nums text-slate-500 dark:text-slate-400">
              <bdi dir="ltr">{Math.round(audio.volume * 100)}%</bdi>
            </output>
          </label>
          <label className="focus-audio-loop flex min-h-10 items-center gap-2 rounded-xl border border-sky-100/80 bg-white/55 px-2.5 text-xs font-medium text-slate-700 dark:border-white/[0.07] dark:bg-white/[0.025] dark:text-slate-200 sm:border-0 sm:bg-transparent sm:px-1">
            <input
              type="checkbox"
              role={plannerPresentation ? "switch" : undefined}
              aria-checked={plannerPresentation ? audio.loop : undefined}
              checked={audio.loop}
              onChange={(event) => audioContext.setLoop(event.target.checked)}
              className="focus-audio-loop-toggle size-4 rounded border-slate-300 accent-sky-700"
            />
            <span className="focus-audio-loop-label">
              <Repeat2 className="focus-audio-loop-icon size-4 text-slate-500" aria-hidden="true" />
              <span>{t("focusHubAudioLoop")}</span>
            </span>
          </label>
        </div>
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

      {(localError || audio.state === "ERROR") && (
        <p role="status" className="focus-audio-status mt-2 text-sm text-rose-700 dark:text-rose-300">
          {t("focusHubAudioError")}
        </p>
      )}
    </section>
  );
}