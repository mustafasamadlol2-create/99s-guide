import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { NativeBridge } from "../../../core/device/capacitor/nativeBridge";
import type { FocusRuntimeController } from "../runtime/controller";
import { formatFocusClock } from "../focusActiveModel";
import "./focus-immersive.css";

export interface FocusImmersiveModeProps {
  direction: "ltr" | "rtl";
  controller: FocusRuntimeController;
  paused: boolean;
  onExit: () => void;
}

/**
 * Distraction-free fullscreen Focus surface.
 *
 * The fullscreen intentionally renders no controls, labels, rings, lecture names,
 * or secondary UI. It subscribes directly to FocusRuntimeController so the clock
 * keeps ticking even though ActiveFocusScreen deliberately suppresses per-second
 * parent re-renders.
 */
export function FocusImmersiveMode({
  direction,
  controller,
  paused,
  onExit,
}: FocusImmersiveModeProps) {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(
    () => controller.getState().displayRemainingSeconds,
  );

  useEffect(() => controller.subscribe((state) => {
    setRemainingSeconds((current) =>
      current === state.displayRemainingSeconds ? current : state.displayRemainingSeconds,
    );
  }), [controller]);

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

  const clockText = remainingSeconds === null
    ? "--:--"
    : formatFocusClock(remainingSeconds);
  const [minutes, seconds] = useMemo(() => {
    const [left = "--", right = "--"] = clockText.split(":");
    return [left, right];
  }, [clockText]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <section
      dir={direction}
      className={`focus-immersive-layer ${paused ? "is-paused" : "is-active"}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Focus timer ${clockText}`}
      onPointerDown={onExit}
    >
      <div className="focus-immersive-atmosphere" aria-hidden="true">
        <span className="focus-immersive-breath focus-immersive-breath--outer" />
        <span className="focus-immersive-breath focus-immersive-breath--inner" />
      </div>

      <div className="focus-immersive-clock-wrap" aria-live="off">
        <time className="focus-immersive-clock" dir="ltr" aria-label={clockText}>
          <span className="focus-immersive-minutes">{minutes}</span>
          <span className="focus-immersive-colon" aria-hidden="true">:</span>
          <span key={remainingSeconds ?? "unknown"} className="focus-immersive-seconds">{seconds}</span>
        </time>
      </div>
    </section>,
    document.body,
  );
}
