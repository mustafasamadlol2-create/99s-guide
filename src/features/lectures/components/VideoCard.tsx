import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, PlayCircle, X } from "lucide-react";
import { apiClient } from "../../../core/api/apiClient";
import {
  GAMIFICATION_INVALIDATED_EVENT,
  settleOptimisticStudyPoints,
  invalidateGamificationResources,
  type GamificationSyncResource,
} from "../../gamification/realtime";

let youtubeApiPromise: Promise<any> | null = null;

function ensureYouTubeIframeApi(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("YouTube API unavailable"));
  const win = window as any;
  if (win.YT?.Player) return Promise.resolve(win.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    }

    const startedAt = Date.now();
    const poll = window.setInterval(() => {
      if (win.YT?.Player) {
        window.clearInterval(poll);
        resolve(win.YT);
      } else if (Date.now() - startedAt > 10_000) {
        window.clearInterval(poll);
        youtubeApiPromise = null;
        reject(new Error("YouTube API load timed out"));
      }
    }, 100);
  });

  return youtubeApiPromise;
}

function mapPlayerState(value: number): "UNSTARTED" | "CUED" | "PLAYING" | "PAUSED" | "BUFFERING" | "ENDED" {
  switch (value) {
    case 0: return "ENDED";
    case 1: return "PLAYING";
    case 2: return "PAUSED";
    case 3: return "BUFFERING";
    case 5: return "CUED";
    default: return "UNSTARTED";
  }
}

function formatDuration(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export type VerifiedVideoCompletion = {
  materialId: string;
  lectureVideoCompleted: boolean;
  pointsAwarded: number;
};

export const VideoCard = ({
  video,
  videoId,
  onOpenExternal,
  onVerifiedComplete,
  initialCompleted = false,
  initialVerifiedSeconds = 0,
  initialDurationSeconds = 0,
  language = "en",
}: {
  video: any;
  videoId: string | undefined;
  onOpenExternal: (url: string) => void | Promise<void>;
  onVerifiedComplete?: (result: VerifiedVideoCompletion) => void;
  initialCompleted?: boolean;
  initialVerifiedSeconds?: number;
  initialDurationSeconds?: number;
  language?: "en" | "ar";
}) => {
  const isRtl = language === "ar";
  const [realDuration, setRealDuration] = useState<number | null>(
    initialDurationSeconds > 0 ? initialDurationSeconds : null,
  );
  const [shouldLoadDuration, setShouldLoadDuration] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [startingVerification, setStartingVerification] = useState(false);
  const [completed, setCompleted] = useState(initialCompleted);
  const [verifiedSeconds, setVerifiedSeconds] = useState(Math.max(0, initialVerifiedSeconds));
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const sessionIdRef = useRef<string | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatInFlightRef = useRef(false);
  const disposedRef = useRef(false);
  const completedRef = useRef(initialCompleted);
  const realDurationRef = useRef<number | null>(
    initialDurationSeconds > 0 ? initialDurationSeconds : null,
  );
  const onVerifiedCompleteRef = useRef(onVerifiedComplete);

  useEffect(() => {
    completedRef.current = completed;
  }, [completed]);

  useEffect(() => {
    realDurationRef.current = realDuration;
  }, [realDuration]);

  useEffect(() => {
    onVerifiedCompleteRef.current = onVerifiedComplete;
  }, [onVerifiedComplete]);

  useEffect(() => {
    completedRef.current = initialCompleted;
    setCompleted(initialCompleted);
    setVerifiedSeconds(Math.max(0, initialVerifiedSeconds));
    if (initialDurationSeconds > 0) {
      realDurationRef.current = initialDurationSeconds;
      setRealDuration(initialDurationSeconds);
    }
  }, [initialCompleted, initialDurationSeconds, initialVerifiedSeconds, video?.id]);

  const clearHeartbeatTimer = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (completed) clearHeartbeatTimer();
  }, [clearHeartbeatTimer, completed]);

  const emitPointsRefresh = useCallback((awarded: number) => {
    if (awarded > 0) {
      settleOptimisticStudyPoints(`video:${String(video?.id || "unknown")}`, awarded);
    }
    const resources: GamificationSyncResource[] = [
      "summary",
      "achievements",
      "challenges",
      "leaderboard",
      "rank",
    ];
    invalidateGamificationResources(resources);
    window.dispatchEvent(new CustomEvent(GAMIFICATION_INVALIDATED_EVENT, {
      detail: { resources },
    }));
  }, [video?.id]);

  const startVerification = useCallback(async (durationSeconds: number) => {
    if (!videoId || !video?.id || completedRef.current) return;
    if (!Number.isFinite(durationSeconds) || durationSeconds < 60) {
      setVerificationError(
        isRtl
          ? "هذا الفيديو قصير جداً أو تعذر التحقق من مدته، لذلك لن تُحتسب نقاط تنافسية."
          : "This video is too short or its duration could not be verified, so competitive points are unavailable.",
      );
      return;
    }
    setStartingVerification(true);
    setVerificationError(null);
    try {
      const response = await apiClient("/api/videos/watch/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialId: video.id, durationSeconds: Math.round(durationSeconds) }),
        silent: true,
      });
      if (!response.ok) throw new Error("Verification could not start.");
      const data = await response.json();
      if (disposedRef.current) return;
      sessionIdRef.current = typeof data?.sessionId === "string" ? data.sessionId : null;
      const serverCompleted = data?.completed === true;
      completedRef.current = serverCompleted;
      setCompleted(serverCompleted);
      setVerifiedSeconds(Number(data?.verifiedSeconds) || 0);
      if (Number(data?.durationSeconds) > 0) {
        realDurationRef.current = Number(data.durationSeconds);
        setRealDuration(Number(data.durationSeconds));
      }
    } catch {
      if (!disposedRef.current) {
        setVerificationError(
          isRtl
            ? "تعذر بدء التحقق من المشاهدة. يمكنك مشاهدة الفيديو، لكن لن تُحتسب نقاط حتى يعود الاتصال."
            : "Verified watch tracking could not start. You can still watch, but points will not count until tracking is available.",
        );
      }
    } finally {
      if (!disposedRef.current) setStartingVerification(false);
    }
  }, [isRtl, video?.id, videoId]);

  const sendHeartbeat = useCallback(async (stateOverride?: ReturnType<typeof mapPlayerState>) => {
    const player = playerRef.current;
    const sessionId = sessionIdRef.current;
    if (!player || !sessionId || completedRef.current || heartbeatInFlightRef.current) return;
    const duration = Number(player.getDuration?.() || realDurationRef.current || 0);
    const position = Number(player.getCurrentTime?.() || 0);
    const playbackRate = Number(player.getPlaybackRate?.() || 1);
    const rawState = Number(player.getPlayerState?.() ?? -1);
    const playerState = stateOverride ?? mapPlayerState(rawState);
    if (!Number.isFinite(duration) || duration < 60 || !Number.isFinite(position)) return;

    heartbeatInFlightRef.current = true;
    try {
      const response = await apiClient("/api/videos/watch/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialId: video.id,
          sessionId,
          positionSeconds: position,
          durationSeconds: Math.round(duration),
          playerState,
          playbackRate,
        }),
        silent: true,
      });
      if (response.status === 409) {
        sessionIdRef.current = null;
        await startVerification(duration);
        return;
      }
      if (!response.ok) return;
      const data = await response.json();
      if (disposedRef.current) return;
      setVerifiedSeconds(Number(data?.verifiedSeconds) || 0);
      if (Number(data?.durationSeconds) > 0) {
        realDurationRef.current = Number(data.durationSeconds);
        setRealDuration(Number(data.durationSeconds));
      }
      if (data?.completed === true) {
        completedRef.current = true;
        setCompleted(true);
        clearHeartbeatTimer();
        const awarded = Number(data?.points?.awarded) || 0;
        emitPointsRefresh(awarded);
        onVerifiedCompleteRef.current?.({
          materialId: String(video.id),
          lectureVideoCompleted: data?.lectureVideoCompleted === true,
          pointsAwarded: awarded,
        });
      }
    } finally {
      heartbeatInFlightRef.current = false;
    }
  }, [clearHeartbeatTimer, emitPointsRefresh, startVerification, video?.id]);

  const beginHeartbeatTimer = useCallback(() => {
    clearHeartbeatTimer();
    heartbeatTimerRef.current = setInterval(() => {
      void sendHeartbeat("PLAYING");
    }, 5_000);
  }, [clearHeartbeatTimer, sendHeartbeat]);

  // Preserve the quick duration label without creating hidden players until the
  // card is close to the viewport.
  useEffect(() => {
    if (!videoId || realDuration !== null) return;
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setShouldLoadDuration(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoadDuration(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [realDuration, videoId]);

  useEffect(() => {
    if (!videoId || !shouldLoadDuration || expanded || realDuration !== null) return;
    let disposed = false;
    let hiddenPlayer: any = null;
    const div = document.createElement("div");
    div.style.display = "none";
    document.body.appendChild(div);
    void ensureYouTubeIframeApi().then((YT) => {
      if (disposed) return;
      hiddenPlayer = new YT.Player(div, {
        height: "0",
        width: "0",
        videoId,
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, rel: 0 },
        events: {
          onReady: (event: any) => {
            const duration = Number(event.target.getDuration?.() || 0);
            if (!disposed && duration > 0) {
              realDurationRef.current = duration;
              setRealDuration(duration);
            }
            window.setTimeout(() => {
              try { event.target.destroy(); } catch (_) {}
              if (div.isConnected) div.remove();
            }, 500);
          },
          onError: () => { if (div.isConnected) div.remove(); },
        },
      });
    }).catch(() => { if (div.isConnected) div.remove(); });
    return () => {
      disposed = true;
      try { hiddenPlayer?.destroy?.(); } catch (_) {}
      if (div.isConnected) div.remove();
    };
  }, [expanded, realDuration, shouldLoadDuration, videoId]);

  useEffect(() => {
    if (!expanded || !videoId || !playerHostRef.current) return;
    disposedRef.current = false;
    let cancelled = false;
    void ensureYouTubeIframeApi().then((YT) => {
      if (cancelled || !playerHostRef.current) return;
      playerRef.current = new YT.Player(playerHostRef.current, {
        width: "100%",
        height: "100%",
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 1,
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: async (event: any) => {
            if (cancelled) return;
            setPlayerReady(true);
            const duration = Number(event.target.getDuration?.() || 0);
            if (duration > 0) {
              realDurationRef.current = duration;
              setRealDuration(duration);
              await startVerification(duration);
              if (Number(event.target.getPlayerState?.()) === 1) {
                await sendHeartbeat("PLAYING");
                beginHeartbeatTimer();
              }
            }
          },
          onStateChange: (event: any) => {
            const state = mapPlayerState(Number(event.data));
            if (state === "PLAYING") {
              void sendHeartbeat("PLAYING");
              beginHeartbeatTimer();
            } else {
              void sendHeartbeat(state);
              clearHeartbeatTimer();
            }
          },
          onError: () => {
            setVerificationError(
              isRtl
                ? "تعذر تشغيل الفيديو داخل التطبيق. استخدم فتح يوتيوب؛ المشاهدة الخارجية لا تمنح نقاطاً."
                : "The video could not play in-app. You can open YouTube instead; external playback does not earn points.",
            );
          },
        },
      });
    }).catch(() => {
      setVerificationError(
        isRtl
          ? "تعذر تحميل مشغل يوتيوب داخل التطبيق."
          : "The in-app YouTube player could not be loaded.",
      );
    });
    return () => {
      cancelled = true;
      disposedRef.current = true;
      clearHeartbeatTimer();
      try { playerRef.current?.pauseVideo?.(); } catch (_) {}
      try { playerRef.current?.destroy?.(); } catch (_) {}
      playerRef.current = null;
      sessionIdRef.current = null;
      setPlayerReady(false);
    };
  }, [beginHeartbeatTimer, clearHeartbeatTimer, expanded, isRtl, sendHeartbeat, startVerification, videoId]);

  const watchedPercent = useMemo(() => {
    const duration = realDuration ?? initialDurationSeconds;
    if (!duration || duration <= 0) return 0;
    return Math.min(100, Math.round((verifiedSeconds / duration) * 100));
  }, [initialDurationSeconds, realDuration, verifiedSeconds]);

  const openExternal = () => {
    const url = typeof video?.youtubeUrl === "string" ? video.youtubeUrl.trim() : "";
    if (!url) return;
    void Promise.resolve(onOpenExternal(url)).catch(() => {});
  };

  const collapse = () => {
    try { playerRef.current?.pauseVideo?.(); } catch (_) {}
    void sendHeartbeat("PAUSED");
    setExpanded(false);
  };

  return (
    <div
      ref={cardRef}
      className="w-full overflow-hidden rounded-2xl border border-neutral-200/80 bg-semantic-surface-elevated shadow-sm dark:border-white/[0.10]"
      dir={isRtl ? "rtl" : "ltr"}
    >
      {!expanded ? (
        <div className="flex w-full flex-row items-center gap-4 p-4 sm:gap-5 sm:p-5">
          <button
            type="button"
            onClick={() => videoId ? setExpanded(true) : openExternal()}
            className="group video-thumb relative w-40 sm:w-48 lg:w-56 shrink-0 aspect-video bg-neutral-100 dark:bg-[#2C2C2E] rounded-xl overflow-hidden border border-black/[0.04] dark:border-white/[0.06]"
            aria-label={`${isRtl ? "مشاهدة" : "Watch"} ${video?.title || "YouTube video"}`}
          >
            {videoId ? (
              <img
                loading="lazy"
                decoding="async"
                src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
                alt={video?.title || "YouTube video"}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="w-full h-full flex items-center justify-center">
                <PlayCircle className="w-8 h-8 text-semantic-chrome-content-subtle" />
              </span>
            )}
            <span className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition pointer-events-none" />
            <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-red-600 text-white shadow-lg">
                <PlayCircle className="h-6 w-6" />
              </span>
            </span>
            {realDuration !== null && (
              <span className="absolute bottom-1 right-1 bg-black/80 backdrop-blur-sm text-white text-[10px] font-mono px-1.5 py-0.5 rounded-md font-medium pointer-events-none">
                {formatDuration(realDuration)}
              </span>
            )}
          </button>

          <div className="min-w-0 flex-1 py-1 text-start">
            <div className="flex items-start justify-between gap-3">
              <span className="block max-w-full whitespace-normal break-words text-base font-semibold leading-snug text-semantic-chrome-content-primary sm:text-lg [overflow-wrap:anywhere]">
                {video?.title}
              </span>
              {completed && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {isRtl ? "مكتمل" : "Completed"}
                </span>
              )}
            </div>
            {video?.description && (
              <span className="mt-1 block text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
                {video.description}
              </span>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => videoId ? setExpanded(true) : openExternal()}
                className="inline-flex items-center justify-center rounded-full bg-red-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-red-700 active:bg-red-800"
              >
                <PlayCircle className={`h-4 w-4 ${isRtl ? "ml-2" : "mr-2"}`} />
                {completed
                  ? (isRtl ? "مشاهدة مرة أخرى" : "Watch Again")
                  : (isRtl ? "مشاهدة داخل التطبيق" : "Watch In App")}
              </button>
              <button
                type="button"
                onClick={openExternal}
                className="inline-flex items-center justify-center rounded-full border border-neutral-200 px-4 py-2 text-xs font-semibold text-neutral-600 transition hover:bg-neutral-50 dark:border-white/[0.12] dark:text-neutral-300 dark:hover:bg-white/[0.06]"
              >
                <ExternalLink className={`h-3.5 w-3.5 ${isRtl ? "ml-1.5" : "mr-1.5"}`} />
                {isRtl ? "فتح في يوتيوب" : "Open YouTube"}
              </button>
            </div>
            {!completed && videoId && (
              <p className="mt-2 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                {isRtl
                  ? "تُمنح +3 نقاط بعد مشاهدة موثقة لـ 80% داخل التطبيق. فتح يوتيوب خارجياً لا يمنح نقاطاً."
                  : "+3 points after 80% verified in-app playback. External YouTube playback does not earn points."}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-semantic-chrome-content-primary sm:text-lg">
                {video?.title}
              </div>
              <div className="mt-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {completed
                  ? (isRtl ? "اكتملت المشاهدة الموثقة" : "Verified watch completed")
                  : (isRtl ? `مشاهدة موثقة: ${watchedPercent}% من الفيديو` : `Verified watch: ${watchedPercent}% of video`)}
              </div>
            </div>
            <button
              type="button"
              onClick={collapse}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-200 text-neutral-500 hover:bg-neutral-50 dark:border-white/[0.12] dark:hover:bg-white/[0.06]"
              aria-label={isRtl ? "إغلاق الفيديو" : "Close video"}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
            <div ref={playerHostRef} className="h-full w-full" />
            {(!playerReady || startingVerification) && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 text-white">
                <Loader2 className="h-7 w-7 animate-spin" />
              </div>
            )}
          </div>

          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-white/[0.08]">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                style={{ width: `${completed ? 100 : Math.min(100, watchedPercent / 0.8)}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
              <span>
                {completed
                  ? (isRtl ? "✓ تم التحقق — الفيديو مكتمل" : "✓ Verified — video complete")
                  : (isRtl ? "يكتمل عند 80% مشاهدة موثقة" : "Completes at 80% verified watch")}
              </span>
              <button
                type="button"
                onClick={openExternal}
                className="inline-flex items-center gap-1 font-semibold text-red-600 hover:underline dark:text-red-400"
              >
                <ExternalLink className="h-3 w-3" />
                {isRtl ? "يوتيوب خارجي (بدون نقاط)" : "External YouTube (no points)"}
              </button>
            </div>
            {verificationError && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                {verificationError}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
