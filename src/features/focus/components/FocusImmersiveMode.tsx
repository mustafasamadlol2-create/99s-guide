import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import { NativeBridge } from "../../../core/device/capacitor/nativeBridge";
import "./focus-immersive.css";

export interface FocusImmersiveModeProps {
  direction: "ltr" | "rtl";
  clockText: string;
  progress: number;
  statusLabel: string;
  timerLabel: string;
  lectureTitle?: string | null;
  roundText?: string | null;
  paused: boolean;
  busy: boolean;
  canMutate: boolean;
  audioAvailable: boolean;
  audioPlaying: boolean;
  pauseLabel: string;
  resumeLabel: string;
  endLabel: string;
  soundLabel: string;
  exitLabel: string;
  controlsHint: string;
  onPauseResume: () => void;
  onEnd: () => void;
  onToggleAudio: () => void;
  onExit: () => void;
}

const CONTROL_HIDE_DELAY_MS = 3_600;

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * In-app fullscreen Focus surface.
 *
 * This intentionally does not depend on the browser Fullscreen API: iOS Safari
 * and WKWebView do not provide a consistent programmatic fullscreen contract.
 * A body-level fixed portal gives the same immersive viewport in PWA, browser,
 * iPhone and iPad, while native Capacitor additionally hides the status bar.
 */
export function FocusImmersiveMode({
  direction,
  clockText,
  progress,
  statusLabel,
  timerLabel,
  lectureTitle,
  roundText,
  paused,
  busy,
  canMutate,
  audioAvailable,
  audioPlaying,
  pauseLabel,
  resumeLabel,
  endLabel,
  soundLabel,
  exitLabel,
  controlsHint,
  onPauseResume,
  onEnd,
  onToggleAudio,
  onExit,
}: FocusImmersiveModeProps) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<number | null>(null);
  const normalizedProgress = clampProgress(progress);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current === null) return;
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    if (paused || busy) {
      setControlsVisible(true);
      return;
    }
    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
      hideTimerRef.current = null;
    }, CONTROL_HIDE_DELAY_MS);
  }, [busy, clearHideTimer, paused]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    scheduleHide();
    return clearHideTimer;
  }, [clearHideTimer, scheduleHide]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";

    const restoreStatusBar = () => {
      void NativeBridge.showStatusBar();
      const isDark = document.documentElement.classList.contains("dark");
      void NativeBridge.setStatusBarStyle(isDark ? "dark" : "light");
    };

    void NativeBridge.hideStatusBar();
    const unsubscribeLifecycle = NativeBridge.addAppLifecycleListener((active) => {
      if (active) void NativeBridge.hideStatusBar();
    });

    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
      unsubscribeLifecycle();
      restoreStatusBar();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onExit();
        return;
      }
      if (event.key === " " || event.key === "Enter") {
        revealControls();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onExit, revealControls]);

  if (typeof document === "undefined") return null;

  const ringStyle = {
    "--focus-immersive-progress": `${normalizedProgress * 360}deg`,
  } as React.CSSProperties;

  return createPortal(
    <section
      dir={direction}
      className={`focus-immersive-layer ${controlsVisible || paused || busy ? "is-controls-visible" : "is-controls-hidden"}`}
      role="dialog"
      aria-modal="true"
      aria-label={timerLabel}
      onPointerMove={revealControls}
      onPointerDown={revealControls}
    >
      <div className="focus-immersive-atmosphere" aria-hidden="true">
        <span className="focus-immersive-glow focus-immersive-glow--one" />
        <span className="focus-immersive-glow focus-immersive-glow--two" />
        <span className="focus-immersive-grid" />
      </div>

      <header className="focus-immersive-topbar">
        <div className="focus-immersive-context">
          <span className={`focus-immersive-status-dot ${paused ? "is-paused" : "is-active"}`} aria-hidden="true" />
          <span className="focus-immersive-status">{statusLabel}</span>
          {roundText ? <span className="focus-immersive-round" dir="auto">{roundText}</span> : null}
        </div>
        {lectureTitle ? (
          <p className="focus-immersive-lecture" dir="auto">{lectureTitle}</p>
        ) : null}
      </header>

      <button
        type="button"
        className="focus-immersive-stage"
        onClick={revealControls}
        aria-label={controlsHint}
      >
        <div className="focus-immersive-ring" style={ringStyle} aria-hidden="true">
          <div className="focus-immersive-ring-inner" />
        </div>
        <div className="focus-immersive-clock-wrap">
          <time className="focus-immersive-clock" dir="ltr" aria-label={`${timerLabel}: ${clockText}`} aria-live="off">
            {clockText}
          </time>
          <span className="focus-immersive-caption">{paused ? statusLabel : timerLabel}</span>
        </div>
      </button>

      <div className="focus-immersive-hint" aria-hidden={controlsVisible || paused || busy}>
        {controlsHint}
      </div>

      <nav
        className="focus-immersive-dock"
        aria-label={timerLabel}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="focus-immersive-control focus-immersive-control--primary"
          disabled={!canMutate || busy}
          onClick={onPauseResume}
          aria-label={paused ? resumeLabel : pauseLabel}
        >
          {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
          <span>{paused ? resumeLabel : pauseLabel}</span>
        </button>

        <button
          type="button"
          className="focus-immersive-control"
          disabled={!audioAvailable || busy}
          onClick={onToggleAudio}
          aria-pressed={audioPlaying}
          aria-label={soundLabel}
        >
          {audioPlaying ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
          <span>{soundLabel}</span>
        </button>

        <button
          type="button"
          className="focus-immersive-control focus-immersive-control--danger"
          disabled={!canMutate || busy}
          onClick={onEnd}
          aria-label={endLabel}
        >
          <Square aria-hidden="true" />
          <span>{endLabel}</span>
        </button>

        <button
          type="button"
          className="focus-immersive-control"
          onClick={onExit}
          aria-label={exitLabel}
        >
          <Minimize2 aria-hidden="true" />
          <span>{exitLabel}</span>
        </button>
      </nav>

      <span className="focus-immersive-fullscreen-mark" aria-hidden="true">
        <Maximize2 />
      </span>
    </section>,
    document.body,
  );
}
