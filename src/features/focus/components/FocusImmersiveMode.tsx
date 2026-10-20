import React, { useEffect } from "react";
import { createPortal } from "react-dom";
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

/**
 * Minimal true-focus fullscreen surface.
 * The user requested a pure black distraction-free timer only.
 * We therefore hide every secondary control and use tap / Escape only to return.
 */
export function FocusImmersiveMode({
  direction,
  clockText,
  paused,
  onExit,
}: FocusImmersiveModeProps) {
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
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onExit();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onExit]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <section
      dir={direction}
      className={`focus-immersive-layer ${paused ? "is-paused" : "is-active"}`}
      role="dialog"
      aria-modal="true"
      aria-label="Focus fullscreen timer"
      onPointerDown={onExit}
    >
      <div className="focus-immersive-stage" aria-hidden="true" />
      <div className="focus-immersive-clock-wrap" aria-live="off">
        <time className="focus-immersive-clock" dir="ltr">
          {clockText}
        </time>
      </div>
    </section>,
    document.body,
  );
}
