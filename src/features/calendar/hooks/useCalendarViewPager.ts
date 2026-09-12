import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import {
  animate,
  useMotionValue,
  useReducedMotion,
  type MotionValue,
} from "motion/react";
import { HapticFeedback } from "../../../core/device/haptic";
import { isAppleTouchNavigationDevice } from "../../../core/hooks/useSwipeBack";
import { IOS_SWIPE_MOTION } from "../../../core/motion/swipeMotion";

export type CalendarViewMode = "week" | "day" | "month";

const VIEW_ORDER: CalendarViewMode[] = ["week", "day", "month"];

interface UseCalendarViewPagerOptions {
  activeView: CalendarViewMode;
  isRtl: boolean;
  onCommit: (view: CalendarViewMode) => void;
  blockedSelector?: string;
  isEnabled?: boolean;
}

interface CalendarViewPagerGesture {
  surfaceRef: RefObject<HTMLDivElement | null>;
  x: MotionValue<number>;
  targetX: MotionValue<number>;
  /** 0 = Week, 1 = Day, 2 = Month. */
  indicatorPosition: MotionValue<number>;
  targetView: CalendarViewMode | null;
  isInteracting: boolean;
  navigateTo: (view: CalendarViewMode) => void;
}

const viewIndex = (view: CalendarViewMode) => VIEW_ORDER.indexOf(view);
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Interactive iOS/iPadOS pager for switching the calendar VIEW only.
 *
 * It never changes the selected temporal period. Week/day/month next/previous
 * remain owned exclusively by their explicit arrow/Today controls. The live
 * destination view is painted beside the foreground page before completion,
 * then React commits only after that destination is already at x=0.
 */
export function useCalendarViewPager({
  activeView,
  isRtl,
  onCommit,
  blockedSelector,
  isEnabled = true,
}: UseCalendarViewPagerOptions): CalendarViewPagerGesture {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const x = useMotionValue(0);
  const targetX = useMotionValue(0);
  const indicatorPosition = useMotionValue(viewIndex(activeView));
  const reduceMotion = useReducedMotion();

  const [targetView, setTargetViewState] = useState<CalendarViewMode | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);

  const activeViewRef = useRef(activeView);
  const isRtlRef = useRef(isRtl);
  const onCommitRef = useRef(onCommit);
  const blockedSelectorRef = useRef(blockedSelector);
  const enabledRef = useRef(isEnabled);
  const targetViewRef = useRef<CalendarViewMode | null>(null);
  const targetIndexRef = useRef(-1);
  const exitSignRef = useRef<1 | -1>(-1);

  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const lastXRef = useRef(0);
  const lastTimeRef = useRef(0);
  const velocityRef = useRef(0);
  const eligibleRef = useRef(false);
  const horizontalLockRef = useRef(false);
  const settlingRef = useRef(false);
  const stopAnimationRef = useRef<(() => void) | null>(null);
  const programmaticFrameRef = useRef<number | null>(null);
  const commitFrameRef = useRef<number | null>(null);
  const handoffFrameRef = useRef<number | null>(null);

  const setTargetView = useCallback((view: CalendarViewMode | null) => {
    targetViewRef.current = view;
    targetIndexRef.current = view == null ? -1 : viewIndex(view);
    setTargetViewState(view);
  }, []);

  useLayoutEffect(() => {
    activeViewRef.current = activeView;
    isRtlRef.current = isRtl;
    onCommitRef.current = onCommit;
    blockedSelectorRef.current = blockedSelector;
    enabledRef.current = isEnabled;

    if (!settlingRef.current && !isInteracting) {
      indicatorPosition.set(viewIndex(activeView));
    }
  });

  const stopAnimation = useCallback(() => {
    stopAnimationRef.current?.();
    stopAnimationRef.current = null;
  }, []);

  const clearFrames = useCallback(() => {
    if (programmaticFrameRef.current !== null) {
      cancelAnimationFrame(programmaticFrameRef.current);
      programmaticFrameRef.current = null;
    }
    if (commitFrameRef.current !== null) {
      cancelAnimationFrame(commitFrameRef.current);
      commitFrameRef.current = null;
    }
    if (handoffFrameRef.current !== null) {
      cancelAnimationFrame(handoffFrameRef.current);
      handoffFrameRef.current = null;
    }
  }, []);

  const getSurfaceWidth = useCallback(() => {
    const node = surfaceRef.current;
    return Math.max(
      1,
      node?.getBoundingClientRect().width ||
        window.visualViewport?.width ||
        window.innerWidth ||
        1,
    );
  }, []);

  const exitSignForTarget = useCallback(
    (from: CalendarViewMode, to: CalendarViewMode): 1 | -1 => {
      const logicalDelta = viewIndex(to) - viewIndex(from);
      // LTR: advancing Week -> Day -> Month exits left. RTL mirrors it.
      if (logicalDelta > 0) return isRtlRef.current ? 1 : -1;
      return isRtlRef.current ? -1 : 1;
    },
    [],
  );

  const syncPages = useCallback(
    (
      foregroundOffset: number,
      width: number,
      exitSign: 1 | -1,
      fromView: CalendarViewMode,
      toView: CalendarViewMode,
    ) => {
      const progress = clamp01((foregroundOffset * exitSign) / Math.max(1, width));
      // Native push/pop layering: the destination is already painted beneath
      // the foreground and moves only 22px into place, exactly like the
      // approved Notifications/Settings -> Profile swipe-back.
      targetX.set(-exitSign * IOS_SWIPE_MOTION.underlayOffset * (1 - progress));
      const fromIndex = viewIndex(fromView);
      const toIndex = viewIndex(toView);
      indicatorPosition.set(fromIndex + (toIndex - fromIndex) * progress);
    },
    [indicatorPosition, targetX],
  );

  const finishSuccessfulTransition = useCallback(
    (
      toView: CalendarViewMode,
      exitSign: 1 | -1,
      width: number,
      releaseVelocityPxPerMs: number,
    ) => {
      stopAnimation();
      clearFrames();
      settlingRef.current = true;
      setIsInteracting(true);

      const fromView = activeViewRef.current;
      const exitTarget = exitSign * width;
      const velocityPxPerSecond = Math.max(
        -width * IOS_SWIPE_MOTION.completionVelocityScreensPerSecond,
        Math.min(
          width * IOS_SWIPE_MOTION.completionVelocityScreensPerSecond,
          releaseVelocityPxPerMs * 1000,
        ),
      );

      const finishHandoff = () => {
        // Atomic iOS-style handoff: the destination is already fully painted at
        // x=0 underneath the outgoing page. Reset the motion values and commit
        // React state in the same JavaScript turn, before the browser can paint
        // another frame. This removes the duplicate-page / resize frame that
        // previously appeared after a Week/Day/Month transition in WKWebView.
        stopAnimationRef.current = null;
        activeViewRef.current = toView;
        x.set(0);
        targetX.set(0);
        indicatorPosition.set(viewIndex(toView));

        flushSync(() => {
          onCommitRef.current(toView);
          setTargetView(null);
          setIsInteracting(false);
        });

        settlingRef.current = false;
        HapticFeedback.selection();
      };

      if (reduceMotion) {
        const controls = animate(x, exitTarget, {
          duration: 0.01,
          onUpdate: (latest) => syncPages(latest, width, exitSign, fromView, toView),
          onComplete: finishHandoff,
        });
        stopAnimationRef.current = () => controls.stop();
        return;
      }

      const controls = animate(x, exitTarget, {
        type: "spring",
        stiffness: IOS_SWIPE_MOTION.completionSpring.stiffness,
        damping: IOS_SWIPE_MOTION.completionSpring.damping,
        mass: IOS_SWIPE_MOTION.completionSpring.mass,
        velocity: velocityPxPerSecond,
        restSpeed: IOS_SWIPE_MOTION.completionSpring.restSpeed,
        restDelta: IOS_SWIPE_MOTION.completionSpring.restDelta,
        onUpdate: (latest) => syncPages(latest, width, exitSign, fromView, toView),
        onComplete: finishHandoff,
      });
      stopAnimationRef.current = () => controls.stop();
    },
    [clearFrames, indicatorPosition, reduceMotion, setTargetView, stopAnimation, syncPages, targetX, x],
  );

  const navigateTo = useCallback(
    (nextView: CalendarViewMode) => {
      const fromView = activeViewRef.current;
      if (nextView === fromView || settlingRef.current) return;

      if (!isEnabled || !isAppleTouchNavigationDevice()) {
        indicatorPosition.set(viewIndex(nextView));
        onCommitRef.current(nextView);
        return;
      }

      stopAnimation();
      clearFrames();
      const width = getSurfaceWidth();
      const exitSign = exitSignForTarget(fromView, nextView);
      exitSignRef.current = exitSign;
      setTargetView(nextView);
      x.set(0);
      syncPages(0, width, exitSign, fromView, nextView);
      setIsInteracting(true);

      // Let React paint the destination just offscreen before the programmatic
      // segment transition starts. This prevents an empty first frame.
      programmaticFrameRef.current = requestAnimationFrame(() => {
        programmaticFrameRef.current = null;
        finishSuccessfulTransition(nextView, exitSign, width, 0);
      });
    },
    [clearFrames, exitSignForTarget, finishSuccessfulTransition, getSurfaceWidth, indicatorPosition, isEnabled, setTargetView, stopAnimation, syncPages, x],
  );

  useEffect(() => {
    const node = surfaceRef.current;
    if (!node || !isEnabled || !isAppleTouchNavigationDevice()) {
      x.set(0);
      targetX.set(0);
      indicatorPosition.set(viewIndex(activeViewRef.current));
      setTargetView(null);
      setIsInteracting(false);
      return;
    }

    const resetTracking = () => {
      eligibleRef.current = false;
      horizontalLockRef.current = false;
      velocityRef.current = 0;
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (!enabledRef.current || settlingRef.current || event.touches.length !== 1) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (blockedSelectorRef.current && target.closest(blockedSelectorRef.current)) return;

      stopAnimation();
      clearFrames();
      setTargetView(null);
      x.set(0);
      targetX.set(0);
      indicatorPosition.set(viewIndex(activeViewRef.current));

      const touch = event.touches[0];
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
      const dx = touch.clientX - startXRef.current;
      const dy = touch.clientY - startYRef.current;

      if (!horizontalLockRef.current) {
        if (Math.abs(dy) >= IOS_SWIPE_MOTION.verticalRejectDistance && Math.abs(dy) > Math.abs(dx) * IOS_SWIPE_MOTION.verticalRejectRatio) {
          resetTracking();
          return;
        }
        if (Math.abs(dx) < IOS_SWIPE_MOTION.axisLockDistance) return;
        if (Math.abs(dy) > Math.abs(dx) * IOS_SWIPE_MOTION.horizontalLockMaxVerticalRatio) return;

        const physicalExitSign: 1 | -1 = dx >= 0 ? 1 : -1;
        const logicalDelta = isRtlRef.current ? physicalExitSign : -physicalExitSign;
        const fromIndex = viewIndex(activeViewRef.current);
        const nextIndex = fromIndex + logicalDelta;
        if (nextIndex < 0 || nextIndex >= VIEW_ORDER.length) {
          resetTracking();
          return;
        }

        const nextView = VIEW_ORDER[nextIndex];
        exitSignRef.current = physicalExitSign;
        setTargetView(nextView);
        const width = getSurfaceWidth();
        syncPages(0, width, physicalExitSign, activeViewRef.current, nextView);
        horizontalLockRef.current = true;
        setIsInteracting(true);
      }

      const toView = targetViewRef.current;
      if (!toView) return;
      const exitSign = exitSignRef.current;
      const directionalDistance = dx * exitSign;
      const width = getSurfaceWidth();

      if (event.cancelable) event.preventDefault();

      const now = performance.now();
      const dt = Math.max(1, now - lastTimeRef.current);
      const instantaneousVelocity = (touch.clientX - lastXRef.current) / dt;
      velocityRef.current =
        velocityRef.current * IOS_SWIPE_MOTION.velocityPreviousWeight +
        instantaneousVelocity * IOS_SWIPE_MOTION.velocityCurrentWeight;
      lastXRef.current = touch.clientX;
      lastTimeRef.current = now;

      if (directionalDistance <= 0) {
        x.set(0);
        syncPages(0, width, exitSign, activeViewRef.current, toView);
        return;
      }

      const clamped = Math.max(-width, Math.min(width, dx));
      x.set(clamped);
      syncPages(clamped, width, exitSign, activeViewRef.current, toView);
    };

    const finishGesture = (event: TouchEvent | null, cancelled = false) => {
      if (!eligibleRef.current) return;
      const hadLock = horizontalLockRef.current;
      const toView = targetViewRef.current;
      const clientX = event?.changedTouches?.[0]?.clientX ?? lastXRef.current;
      const dx = clientX - startXRef.current;
      const exitSign = exitSignRef.current;
      const width = getSurfaceWidth();
      const directionalDistance = dx * exitSign;
      const releaseVelocity = velocityRef.current;
      const releaseVelocityInDirection = releaseVelocity * exitSign;
      const progress = Math.max(0, directionalDistance) / width;
      const fastFlick =
        directionalDistance >= IOS_SWIPE_MOTION.flickDistance &&
        releaseVelocityInDirection >= IOS_SWIPE_MOTION.velocityThreshold;
      const success =
        !cancelled &&
        hadLock &&
        Boolean(toView) &&
        directionalDistance > 0 &&
        (progress >= IOS_SWIPE_MOTION.commitProgress || fastFlick);

      resetTracking();
      if (!hadLock || !toView) {
        x.set(0);
        targetX.set(0);
        indicatorPosition.set(viewIndex(activeViewRef.current));
        setTargetView(null);
        setIsInteracting(false);
        return;
      }

      if (success) {
        finishSuccessfulTransition(toView, exitSign, width, releaseVelocity);
        return;
      }

      settlingRef.current = true;
      const fromView = activeViewRef.current;
      const finishCancel = () => {
        settlingRef.current = false;
        x.set(0);
        targetX.set(0);
        indicatorPosition.set(viewIndex(fromView));
        setTargetView(null);
        setIsInteracting(false);
      };

      if (reduceMotion) {
        const controls = animate(x, 0, {
          duration: 0.01,
          onUpdate: (latest) => syncPages(latest, width, exitSign, fromView, toView),
          onComplete: finishCancel,
        });
        stopAnimationRef.current = () => controls.stop();
        return;
      }

      const controls = animate(x, 0, {
        type: "spring",
        stiffness: IOS_SWIPE_MOTION.cancelSpring.stiffness,
        damping: IOS_SWIPE_MOTION.cancelSpring.damping,
        mass: IOS_SWIPE_MOTION.cancelSpring.mass,
        velocity: Math.max(
          -width * IOS_SWIPE_MOTION.cancelVelocityScreensPerSecond,
          Math.min(
            width * IOS_SWIPE_MOTION.cancelVelocityScreensPerSecond,
            releaseVelocity * 1000,
          ),
        ),
        restSpeed: IOS_SWIPE_MOTION.cancelSpring.restSpeed,
        restDelta: IOS_SWIPE_MOTION.cancelSpring.restDelta,
        onUpdate: (latest) => syncPages(latest, width, exitSign, fromView, toView),
        onComplete: finishCancel,
      });
      stopAnimationRef.current = () => controls.stop();
    };

    const handleTouchEnd = (event: TouchEvent) => finishGesture(event, false);
    const handleTouchCancel = (event: TouchEvent) => finishGesture(event, true);

    node.addEventListener("touchstart", handleTouchStart, { passive: true });
    node.addEventListener("touchmove", handleTouchMove, { passive: false });
    node.addEventListener("touchend", handleTouchEnd, { passive: true });
    node.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    return () => {
      resetTracking();
      stopAnimation();
      clearFrames();
      settlingRef.current = false;
      x.set(0);
      targetX.set(0);
      indicatorPosition.set(viewIndex(activeViewRef.current));
      setTargetView(null);
      setIsInteracting(false);
      node.removeEventListener("touchstart", handleTouchStart);
      node.removeEventListener("touchmove", handleTouchMove);
      node.removeEventListener("touchend", handleTouchEnd);
      node.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [
    clearFrames,
    finishSuccessfulTransition,
    getSurfaceWidth,
    indicatorPosition,
    isEnabled,
    reduceMotion,
    setTargetView,
    stopAnimation,
    syncPages,
    targetX,
    x,
  ]);

  return {
    surfaceRef,
    x,
    targetX,
    indicatorPosition,
    targetView,
    isInteracting,
    navigateTo,
  };
}
