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
      className="group flex w-full flex-row items-center gap-4 rounded-2xl border border-neutral-200/80 bg-white p-3 text-left shadow-sm transition-[transform,box-shadow,border-color] duration-200 hover:shadow-md dark:border-white/[0.08] dark:bg-[#17181B] dark:shadow-[0_8px_24px_rgba(0,0,0,0.22)]"
      aria-label={`Watch ${video?.title || "YouTube video"}`}
    >
      <span className="video-thumb relative w-32 shrink-0 aspect-video overflow-hidden rounded-xl border border-black/[0.04] bg-neutral-100 dark:border-white/[0.06] dark:bg-[#232428]">
        {videoId ? (
          <img
            loading="lazy"
            decoding="async"
            src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
            alt={video?.title || "YouTube video"}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <PlayCircle className="h-8 w-8 text-neutral-400" />
          </span>
        )}

        <span className="pointer-events-none absolute inset-0 bg-black/10 transition group-hover:bg-black/0" />

        {realDuration !== null && (
          <span className="pointer-events-none absolute bottom-1 right-1 rounded-md bg-black/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white backdrop-blur-sm">
            {formatDuration(realDuration)}
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1 py-1 text-left">
        <span className="block max-w-full whitespace-normal break-words text-sm font-semibold leading-snug text-neutral-900 transition-colors [overflow-wrap:anywhere] dark:text-white">
          {video?.title}
        </span>

        {video?.description && (
          <span className="mt-0.5 mb-2 block text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
            {video.description}
          </span>
        )}

        <span className="pointer-events-none inline-flex items-center justify-center rounded-full bg-red-600 px-4 py-1.5 text-xs font-semibold text-white transition group-hover:bg-red-700 group-active:bg-red-800">
          <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
          Watch
        </span>
      </span>
    </button>
  );
};
