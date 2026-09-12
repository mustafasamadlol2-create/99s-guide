import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  animate,
  useMotionValue,
  useReducedMotion,
  type MotionValue,
} from "motion/react";
import { flushSync } from "react-dom";
import { HapticFeedback } from "../../../core/device/haptic";
import { isAppleTouchNavigationDevice } from "../../../core/hooks/useSwipeBack";
import { IOS_SWIPE_MOTION } from "../../../core/motion/swipeMotion";

export type BulletinSegment = "all" | "unread";

interface UseBulletinSegmentPagerOptions {
  activeSegment: BulletinSegment;
  isRtl: boolean;
  onCommit: (segment: BulletinSegment) => void;
  blockedSelector?: string;
  isEnabled?: boolean;
}

interface BulletinSegmentPagerGesture {
  surfaceRef: RefObject<HTMLDivElement | null>;
  x: MotionValue<number>;
  underlayX: MotionValue<number>;
  /** 0 = All, 1 = Unread. Tracks the finger continuously for the segmented control. */
  indicatorPosition: MotionValue<number>;
  isInteracting: boolean;
  navigateTo: (segment: BulletinSegment) => void;
}

const opposite = (segment: BulletinSegment): BulletinSegment =>
  segment === "all" ? "unread" : "all";

/**
 * Two-page interactive pager for Notifications (All / Unread).
 *
 * The two pages behave like adjacent native pages rather than a web carousel:
 * the current page follows the finger 1:1 while the destination is already
 * painted underneath and parallax-reveals from the same 22px offset used by
 * Notifications/Settings -> Profile. React swaps the live segment only after
 * the target is sitting at x=0, so there is no snap, flash, or blank handoff.
 */
export function useBulletinSegmentPager({
  activeSegment,
  isRtl,
  onCommit,
  blockedSelector,
  isEnabled = true,
}: UseBulletinSegmentPagerOptions): BulletinSegmentPagerGesture {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const x = useMotionValue(0);
  const underlayX = useMotionValue(0);
  const indicatorPosition = useMotionValue(activeSegment === "all" ? 0 : 1);
  const reduceMotion = useReducedMotion();
  const [isInteracting, setIsInteracting] = useState(false);

  const activeSegmentRef = useRef(activeSegment);
  const isRtlRef = useRef(isRtl);
  const onCommitRef = useRef(onCommit);
  const blockedSelectorRef = useRef(blockedSelector);
  const enabledRef = useRef(isEnabled);

  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const lastXRef = useRef(0);
  const lastTimeRef = useRef(0);
  const velocityRef = useRef(0);
  const eligibleRef = useRef(false);
  const horizontalLockRef = useRef(false);
  const settlingRef = useRef(false);
  const stopAnimationRef = useRef<(() => void) | null>(null);
  const commitPaintFrameRef = useRef<number | null>(null);
  const handoffFrameRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    activeSegmentRef.current = activeSegment;
    isRtlRef.current = isRtl;
    onCommitRef.current = onCommit;
    blockedSelectorRef.current = blockedSelector;
    enabledRef.current = isEnabled;

    // External/tab-driven segment changes still keep the indicator authoritative.
    // During an interactive handoff the MotionValue is already sitting on the
    // destination, so do not snap it back while React commits the new segment.
    if (!settlingRef.current && !isInteracting) {
      indicatorPosition.set(activeSegment === "all" ? 0 : 1);
    }
  });

  const stopAnimation = useCallback(() => {
    stopAnimationRef.current?.();
    stopAnimationRef.current = null;
  }, []);

  const clearHandoffFrames = useCallback(() => {
    if (commitPaintFrameRef.current !== null) {
      cancelAnimationFrame(commitPaintFrameRef.current);
      commitPaintFrameRef.current = null;
    }
    if (handoffFrameRef.current !== null) {
      cancelAnimationFrame(handoffFrameRef.current);
      handoffFrameRef.current = null;
    }
  }, []);

  // Physical direction in which the CURRENT page exits.
  // LTR: All -> Unread exits left; Unread -> All exits right. RTL mirrors it.
  const exitSignFor = useCallback((segment: BulletinSegment): 1 | -1 => {
    if (segment === "all") return isRtlRef.current ? 1 : -1;
    return isRtlRef.current ? -1 : 1;
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

  /** Keep the destination page and the segmented-control thumb locked to the same gesture. */
  const syncAdjacentPage = useCallback(
    (foregroundOffset: number, width: number, exitSign: 1 | -1) => {
      const directionalProgress = Math.max(
        0,
        Math.min(1, (foregroundOffset * exitSign) / Math.max(1, width)),
      );
      underlayX.set(
        -exitSign * IOS_SWIPE_MOTION.underlayOffset * (1 - directionalProgress),
      );
      indicatorPosition.set(
        activeSegmentRef.current === "all"
          ? directionalProgress
          : 1 - directionalProgress,
      );
    },
    [indicatorPosition, underlayX],
  );

  const finishSuccessfulTransition = useCallback(
    (
      targetSegment: BulletinSegment,
      exitSign: 1 | -1,
      width: number,
      releaseVelocityPxPerMs: number,
    ) => {
      stopAnimation();
      clearHandoffFrames();
      settlingRef.current = true;
      setIsInteracting(true);

      const exitTarget = exitSign * width;
      const velocityPxPerSecond = Math.max(
        -width * IOS_SWIPE_MOTION.completionVelocityScreensPerSecond,
        Math.min(
          width * IOS_SWIPE_MOTION.completionVelocityScreensPerSecond,
          releaseVelocityPxPerMs * 1000,
        ),
      );

      const finishHandoff = () => {
        // Same atomic commit contract as Notifications -> Profile Back: the
        // destination is already painted underneath, so commit React state and
        // clear transforms in one task before WebKit can paint another frame.
        activeSegmentRef.current = targetSegment;
        flushSync(() => {
          onCommitRef.current(targetSegment);
        });
        x.set(0);
        underlayX.set(0);
        indicatorPosition.set(targetSegment === "all" ? 0 : 1);
        settlingRef.current = false;
        setIsInteracting(false);
        HapticFeedback.selection();
      };

      if (reduceMotion) {
        const controls = animate(x, exitTarget, {
          duration: 0.01,
          onUpdate: (latest) => syncAdjacentPage(latest, width, exitSign),
          onComplete: finishHandoff,
        });
        stopAnimationRef.current = () => controls.stop();
        return;
      }

      // Critically damped-feeling completion: velocity from the finger is
      // preserved, but there is no bounce/overshoot. This is intentionally close
      // to the physical character of UIKit page transitions rather than a CSS
      // ease or a second web-style slide animation.
      const controls = animate(x, exitTarget, {
        type: "spring",
        stiffness: IOS_SWIPE_MOTION.completionSpring.stiffness,
        damping: IOS_SWIPE_MOTION.completionSpring.damping,
        mass: IOS_SWIPE_MOTION.completionSpring.mass,
        velocity: velocityPxPerSecond,
        restSpeed: IOS_SWIPE_MOTION.completionSpring.restSpeed,
        restDelta: IOS_SWIPE_MOTION.completionSpring.restDelta,
        onUpdate: (latest) => syncAdjacentPage(latest, width, exitSign),
        onComplete: finishHandoff,
      });
      stopAnimationRef.current = () => controls.stop();
    },
    [clearHandoffFrames, indicatorPosition, reduceMotion, stopAnimation, syncAdjacentPage, underlayX, x],
  );

  const navigateTo = useCallback(
    (targetSegment: BulletinSegment) => {
      if (targetSegment === activeSegmentRef.current || settlingRef.current) return;

      const node = surfaceRef.current;
      if (!node || !isEnabled || !isAppleTouchNavigationDevice()) {
        indicatorPosition.set(targetSegment === "all" ? 0 : 1);
        onCommitRef.current(targetSegment);
        return;
      }

      const width = getSurfaceWidth();
      const exitSign = exitSignFor(activeSegmentRef.current);
      x.set(0);
      syncAdjacentPage(0, width, exitSign);
      finishSuccessfulTransition(targetSegment, exitSign, width, 0);
    },
    [exitSignFor, finishSuccessfulTransition, getSurfaceWidth, indicatorPosition, isEnabled, syncAdjacentPage, x],
  );

  useEffect(() => {
    const node = surfaceRef.current;
    if (!node || !isEnabled || !isAppleTouchNavigationDevice()) {
      x.set(0);
      underlayX.set(0);
      indicatorPosition.set(activeSegmentRef.current === "all" ? 0 : 1);
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

      // Reserve the native Back edge for the page-level recognizer. Without
      // this explicit arbitration both the Notifications segment pager and the
      // interactive Back gesture can lock onto the same iOS touch stream,
      // producing a double transform / snap. The center of the page remains a
      // full-width All <-> Unread pager.
      const touch = event.touches[0];
      const rect = node.getBoundingClientRect();
      const backEdgeWidth = 34;
      const startsInBackEdge = isRtlRef.current
        ? touch.clientX >= rect.right - backEdgeWidth
        : touch.clientX <= rect.left + backEdgeWidth;
      if (startsInBackEdge) return;

      stopAnimation();
      clearHandoffFrames();
      x.set(0);

      const width = getSurfaceWidth();
      const exitSign = exitSignFor(activeSegmentRef.current);
      syncAdjacentPage(0, width, exitSign);

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
      const exitSign = exitSignFor(activeSegmentRef.current);
      const directionalDistance = dx * exitSign;

      if (!horizontalLockRef.current) {
        if (Math.abs(dy) >= IOS_SWIPE_MOTION.verticalRejectDistance && Math.abs(dy) > Math.abs(dx) * IOS_SWIPE_MOTION.verticalRejectRatio) {
          resetTracking();
          x.set(0);
          underlayX.set(0);
          return;
        }
        if (Math.abs(dx) < IOS_SWIPE_MOTION.axisLockDistance) return;
        if (Math.abs(dy) > Math.abs(dx) * IOS_SWIPE_MOTION.horizontalLockMaxVerticalRatio) return;
        horizontalLockRef.current = true;
        setIsInteracting(true);
      }

      if (event.cancelable) event.preventDefault();

      const now = performance.now();
      const dt = Math.max(1, now - lastTimeRef.current);
      const instantaneousVelocity = (touch.clientX - lastXRef.current) / dt;
      velocityRef.current =
        velocityRef.current * IOS_SWIPE_MOTION.velocityPreviousWeight +
        instantaneousVelocity * IOS_SWIPE_MOTION.velocityCurrentWeight;
      lastXRef.current = touch.clientX;
      lastTimeRef.current = now;

      const width = getSurfaceWidth();

      // There is exactly one neighboring page from each segment. Resist a swipe
      // in the invalid direction instead of moving the foreground and exposing a
      // raw root/background strip.
      if (directionalDistance <= 0) {
        x.set(0);
        syncAdjacentPage(0, width, exitSign);
        return;
      }

      const clamped = Math.max(-width, Math.min(width, dx));
      // MotionValues already batch directly into the compositor, so the page
      // remains locked to the finger without an extra requestAnimationFrame.
      x.set(clamped);
      syncAdjacentPage(clamped, width, exitSign);
    };

    const finishGesture = (event: TouchEvent | null, cancelled = false) => {
      if (!eligibleRef.current) return;

      const hadLock = horizontalLockRef.current;
      const clientX = event?.changedTouches?.[0]?.clientX ?? lastXRef.current;
      const dx = clientX - startXRef.current;
      const exitSign = exitSignFor(activeSegmentRef.current);
      const directionalDistance = dx * exitSign;
      const width = getSurfaceWidth();
      const releaseVelocity = velocityRef.current;
      const releaseVelocityInDirection = releaseVelocity * exitSign;
      const progress = Math.max(0, directionalDistance) / width;
      const fastFlick =
        directionalDistance >= IOS_SWIPE_MOTION.flickDistance &&
        releaseVelocityInDirection >= IOS_SWIPE_MOTION.velocityThreshold;
      const success =
        !cancelled &&
        hadLock &&
        directionalDistance > 0 &&
        (progress >= IOS_SWIPE_MOTION.commitProgress || fastFlick);

      resetTracking();
      if (!hadLock) {
        x.set(0);
        underlayX.set(0);
        indicatorPosition.set(activeSegmentRef.current === "all" ? 0 : 1);
        return;
      }

      if (success) {
        finishSuccessfulTransition(
          opposite(activeSegmentRef.current),
          exitSign,
          width,
          releaseVelocity,
        );
        return;
      }

      settlingRef.current = true;
      const finishCancel = () => {
        settlingRef.current = false;
        setIsInteracting(false);
        x.set(0);
        underlayX.set(0);
        indicatorPosition.set(activeSegmentRef.current === "all" ? 0 : 1);
      };

      if (reduceMotion) {
        const controls = animate(x, 0, {
          duration: 0.01,
          onUpdate: (latest) => syncAdjacentPage(latest, width, exitSign),
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
        onUpdate: (latest) => syncAdjacentPage(latest, width, exitSign),
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
      clearHandoffFrames();
      settlingRef.current = false;
      x.set(0);
      underlayX.set(0);
      setIsInteracting(false);
      node.removeEventListener("touchstart", handleTouchStart);
      node.removeEventListener("touchmove", handleTouchMove);
      node.removeEventListener("touchend", handleTouchEnd);
      node.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [
    clearHandoffFrames,
    exitSignFor,
    finishSuccessfulTransition,
    getSurfaceWidth,
    isEnabled,
    reduceMotion,
    stopAnimation,
    syncAdjacentPage,
    indicatorPosition,
    underlayX,
    x,
  ]);

  return { surfaceRef, x, underlayX, indicatorPosition, isInteracting, navigateTo };
}
