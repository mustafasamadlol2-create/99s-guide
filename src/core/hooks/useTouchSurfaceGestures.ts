import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { animate, useMotionValue, useReducedMotion, type MotionValue } from "motion/react";
import { flushSync } from "react-dom";
import { HapticFeedback } from "../device/haptic";
import { NativeBridge } from "../device/capacitor/nativeBridge";
import { isAppleTouchNavigationDevice } from "./useSwipeBack";
import { IOS_SWIPE_MOTION } from "../motion/swipeMotion";

const FORM_CONTROL_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable="true"]',
  '[role="slider"]',
].join(",");

interface SwipeDownDismissOptions {
  onDismiss: () => void;
  isEnabled: boolean;
  /** When set, a drag can start only from this selector (or one of its children). */
  handleSelector?: string;
  /** Extra elements that should never begin a dismiss drag. */
  blockedSelector?: string;
  commitDistance?: number;
  velocityThreshold?: number;
}

export interface SwipeDownDismissGesture<T extends HTMLElement = HTMLDivElement> {
  surfaceRef: RefObject<T | null>;
  y: MotionValue<number>;
  progress: MotionValue<number>;
  isInteracting: boolean;
}

/**
 * iPhone/iPad-only interactive downward dismissal for native-style sheets and
 * full-screen editors. The surface tracks the finger with MotionValues (no
 * React render per frame), then either completes off-screen or settles back.
 */
export function useSwipeDownDismiss<T extends HTMLElement = HTMLDivElement>({
  onDismiss,
  isEnabled,
  handleSelector,
  blockedSelector,
  commitDistance = 0,
  velocityThreshold = IOS_SWIPE_MOTION.velocityThreshold,
}: SwipeDownDismissOptions): SwipeDownDismissGesture<T> {
  const surfaceRef = useRef<T | null>(null);
  const y = useMotionValue(0);
  const progress = useMotionValue(0);
  const reduceMotion = useReducedMotion();
  const [isInteracting, setIsInteracting] = useState(false);

  const onDismissRef = useRef(onDismiss);
  const isEnabledRef = useRef(isEnabled);
  const handleSelectorRef = useRef(handleSelector);
  const blockedSelectorRef = useRef(blockedSelector);
  const commitDistanceRef = useRef(commitDistance);
  const velocityThresholdRef = useRef(velocityThreshold);

  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const lastYRef = useRef(0);
  const lastTimeRef = useRef(0);
  const velocityRef = useRef(0);
  const eligibleRef = useRef(false);
  const verticalLockRef = useRef(false);
  const settlingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const stopAnimationRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onDismissRef.current = onDismiss;
    isEnabledRef.current = isEnabled;
    handleSelectorRef.current = handleSelector;
    blockedSelectorRef.current = blockedSelector;
    commitDistanceRef.current = commitDistance;
    velocityThresholdRef.current = velocityThreshold;
  });

  useEffect(() => {
    const node = surfaceRef.current;
    if (!node || !isEnabled || !isAppleTouchNavigationDevice()) {
      y.set(0);
      progress.set(0);
      setIsInteracting(false);
      return;
    }

    const stopAnimation = () => {
      stopAnimationRef.current?.();
      stopAnimationRef.current = null;
    };

    const viewportHeight = () =>
      Math.max(1, Math.round(window.visualViewport?.height || window.innerHeight || 1));

    const resetTracking = () => {
      eligibleRef.current = false;
      verticalLockRef.current = false;
      velocityRef.current = 0;
    };

    const settleTo = (target: number, success: boolean, releaseVelocity = 0) => {
      stopAnimation();
      settlingRef.current = true;
      const height = viewportHeight();
      const finish = () => {
        if (success) {
          HapticFeedback.impact("light");
          // Match swipe-back's no-flicker commit: close the sheet synchronously
          // before WebKit gets a chance to paint the offscreen surface snapping
          // back to its resting transform.
          flushSync(() => {
            onDismissRef.current();
          });
          y.set(0);
          progress.set(0);
        }
        settlingRef.current = false;
        setIsInteracting(false);
      };
      const onUpdate = (latest: number) => {
        progress.set(Math.min(1, Math.max(0, latest) / Math.max(1, height)));
      };

      if (reduceMotion) {
        const controls = animate(y, target, { duration: 0.01, onUpdate, onComplete: finish });
        stopAnimationRef.current = () => controls.stop();
        return;
      }

      const profile = success ? IOS_SWIPE_MOTION.completionSpring : IOS_SWIPE_MOTION.cancelSpring;
      const controls = animate(y, target, {
        type: "spring",
        stiffness: profile.stiffness,
        damping: profile.damping,
        mass: profile.mass,
        velocity: Math.min(releaseVelocity * 1000, height * (success
          ? IOS_SWIPE_MOTION.completionVelocityScreensPerSecond
          : IOS_SWIPE_MOTION.cancelVelocityScreensPerSecond)),
        restSpeed: profile.restSpeed,
        restDelta: profile.restDelta,
        onUpdate,
        onComplete: finish,
      });
      stopAnimationRef.current = () => controls.stop();
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (!isEnabledRef.current || settlingRef.current || event.touches.length !== 1) return;
      const target = event.target as Element | null;
      if (!target) return;

      const requiredHandle = handleSelectorRef.current;
      if (requiredHandle && !target.closest(requiredHandle)) return;
      if (target.closest(FORM_CONTROL_SELECTOR)) return;
      if (blockedSelectorRef.current && target.closest(blockedSelectorRef.current)) return;

      // If a marked scrollable body is not at its top, vertical movement belongs
      // to that scroll view instead of the sheet dismissal gesture.
      const scrollRegion = target.closest<HTMLElement>('[data-swipe-dismiss-scroll="true"]');
      if (scrollRegion && scrollRegion.scrollTop > 1) return;

      stopAnimation();
      y.set(0);
      progress.set(0);
      const touch = event.touches[0];
      startXRef.current = touch.clientX;
      startYRef.current = touch.clientY;
      lastYRef.current = touch.clientY;
      lastTimeRef.current = performance.now();
      velocityRef.current = 0;
      eligibleRef.current = true;
      verticalLockRef.current = false;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!eligibleRef.current || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startXRef.current;
      const dy = touch.clientY - startYRef.current;

      if (!verticalLockRef.current) {
        if (
          dy < -IOS_SWIPE_MOTION.axisLockDistance ||
          (Math.abs(dx) >= IOS_SWIPE_MOTION.verticalRejectDistance &&
            Math.abs(dx) > Math.abs(dy) * IOS_SWIPE_MOTION.verticalRejectRatio)
        ) {
          resetTracking();
          return;
        }
        if (dy < IOS_SWIPE_MOTION.axisLockDistance) return;
        if (Math.abs(dx) > dy * IOS_SWIPE_MOTION.horizontalLockMaxVerticalRatio) return;
        verticalLockRef.current = true;
        setIsInteracting(true);
      }

      if (event.cancelable) event.preventDefault();

      const now = performance.now();
      const dt = Math.max(1, now - lastTimeRef.current);
      const instantaneousVelocity = Math.max(0, (touch.clientY - lastYRef.current) / dt);
      velocityRef.current =
        velocityRef.current * IOS_SWIPE_MOTION.velocityPreviousWeight +
        instantaneousVelocity * IOS_SWIPE_MOTION.velocityCurrentWeight;
      lastYRef.current = touch.clientY;
      lastTimeRef.current = now;

      const height = viewportHeight();
      const raw = Math.max(0, dy);
      // Same 1:1 tracking contract as the approved horizontal Back gesture.
      // The sheet stays directly under the finger until it reaches one viewport.
      const offset = Math.min(height, raw);

      // Match Notifications -> Profile exactly: MotionValues are written from
      // the touch packet itself, with no extra RAF of latency behind the finger.
      y.set(offset);
      progress.set(Math.min(1, offset / Math.max(1, height)));
    };

    const finishGesture = (event: TouchEvent | null, cancelled = false) => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (!eligibleRef.current) return;

      const hadLock = verticalLockRef.current;
      const clientY = event?.changedTouches?.[0]?.clientY ?? lastYRef.current;
      const distance = Math.max(0, clientY - startYRef.current);
      const height = viewportHeight();
      const commitDistancePx =
        commitDistanceRef.current > 0
          ? commitDistanceRef.current
          : height * IOS_SWIPE_MOTION.commitProgress;
      const releaseVelocity = velocityRef.current;
      const fastFlick =
        distance >= IOS_SWIPE_MOTION.flickDistance &&
        releaseVelocity >= velocityThresholdRef.current;
      const success =
        !cancelled && hadLock && (distance >= commitDistancePx || fastFlick);

      resetTracking();
      if (!hadLock) {
        y.set(0);
        progress.set(0);
        return;
      }

      settleTo(success ? viewportHeight() : 0, success, releaseVelocity);
    };

    const handleTouchEnd = (event: TouchEvent) => finishGesture(event, false);
    const handleTouchCancel = (event: TouchEvent) => finishGesture(event, true);

    node.addEventListener("touchstart", handleTouchStart, { passive: true });
    node.addEventListener("touchmove", handleTouchMove, { passive: false });
    node.addEventListener("touchend", handleTouchEnd, { passive: true });
    node.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      stopAnimation();
      resetTracking();
      settlingRef.current = false;
      y.set(0);
      progress.set(0);
      node.removeEventListener("touchstart", handleTouchStart);
      node.removeEventListener("touchmove", handleTouchMove);
      node.removeEventListener("touchend", handleTouchEnd);
      node.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [isEnabled, progress, reduceMotion, y]);

  return { surfaceRef, y, progress, isInteracting };
}

interface HorizontalSwipePagerOptions {
  onNext: () => void;
  onPrevious: () => void;
  canNext: boolean;
  canPrevious: boolean;
  isEnabled: boolean;
  isRtl?: boolean;
  /** Controls that must retain their normal click/touch behavior. */
  blockedSelector?: string;
  /** Keep a legacy edge reservation for pages where Back still owns the edge. */
  reserveBackEdge?: boolean;
  commitDistance?: number;
  velocityThreshold?: number;
  /**
   * `shared` preserves the app-wide horizontal pager choreography.
   * `instant` is a single-stage compact content transition used by Lecture tabs.
   */
  completionMode?: "shared" | "instant";
  /** Fraction of finger travel rendered by instant content pagers. */
  visualScale?: number;
}

export interface HorizontalSwipePagerGesture<T extends HTMLElement = HTMLDivElement> {
  surfaceRef: RefObject<T | null>;
  x: MotionValue<number>;
  isInteracting: boolean;
  didDragRecently: () => boolean;
}

/**
 * iPhone/iPad-only interactive horizontal pager. By default it preserves the
 * legacy Back edge, while dedicated surfaces (such as Lecture Detail) can opt
 * into the entire width when page-level Back is intentionally disabled.
 */
export function useHorizontalSwipePager<T extends HTMLElement = HTMLDivElement>({
  onNext,
  onPrevious,
  canNext,
  canPrevious,
  isEnabled,
  isRtl = false,
  blockedSelector,
  reserveBackEdge = true,
  commitDistance = 0,
  velocityThreshold = IOS_SWIPE_MOTION.velocityThreshold,
  completionMode = "shared",
  visualScale = 0.28,
}: HorizontalSwipePagerOptions): HorizontalSwipePagerGesture<T> {
  const surfaceRef = useRef<T | null>(null);
  const x = useMotionValue(0);
  const reduceMotion = useReducedMotion();
  const [isInteracting, setIsInteracting] = useState(false);

  const onNextRef = useRef(onNext);
  const onPreviousRef = useRef(onPrevious);
  const canNextRef = useRef(canNext);
  const canPreviousRef = useRef(canPrevious);
  const enabledRef = useRef(isEnabled);
  const isRtlRef = useRef(isRtl);
  const blockedSelectorRef = useRef(blockedSelector);
  const reserveBackEdgeRef = useRef(reserveBackEdge);
  const commitDistanceRef = useRef(commitDistance);
  const velocityThresholdRef = useRef(velocityThreshold);
  const completionModeRef = useRef(completionMode);
  const visualScaleRef = useRef(Math.max(0.16, Math.min(0.5, visualScale)));

  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const lastXRef = useRef(0);
  const lastTimeRef = useRef(0);
  const velocityRef = useRef(0);
  const eligibleRef = useRef(false);
  const horizontalLockRef = useRef(false);
  const settlingRef = useRef(false);
  const lastDragAtRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const stopAnimationRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onNextRef.current = onNext;
    onPreviousRef.current = onPrevious;
    canNextRef.current = canNext;
    canPreviousRef.current = canPrevious;
    enabledRef.current = isEnabled;
    isRtlRef.current = isRtl;
    blockedSelectorRef.current = blockedSelector;
    reserveBackEdgeRef.current = reserveBackEdge;
    commitDistanceRef.current = commitDistance;
    velocityThresholdRef.current = velocityThreshold;
    completionModeRef.current = completionMode;
    visualScaleRef.current = Math.max(0.16, Math.min(0.5, visualScale));
  });

  const didDragRecently = useCallback(() => performance.now() - lastDragAtRef.current < 360, []);

  useEffect(() => {
    const node = surfaceRef.current;
    if (!node || !isEnabled || !isAppleTouchNavigationDevice()) {
      x.set(0);
      setIsInteracting(false);
      return;
    }

    // Lets the app-wide Back recognizer yield immediately to explicit content
    // pagers (calendar and lecture-section paging).
    const previousPagerMarker = node.getAttribute("data-horizontal-pager");
    node.setAttribute("data-horizontal-pager", "true");

    const stopAnimation = () => {
      stopAnimationRef.current?.();
      stopAnimationRef.current = null;
    };

    const resetTracking = () => {
      eligibleRef.current = false;
      horizontalLockRef.current = false;
      velocityRef.current = 0;
    };

    const logicalRequest = (dx: number) => {
      const wantsNext = isRtlRef.current ? dx > 0 : dx < 0;
      return {
        wantsNext,
        allowed: wantsNext ? canNextRef.current : canPreviousRef.current,
      };
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (!enabledRef.current || settlingRef.current || event.touches.length !== 1) return;
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest(FORM_CONTROL_SELECTOR)) return;
      if (blockedSelectorRef.current && target.closest(blockedSelectorRef.current)) return;

      const touch = event.touches[0];
      const width = Math.max(1, window.visualViewport?.width || window.innerWidth || 1);
      const region = document.querySelector<HTMLElement>('[data-swipe-back-region="true"]');
      const rect = region?.getBoundingClientRect();
      const leftEdge = rect?.left ?? 0;
      const rightEdge = rect?.right ?? width;
      const backEdgeWidth = 36;
      const startsInBackEdge = isRtlRef.current
        ? touch.clientX >= rightEdge - backEdgeWidth
        : touch.clientX <= leftEdge + backEdgeWidth;
      if (reserveBackEdgeRef.current && startsInBackEdge) return;

      stopAnimation();
      x.set(0);
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
        horizontalLockRef.current = true;
        lastDragAtRef.current = performance.now();
        setIsInteracting(true);
      }

      if (event.cancelable) event.preventDefault();
      lastDragAtRef.current = performance.now();

      const now = performance.now();
      const dt = Math.max(1, now - lastTimeRef.current);
      const instantaneousVelocity = Math.abs(touch.clientX - lastXRef.current) / dt;
      velocityRef.current =
        velocityRef.current * IOS_SWIPE_MOTION.velocityPreviousWeight +
        instantaneousVelocity * IOS_SWIPE_MOTION.velocityCurrentWeight;
      lastXRef.current = touch.clientX;
      lastTimeRef.current = now;

      const { allowed } = logicalRequest(dx);
      const width = Math.max(1, node.getBoundingClientRect().width || window.innerWidth || 1);

      const renderedDx = (() => {
        if (!allowed) return dx * IOS_SWIPE_MOTION.boundaryResistance;

        if (completionModeRef.current === "instant") {
          // One-stage iOS segmented workspace: show only a small amount of the
          // finger travel. There is never a full-width outgoing sweep, so the
          // opaque lecture card can never expose an empty white/black page.
          const maxTravel = Math.max(28, Math.min(56, width * 0.16));
          return Math.max(
            -maxTravel,
            Math.min(maxTravel, dx * visualScaleRef.current),
          );
        }

        // Shared pagers keep the existing compact native tracking contract.
        const nativeTravel = IOS_SWIPE_MOTION.underlayOffset * 2;
        const rawDistance = Math.abs(dx);
        const compactDistance = rawDistance <= nativeTravel
          ? rawDistance
          : nativeTravel + (rawDistance - nativeTravel) * IOS_SWIPE_MOTION.boundaryResistance;
        return Math.sign(dx || 1) * Math.min(width, compactDistance);
      })();

      x.set(Math.max(-width, Math.min(width, renderedDx)));
    };

    const finishGesture = (event: TouchEvent | null, cancelled = false) => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (!eligibleRef.current) return;

      const hadLock = horizontalLockRef.current;
      const clientX = event?.changedTouches?.[0]?.clientX ?? lastXRef.current;
      const dx = clientX - startXRef.current;
      const request = logicalRequest(dx);
      const releaseVelocity = velocityRef.current;
      const width = Math.max(1, node.getBoundingClientRect().width || window.innerWidth || 1);
      const commitDistancePx =
        commitDistanceRef.current > 0
          ? commitDistanceRef.current
          : width * IOS_SWIPE_MOTION.commitProgress;
      const fastFlick =
        Math.abs(dx) >= IOS_SWIPE_MOTION.flickDistance &&
        releaseVelocity >= velocityThresholdRef.current;
      const success =
        !cancelled &&
        hadLock &&
        request.allowed &&
        (Math.abs(dx) >= commitDistancePx || fastFlick);

      resetTracking();
      if (!hadLock) {
        x.set(0);
        return;
      }

      stopAnimation();
      settlingRef.current = true;
      lastDragAtRef.current = performance.now();

      const physicalSign = dx < 0 ? -1 : 1;
      const signedVelocity =
        physicalSign * Math.min(releaseVelocity * 1000, width * (success
          ? IOS_SWIPE_MOTION.completionVelocityScreensPerSecond
          : IOS_SWIPE_MOTION.cancelVelocityScreensPerSecond));

      if (!success) {
        const finishCancel = () => {
          settlingRef.current = false;
          setIsInteracting(false);
        };
        const controls = reduceMotion
          ? animate(x, 0, { duration: 0.01, onComplete: finishCancel })
          : animate(x, 0, {
              type: "spring",
              stiffness: IOS_SWIPE_MOTION.cancelSpring.stiffness,
              damping: IOS_SWIPE_MOTION.cancelSpring.damping,
              mass: IOS_SWIPE_MOTION.cancelSpring.mass,
              velocity: signedVelocity,
              restSpeed: IOS_SWIPE_MOTION.cancelSpring.restSpeed,
              restDelta: IOS_SWIPE_MOTION.cancelSpring.restDelta,
              onComplete: finishCancel,
            });
        stopAnimationRef.current = () => controls.stop();
        return;
      }

      const commitDestination = () => {
        if (request.wantsNext) onNextRef.current();
        else onPreviousRef.current();
        HapticFeedback.selection();
      };

      if (completionModeRef.current === "instant") {
        // No outgoing phase and no wait. Commit the destination immediately,
        // then let the incoming page settle from the same short native offset.
        // Because the opaque workspace shell never unmounts, this produces a
        // continuous one-stage transition with no blank frame.
        flushSync(() => {
          commitDestination();
        });
        x.set(-physicalSign * IOS_SWIPE_MOTION.underlayOffset);

        const finishInstant = () => {
          x.set(0);
          settlingRef.current = false;
          setIsInteracting(false);
        };
        const instantControls = reduceMotion
          ? animate(x, 0, { duration: 0.01, onComplete: finishInstant })
          : animate(x, 0, {
              type: "spring",
              stiffness: IOS_SWIPE_MOTION.completionSpring.stiffness,
              damping: IOS_SWIPE_MOTION.completionSpring.damping,
              mass: IOS_SWIPE_MOTION.completionSpring.mass,
              velocity: Math.max(
                -width * IOS_SWIPE_MOTION.cancelVelocityScreensPerSecond,
                Math.min(
                  width * IOS_SWIPE_MOTION.cancelVelocityScreensPerSecond,
                  -signedVelocity * 0.18,
                ),
              ),
              restSpeed: IOS_SWIPE_MOTION.completionSpring.restSpeed,
              restDelta: IOS_SWIPE_MOTION.completionSpring.restDelta,
              onComplete: finishInstant,
            });
        stopAnimationRef.current = () => instantControls.stop();
        return;
      }

      // iOS segmented-content handoff: the outgoing content only travels a
      // compact native distance; the destination is committed synchronously
      // while the opaque card shell remains mounted, then the incoming content
      // settles from the opposite 22 px underlay offset. There is no full-width
      // blank sweep and no second animation language.
      const outgoingTarget = physicalSign * IOS_SWIPE_MOTION.underlayOffset * 2;
      const finishOutgoing = () => {
        flushSync(() => {
          commitDestination();
        });
        x.set(-physicalSign * IOS_SWIPE_MOTION.underlayOffset);

        const finishIncoming = () => {
          x.set(0);
          settlingRef.current = false;
          setIsInteracting(false);
        };
        const entrance = reduceMotion
          ? animate(x, 0, { duration: 0.01, onComplete: finishIncoming })
          : animate(x, 0, {
              ...IOS_SWIPE_MOTION.completionSpring,
              onComplete: finishIncoming,
            });
        stopAnimationRef.current = () => entrance.stop();
      };

      const controls = reduceMotion
        ? animate(x, outgoingTarget, { duration: 0.01, onComplete: finishOutgoing })
        : animate(x, outgoingTarget, {
            type: "spring",
            stiffness: IOS_SWIPE_MOTION.completionSpring.stiffness,
            damping: IOS_SWIPE_MOTION.completionSpring.damping,
            mass: IOS_SWIPE_MOTION.completionSpring.mass,
            velocity: signedVelocity,
            restSpeed: IOS_SWIPE_MOTION.completionSpring.restSpeed,
            restDelta: IOS_SWIPE_MOTION.completionSpring.restDelta,
            onComplete: finishOutgoing,
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
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      stopAnimation();
      resetTracking();
      settlingRef.current = false;
      x.set(0);
      node.removeEventListener("touchstart", handleTouchStart);
      node.removeEventListener("touchmove", handleTouchMove);
      node.removeEventListener("touchend", handleTouchEnd);
      node.removeEventListener("touchcancel", handleTouchCancel);
      if (previousPagerMarker === null) node.removeAttribute("data-horizontal-pager");
      else node.setAttribute("data-horizontal-pager", previousPagerMarker);
    };
  }, [isEnabled, reduceMotion, x]);

  return { surfaceRef, x, isInteracting, didDragRecently };
}


interface IOSKeyboardDragDismissOptions {
  isEnabled?: boolean;
  /** Finger travel before a downward scroll gesture dismisses the keyboard. */
  threshold?: number;
}

const KEYBOARD_EDITABLE_SELECTOR = [
  'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"])',
  "textarea",
  '[contenteditable="true"]',
].join(",");

/**
 * iPhone/iPad-only keyboard dismissal that follows the user's normal scroll
 * intent. When a text control owns focus and a downward drag begins outside
 * that control, we hand dismissal to Capacitor's native Keyboard plugin. The
 * page itself remains fully scrollable; this hook never preventDefault()s.
 *
 * It deliberately ignores drags that start inside the active editor so text
 * selection, caret movement and textarea scrolling retain native behavior.
 */
export function useIOSKeyboardDragDismiss({
  isEnabled = true,
  threshold = 16,
}: IOSKeyboardDragDismissOptions = {}): void {
  const enabledRef = useRef(isEnabled);
  const thresholdRef = useRef(threshold);

  useEffect(() => {
    enabledRef.current = isEnabled;
    thresholdRef.current = threshold;
  }, [isEnabled, threshold]);

  useEffect(() => {
    if (!isEnabled || !isAppleTouchNavigationDevice()) return;

    let eligible = false;
    let startX = 0;
    let startY = 0;
    let activeEditor: HTMLElement | null = null;

    const reset = () => {
      eligible = false;
      activeEditor = null;
    };

    const resolveActiveEditor = (): HTMLElement | null => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return null;
      return active.matches(KEYBOARD_EDITABLE_SELECTOR) ? active : null;
    };

    const onTouchStart = (event: TouchEvent) => {
      reset();
      if (!enabledRef.current || event.touches.length !== 1) return;

      const editor = resolveActiveEditor();
      if (!editor) return;

      const target = event.target as Element | null;
      if (!target) return;
      if (target === editor || editor.contains(target)) return;
      if (target.closest(KEYBOARD_EDITABLE_SELECTOR)) return;
      if (target.closest('[data-keyboard-dismiss-disabled="true"]')) return;

      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      activeEditor = editor;
      eligible = true;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!eligible || !activeEditor || event.touches.length !== 1) return;

      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      // A strong horizontal gesture belongs to navigation/pagers, not the
      // keyboard. Upward scrolling also keeps the keyboard visible.
      if (dy < -10 || (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 0.9)) {
        reset();
        return;
      }

      if (dy < thresholdRef.current || dy < Math.abs(dx) * 1.08) return;

      const editor = activeEditor;
      reset();

      // Blur synchronously so WebKit releases the caret immediately; the
      // native bridge then performs the platform keyboard's own slide-down.
      editor.blur();
      void NativeBridge.hideKeyboard();
    };

    document.addEventListener("touchstart", onTouchStart, {
      passive: true,
      capture: true,
    });
    document.addEventListener("touchmove", onTouchMove, {
      passive: true,
      capture: true,
    });
    document.addEventListener("touchend", reset, {
      passive: true,
      capture: true,
    });
    document.addEventListener("touchcancel", reset, {
      passive: true,
      capture: true,
    });

    return () => {
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("touchend", reset, true);
      document.removeEventListener("touchcancel", reset, true);
    };
  }, [isEnabled]);
}
