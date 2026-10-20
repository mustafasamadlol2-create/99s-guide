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

function RollingDigit({ value }: { value: string }) {
  const [frame, setFrame] = useState<{
    current: string;
    previous: string | null;
    serial: number;
  }>(() => ({ current: value, previous: null, serial: 0 }));

  useEffect(() => {
    setFrame((currentFrame) => {
      if (currentFrame.current === value) return currentFrame;
      return {
        current: value,
        previous: currentFrame.current,
        serial: currentFrame.serial + 1,
      };
    });
  }, [value]);

  useEffect(() => {
    if (frame.previous === null) return;
    const serial = frame.serial;
    const timer = window.setTimeout(() => {
      setFrame((currentFrame) =>
        currentFrame.serial === serial
          ? { ...currentFrame, previous: null }
          : currentFrame,
      );
    }, 420);
    return () => window.clearTimeout(timer);
  }, [frame.previous, frame.serial]);

  return (
    <span className="focus-immersive-digit-slot" aria-hidden="true">
      {frame.previous !== null && (
        <span
          key={`out-${frame.serial}`}
          className="focus-immersive-digit focus-immersive-digit--outgoing"
        >
          {frame.previous}
        </span>
      )}
      <span
        key={`in-${frame.serial}`}
        className={`focus-immersive-digit ${frame.previous !== null ? "focus-immersive-digit--incoming" : ""}`}
      >
        {frame.current}
      </span>
    </span>
  );
}

function RollingNumberGroup({ value }: { value: string }) {
  return (
    <span className="focus-immersive-number-group" aria-hidden="true">
      {Array.from(value).map((digit, index) => (
        <RollingDigit key={index} value={digit} />
      ))}
    </span>
  );
}

/**
 * Distraction-free fullscreen Focus surface.
 *
 * It deliberately contains only the live canonical timer. The clock subscribes
 * directly to FocusRuntimeController, while each changed digit gets a short
 * iOS-style numeric roll/fade without adding controls or distracting content.
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
          <RollingNumberGroup value={minutes} />
          <span className="focus-immersive-colon" aria-hidden="true">:</span>
          <RollingNumberGroup value={seconds} />
        </time>
      </div>
    </section>,
    document.body,
  );
}
