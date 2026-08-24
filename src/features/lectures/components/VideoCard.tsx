import React, { useEffect, useRef, useState } from "react";
import { PlayCircle } from "lucide-react";

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

export const VideoCard = ({
  video,
  videoId,
  onWatch,
}: {
  video: any;
  videoId: string | undefined;
  onWatch: (url: string) => void | Promise<void>;
}) => {
  const [realDuration, setRealDuration] = useState<number | null>(null);
  const [shouldLoadDuration, setShouldLoadDuration] = useState(false);
  const cardRef = useRef<HTMLButtonElement | null>(null);

  // Avoid creating hidden YouTube players for cards that the user has not even
  // scrolled near. This preserves the duration UI while eliminating off-screen work.
  useEffect(() => {
    if (!videoId) return;
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
  }, [videoId]);

  useEffect(() => {
    if (!videoId || !shouldLoadDuration) return;

    let disposed = false;
    let player: any = null;
    let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const div = document.createElement("div");
    div.id = `yt-player-${videoId}-${Math.random().toString(36).substring(2, 11)}`;
    div.style.display = "none";
    document.body.appendChild(div);

    void ensureYouTubeIframeApi()
      .then((YT) => {
        if (disposed) return;
        player = new YT.Player(div.id, {
          height: "0",
          width: "0",
          videoId,
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            rel: 0,
          },
          events: {
            onReady: (event: any) => {
              if (disposed) return;
              const time = event.target.getDuration();
              if (time > 0) {
                setRealDuration(time);
              } else {
                retryTimer = setTimeout(() => {
                  if (disposed) return;
                  const retryDuration = event.target.getDuration();
                  if (retryDuration > 0) setRealDuration(retryDuration);
                }, 1000);
              }

              cleanupTimer = setTimeout(() => {
                try { event.target.destroy(); } catch (_) {}
                if (div.isConnected) div.remove();
              }, 2000);
            },
            onError: () => {
              if (div.isConnected) div.remove();
            },
          },
        });
      })
      .catch(() => {
        if (div.isConnected) div.remove();
      });

    return () => {
      disposed = true;
      if (cleanupTimer) clearTimeout(cleanupTimer);
      if (retryTimer) clearTimeout(retryTimer);
      try { player?.destroy?.(); } catch (_) {}
      if (div.isConnected) div.remove();
    };
  }, [videoId, shouldLoadDuration]);

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }

    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleVideoPress = () => {
    const url = typeof video?.youtubeUrl === "string" ? video.youtubeUrl.trim() : "";
    if (!url) return;
    void Promise.resolve(onWatch(url)).catch(() => {});
  };

  return (
    <button
      ref={cardRef}
      type="button"
      onClick={handleVideoPress}
      className="group flex w-full flex-row items-center bg-white dark:bg-[#1C1C1E] border border-neutral-200/80 dark:border-white/[0.10] rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200 p-3 gap-4 cursor-pointer text-left appearance-none"
      aria-label={`Watch ${video?.title || "YouTube video"}`}
    >
      <span className="video-thumb relative w-32 shrink-0 aspect-video bg-neutral-100 dark:bg-[#2C2C2E] rounded-lg overflow-hidden border border-black/[0.04] dark:border-white/[0.06]">
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
            <PlayCircle className="w-8 h-8 text-neutral-400" />
          </span>
        )}

        <span className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition pointer-events-none" />

        {realDuration !== null && (
          <span className="absolute bottom-1 right-1 bg-black/80 backdrop-blur-sm text-white text-[10px] font-mono px-1.5 py-0.5 rounded-md font-medium pointer-events-none">
            {formatDuration(realDuration)}
          </span>
        )}
      </span>

      <span className="flex-1 min-w-0 py-1 text-left">
        <span className="block text-sm font-semibold text-neutral-900 dark:text-white transition-colors leading-snug whitespace-normal break-words [overflow-wrap:anywhere] max-w-full">
          {video?.title}
        </span>

        {video?.description && (
          <span className="block text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 mb-2 leading-relaxed">
            {video.description}
          </span>
        )}

        <span className="inline-flex items-center justify-center px-4 py-1.5 bg-red-600 group-hover:bg-red-700 group-active:bg-red-800 text-white text-xs font-semibold rounded-full transition pointer-events-none">
          <PlayCircle className="w-3.5 h-3.5 mr-1.5" />
          Watch
        </span>
      </span>
    </button>
  );
};
