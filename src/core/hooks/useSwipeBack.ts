import { useCallback, useEffect, useRef, useState } from "react";
import { animate, useMotionValue, useReducedMotion, type MotionValue } from "motion/react";
import { HapticFeedback } from "../device/haptic";

export type SwipeBackDirection = "ltr" | "rtl";

interface UseSwipeBackOptions {
  onSwipeBack: () => void;
  isEnabled: boolean;
  /** LTR = drag from the left edge toward the right. RTL mirrors the gesture. */
  direction?: SwipeBackDirection;
  /** Width of the system edge activation zone when activationMode="edge". */
  edgeWidth?: number;
  /** Full-surface back matches the requested app-wide gesture; edge is kept for rare opt-in cases. */
  activationMode?: "full" | "edge";
  /** Minimum progress (0..1) that commits even with a slow drag. */
  commitProgress?: number;
  /** Fast flick velocity in px/ms that commits after a small minimum drag. */
  velocityThreshold?: number;
  /** Optional selector that the initial touch target must be inside. */
  allowedStartSelector?: string;
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
  '[data-horizontal-pager="true"]',
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
 * Native-feeling, interactive iOS/iPadOS swipe-back. By default the gesture
 * can begin anywhere on the active page; direction still determines whether
 * the drag is a Back request.
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
  activationMode = "full",
  commitProgress = 0.30,
  velocityThreshold = 0.50,
  allowedStartSelector,
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
  const activationModeRef = useRef(activationMode);
  const commitProgressRef = useRef(commitProgress);
  const velocityThresholdRef = useRef(velocityThreshold);
  const allowedStartSelectorRef = useRef(allowedStartSelector);

  useEffect(() => {
    onSwipeBackRef.current = onSwipeBack;
    onSwipeStartRef.current = onSwipeStart;
    onSwipeMoveRef.current = onSwipeMove;
    onSwipeEndRef.current = onSwipeEnd;
    directionRef.current = direction;
    edgeWidthRef.current = edgeWidth;
    activationModeRef.current = activationMode;
    commitProgressRef.current = commitProgress;
    velocityThresholdRef.current = velocityThreshold;
    allowedStartSelectorRef.current = allowedStartSelector;
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

    const settleTo = (target: number, success: boolean, releaseVelocity = 0) => {
      stopAnimation();
      settlingRef.current = true;

      const targetProgress = success ? 1 : 0;
      const width = viewportWidth();
      const updateProgress = (latest: number) => {
        const p = Math.min(1, Math.abs(latest) / width);
        progress.set(p);
        onSwipeMoveRef.current?.(latest, p);
      };
      const finish = () => {
        progress.set(targetProgress);

        if (!success) {
          settlingRef.current = false;
          onSwipeEndRef.current?.(false);
          setIsInteracting(false);
          return;
        }

        HapticFeedback.impact("light");

        // First pop navigation while the outgoing page is still completely
        // off-screen. The underlay therefore remains the only visible page.
        // After two paint opportunities React/WKWebView has committed the live
        // destination; resetting x then becomes visually lossless instead of
        // producing the old white/reload-looking frame.
        onSwipeBackRef.current();
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            x.set(0);
            progress.set(0);
            settlingRef.current = false;
            setIsInteracting(false);
            onSwipeEndRef.current?.(true);
          });
        });
      };

      if (reduceMotion) {
        const controls = animate(x, target, {
          duration: 0.01,
          onUpdate: updateProgress,
          onComplete: finish,
        });
        animationStopRef.current = () => controls.stop();
        return;
      }

      if (!success) {
        // iOS-like cancellation: the page is physically connected to the
        // finger, then springs home without an artificial linear rewind.
        const controls = animate(x, 0, {
          type: "spring",
          stiffness: 445,
          damping: 43,
          mass: 0.82,
          restSpeed: 10,
          restDelta: 0.5,
          onUpdate: updateProgress,
          onComplete: finish,
        });
        animationStopRef.current = () => controls.stop();
        return;
      }

      const distanceRemaining = Math.abs(target - x.get());
      const pxPerSecond = Math.max(width * 3.05, releaseVelocity * 1000);
      const duration = Math.max(
        0.14,
        Math.min(0.29, distanceRemaining / Math.max(1, pxPerSecond)),
      );

      const controls = animate(x, target, {
        duration,
        // Close to UIKit's decelerating interactive-pop completion curve.
        ease: [0.32, 0.72, 0, 1],
        onUpdate: updateProgress,
        onComplete: finish,
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
      settleTo(signedOffset(viewportWidth()), true, 0);
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
      const startsInAllowedZone = activationModeRef.current === "full" || inEdge;

      const rawTarget = event.target;
      const target =
        rawTarget instanceof Element
          ? rawTarget
          : rawTarget instanceof Node
            ? rawTarget.parentElement
            : null;
      const requiredStartSelector = allowedStartSelectorRef.current;
      const startsInsideRequiredRegion =
        !requiredStartSelector || Boolean(target?.closest?.(requiredStartSelector));

      // Some sheets/dialogs remain mounted after they are visually closed.
      // Only a genuinely visible modal should suppress navigation gestures.
      const modalIsOpen = Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'),
      ).some((dialog) => {
        if (dialog.hidden || dialog.getAttribute("aria-hidden") === "true") return false;
        const style = window.getComputedStyle(dialog);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.pointerEvents !== "none" &&
          dialog.getClientRects().length > 0
        );
      });
      const blocked =
        modalIsOpen || Boolean(target?.closest?.(DISABLED_TARGET_SELECTOR));

      if (!startsInAllowedZone || !startsInsideRequiredRegion || blocked) {
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
      const rawHorizontalDistance = touch.clientX - startXRef.current;
      const directionalDistance =
        directionRef.current === "rtl" ? -rawHorizontalDistance : rawHorizontalDistance;
      const distance = Math.max(0, directionalDistance);
      const absoluteHorizontalDistance = Math.abs(rawHorizontalDistance);
      const verticalDistance = Math.abs(touch.clientY - startYRef.current);

      if (!horizontalLockRef.current) {
        // iOS often reports a few noisy diagonal samples immediately after the
        // finger lands. Wait for clear intent instead of rejecting the gesture
        // on those first pixels. Vertical scrolling still wins decisively.
        if (
          verticalDistance >= 20 &&
          verticalDistance > absoluteHorizontalDistance * 1.20
        ) {
          resetTracking();
          return;
        }

        // Ignore a tiny opposite-direction wobble, but reject a deliberate
        // horizontal gesture in the wrong direction once it is unambiguous.
        if (directionalDistance <= 0) {
          if (
            absoluteHorizontalDistance >= 18 &&
            absoluteHorizontalDistance > verticalDistance * 1.30
          ) {
            resetTracking();
          }
          return;
        }

        if (distance < 5) return;
        if (verticalDistance > distance * 0.92) return;

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
      const releaseVelocity = velocityRef.current;
      const fastFlick =
        distance >= 32 && releaseVelocity >= velocityThresholdRef.current;
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

      settleTo(success ? signedOffset(width) : 0, success, releaseVelocity);
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
