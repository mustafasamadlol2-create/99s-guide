import { useCallback, useEffect, useRef, useState } from "react";
import { animate, useMotionValue, useReducedMotion, type MotionValue } from "motion/react";
import { HapticFeedback } from "../device/haptic";

export type SwipeBackDirection = "ltr" | "rtl";

interface UseSwipeBackOptions {
  onSwipeBack: () => void;
  isEnabled: boolean;
  /** LTR = drag from the left edge toward the right. RTL mirrors the gesture. */
  direction?: SwipeBackDirection;
  /** Width of the system edge activation zone. */
  edgeWidth?: number;
  /** Minimum progress (0..1) that commits even with a slow drag. */
  commitProgress?: number;
  /** Fast flick velocity in px/ms that commits after a small minimum drag. */
  velocityThreshold?: number;
  onSwipeStart?: () => void;
  onSwipeMove?: (signedOffset: number, progress: number) => void;
  onSwipeEnd?: (success: boolean) => void;
}

export interface SwipeBackGesture {
  x: MotionValue<number>;
  progress: MotionValue<number>;
  isInteracting: boolean;
  directionSign: 1 | -1;
  /** Programmatic Back (e.g. the visible Back button) using the same transition. */
  triggerBack: () => void;
}

const DISABLED_TARGET_SELECTOR = [
  '[data-swipe-back-disabled="true"]',
  "input",
  "textarea",
  "select",
  '[contenteditable="true"]',
  '[role="slider"]',
  '#ios_native_tabbar_wrapper',
].join(",");

/**
 * iOS / iPadOS only. Modern iPadOS Safari and WKWebView can report a Macintosh
 * platform, so maxTouchPoints is part of the iPad check. A MacBook trackpad does
 * not report touch points and therefore never opts in.
 */
export function isAppleTouchNavigationDevice(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const isClassicIOS = /iPhone|iPad|iPod/i.test(ua);
  const isModernIPad = platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const hasTouch = navigator.maxTouchPoints > 0 || "ontouchstart" in window;

  return hasTouch && (isClassicIOS || isModernIPad);
}

/**
 * Native-feeling, interactive iOS edge swipe-back.
 *
 * The drag is driven by MotionValues so finger tracking does not cause a React
 * render on every frame. A successful gesture settles the current surface fully
 * off-screen before navigation state is popped; a cancelled gesture springs
 * cleanly back to zero. Only iPhone/iPad touch environments can activate it.
 */
export function useSwipeBack({
  onSwipeBack,
  isEnabled,
  direction = "ltr",
  edgeWidth = 30,
  commitProgress = 0.34,
  velocityThreshold = 0.55,
  onSwipeStart,
  onSwipeMove,
  onSwipeEnd,
}: UseSwipeBackOptions): SwipeBackGesture {
  const x = useMotionValue(0);
  const progress = useMotionValue(0);
  const reduceMotion = useReducedMotion();
  const [isInteracting, setIsInteracting] = useState(false);

  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const lastXRef = useRef(0);
  const lastTimeRef = useRef(0);
  const velocityRef = useRef(0);
  const eligibleRef = useRef(false);
  const horizontalLockRef = useRef(false);
  const settlingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const animationStopRef = useRef<(() => void) | null>(null);
  const triggerBackRef = useRef<(() => void) | null>(null);

  const onSwipeBackRef = useRef(onSwipeBack);
  const onSwipeStartRef = useRef(onSwipeStart);
  const onSwipeMoveRef = useRef(onSwipeMove);
  const onSwipeEndRef = useRef(onSwipeEnd);
  const directionRef = useRef(direction);
  const edgeWidthRef = useRef(edgeWidth);
  const commitProgressRef = useRef(commitProgress);
  const velocityThresholdRef = useRef(velocityThreshold);

  useEffect(() => {
    onSwipeBackRef.current = onSwipeBack;
    onSwipeStartRef.current = onSwipeStart;
    onSwipeMoveRef.current = onSwipeMove;
    onSwipeEndRef.current = onSwipeEnd;
    directionRef.current = direction;
    edgeWidthRef.current = edgeWidth;
    commitProgressRef.current = commitProgress;
    velocityThresholdRef.current = velocityThreshold;
  });

  const triggerBack = useCallback(() => {
    if (triggerBackRef.current) {
      triggerBackRef.current();
      return;
    }
    // On non-iOS devices (or if the gesture is disabled), Back buttons keep
    // their existing immediate behavior.
    onSwipeBackRef.current();
  }, []);

  useEffect(() => {
    if (!isEnabled || !isAppleTouchNavigationDevice()) {
      x.set(0);
      progress.set(0);
      setIsInteracting(false);
      return;
    }

    const stopAnimation = () => {
      animationStopRef.current?.();
      animationStopRef.current = null;
    };

    const viewportWidth = () =>
      Math.max(1, Math.round(window.visualViewport?.width || window.innerWidth || 1));

    const signedDistance = (clientX: number) => {
      const raw =
        directionRef.current === "rtl"
          ? startXRef.current - clientX
          : clientX - startXRef.current;
      return Math.max(0, raw);
    };

    const signedOffset = (distance: number) =>
      directionRef.current === "rtl" ? -distance : distance;

    const resetTracking = () => {
      eligibleRef.current = false;
      horizontalLockRef.current = false;
      velocityRef.current = 0;
    };

    const settleTo = (target: number, success: boolean) => {
      stopAnimation();
      settlingRef.current = true;

      const targetProgress = success ? 1 : 0;
      const distanceRemaining = Math.abs(target - x.get());
      const width = viewportWidth();
      const normalized = Math.min(1, distanceRemaining / width);
      const duration = reduceMotion
        ? 0.01
        : success
          ? Math.max(0.12, 0.2 * normalized)
          : Math.max(0.14, 0.24 * normalized);

      const controls = animate(x, target, {
        duration,
        ease: [0.22, 1, 0.36, 1],
        onUpdate: (latest) => {
          const p = Math.min(1, Math.abs(latest) / width);
          progress.set(p);
          onSwipeMoveRef.current?.(latest, p);
        },
        onComplete: () => {
          progress.set(targetProgress);
          settlingRef.current = false;
          onSwipeEndRef.current?.(success);

          if (success) {
            HapticFeedback.impact("light");
            onSwipeBackRef.current();
            // The destination state is now active. Reset the reusable motion
            // values immediately so the next nested screen starts at x=0.
            x.set(0);
            progress.set(0);
          }

          setIsInteracting(false);
        },
      });

      animationStopRef.current = () => controls.stop();
    };

    triggerBackRef.current = () => {
      if (settlingRef.current) return;
      resetTracking();
      x.set(0);
      progress.set(0);
      setIsInteracting(true);
      onSwipeStartRef.current?.();
      settleTo(signedOffset(viewportWidth()), true);
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (settlingRef.current || event.touches.length !== 1) return;

      const touch = event.touches[0];
      const width = viewportWidth();
      const region = document.querySelector<HTMLElement>(
        '[data-swipe-back-region="true"]',
      );
      const regionRect = region?.getBoundingClientRect();
      const leftEdge = regionRect?.left ?? 0;
      const rightEdge = regionRect?.right ?? width;
      const edgeSlop = 2;
      const inEdge =
        directionRef.current === "rtl"
          ? touch.clientX >= rightEdge - edgeWidthRef.current &&
            touch.clientX <= rightEdge + edgeSlop
          : touch.clientX <= leftEdge + edgeWidthRef.current &&
            touch.clientX >= leftEdge - edgeSlop;

      const target = event.target as Element | null;
      const modalIsOpen = Boolean(
        document.querySelector('[role="dialog"][aria-modal="true"]'),
      );
      const blocked =
        modalIsOpen || Boolean(target?.closest?.(DISABLED_TARGET_SELECTOR));

      if (!inEdge || blocked) {
        resetTracking();
        return;
      }

      stopAnimation();
      x.set(0);
      progress.set(0);
      startXRef.current = touch.clientX;
      startYRef.current = touch.clientY;
      lastXRef.current = touch.clientX;
      lastTimeRef.current = performance.now();
      velocityRef.current = 0;
      eligibleRef.current = true;
      horizontalLockRef.current = false;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!eligibleRef.current || event.touches.length !== 1) return;

      const touch = event.touches[0];
      const distance = signedDistance(touch.clientX);
      const verticalDistance = Math.abs(touch.clientY - startYRef.current);

      if (!horizontalLockRef.current) {
        if (verticalDistance > 10 && verticalDistance > distance * 0.72) {
          resetTracking();
          return;
        }

        if (distance < 7) return;
        if (verticalDistance > distance * 0.58) return;

        horizontalLockRef.current = true;
        setIsInteracting(true);
        onSwipeStartRef.current?.();
      }

      if (event.cancelable) event.preventDefault();

      const now = performance.now();
      const dt = Math.max(1, now - lastTimeRef.current);
      const frameDirectionalDistance =
        directionRef.current === "rtl"
          ? lastXRef.current - touch.clientX
          : touch.clientX - lastXRef.current;
      // Smooth noisy iOS touch samples instead of trusting a single packet.
      const instantaneousVelocity = Math.max(0, frameDirectionalDistance / dt);
      velocityRef.current = velocityRef.current * 0.68 + instantaneousVelocity * 0.32;
      lastXRef.current = touch.clientX;
      lastTimeRef.current = now;

      const width = viewportWidth();
      const clampedDistance = Math.min(width, distance);
      const offset = signedOffset(clampedDistance);
      const nextProgress = Math.min(1, clampedDistance / width);

      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        x.set(offset);
        progress.set(nextProgress);
        onSwipeMoveRef.current?.(offset, nextProgress);
      });
    };

    const finishGesture = (event: TouchEvent | null, cancelled = false) => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      if (!eligibleRef.current) return;

      const hadHorizontalLock = horizontalLockRef.current;
      const clientX = event?.changedTouches?.[0]?.clientX ?? lastXRef.current;
      const distance = signedDistance(clientX);
      const width = viewportWidth();
      const finalProgress = Math.min(1, distance / width);
      const fastFlick =
        distance >= 36 && velocityRef.current >= velocityThresholdRef.current;
      const success =
        !cancelled &&
        hadHorizontalLock &&
        (finalProgress >= commitProgressRef.current || fastFlick);

      resetTracking();

      if (!hadHorizontalLock) {
        x.set(0);
        progress.set(0);
        return;
      }

      settleTo(success ? signedOffset(width) : 0, success);
    };

    const handleTouchEnd = (event: TouchEvent) => finishGesture(event, false);
    const handleTouchCancel = (event: TouchEvent) => finishGesture(event, true);

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      stopAnimation();
      triggerBackRef.current = null;
      resetTracking();
      x.set(0);
      progress.set(0);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [isEnabled, progress, reduceMotion, x]);

  return {
    x,
    progress,
    isInteracting,
    directionSign: direction === "rtl" ? -1 : 1,
    triggerBack,
  };
}
