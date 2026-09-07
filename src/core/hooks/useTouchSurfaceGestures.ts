import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { animate, useMotionValue, useReducedMotion, type MotionValue } from "motion/react";
import { HapticFeedback } from "../device/haptic";
import { NativeBridge } from "../device/capacitor/nativeBridge";
import { isAppleTouchNavigationDevice } from "./useSwipeBack";

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
  commitDistance = 112,
  velocityThreshold = 0.62,
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

    const settleTo = (target: number, success: boolean) => {
      stopAnimation();
      settlingRef.current = true;
      const height = viewportHeight();
      const distanceRemaining = Math.abs(target - y.get());
      const normalized = Math.min(1, distanceRemaining / height);
      const duration = reduceMotion
        ? 0.01
        : success
          ? Math.max(0.12, 0.2 * normalized)
          : Math.max(0.14, 0.24 * normalized);

      const controls = animate(y, target, {
        duration,
        ease: [0.22, 1, 0.36, 1],
        onUpdate: (latest) => {
          progress.set(Math.min(1, Math.max(0, latest) / Math.max(1, height * 0.42)));
        },
        onComplete: () => {
          settlingRef.current = false;
          if (success) {
            HapticFeedback.impact("light");
            onDismissRef.current();
            y.set(0);
            progress.set(0);
          }
          setIsInteracting(false);
        },
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
        if (dy < -8 || (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 0.9)) {
          resetTracking();
          return;
        }
        if (dy < 7) return;
        if (Math.abs(dx) > dy * 0.72) return;
        verticalLockRef.current = true;
        setIsInteracting(true);
      }

      if (event.cancelable) event.preventDefault();

      const now = performance.now();
      const dt = Math.max(1, now - lastTimeRef.current);
      const instantaneousVelocity = Math.max(0, (touch.clientY - lastYRef.current) / dt);
      velocityRef.current = velocityRef.current * 0.68 + instantaneousVelocity * 0.32;
      lastYRef.current = touch.clientY;
      lastTimeRef.current = now;

      const height = viewportHeight();
      const raw = Math.max(0, dy);
      // Slight resistance after the first half of the viewport keeps the sheet
      // connected to the finger without allowing it to shoot too far away.
      const softLimit = height * 0.56;
      const offset = raw <= softLimit ? raw : softLimit + (raw - softLimit) * 0.28;

      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        y.set(offset);
        progress.set(Math.min(1, offset / Math.max(1, height * 0.42)));
      });
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
      const fastFlick = distance >= 34 && velocityRef.current >= velocityThresholdRef.current;
      const success =
        !cancelled && hadLock && (distance >= commitDistanceRef.current || fastFlick);

      resetTracking();
      if (!hadLock) {
        y.set(0);
        progress.set(0);
        return;
      }

      settleTo(success ? viewportHeight() + 36 : 0, success);
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
   * "page" keeps the original full page-style exit/enter choreography.
   * "settle" commits the destination immediately and settles the shared
   * surface back to rest so content + segmented indicator move together.
   */
  completionMode?: "page" | "settle";
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
  commitDistance = 78,
  velocityThreshold = 0.58,
  completionMode = "page",
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
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) * 0.78) {
          resetTracking();
          return;
        }
        if (Math.abs(dx) < 7) return;
        if (Math.abs(dy) > Math.abs(dx) * 0.62) return;
        horizontalLockRef.current = true;
        lastDragAtRef.current = performance.now();
        setIsInteracting(true);
      }

      if (event.cancelable) event.preventDefault();
      lastDragAtRef.current = performance.now();

      const now = performance.now();
      const dt = Math.max(1, now - lastTimeRef.current);
      const instantaneousVelocity = Math.abs(touch.clientX - lastXRef.current) / dt;
      velocityRef.current = velocityRef.current * 0.68 + instantaneousVelocity * 0.32;
      lastXRef.current = touch.clientX;
      lastTimeRef.current = now;

      const { allowed } = logicalRequest(dx);
      // Native-style rubber band at the first/last item rather than a hard stop.
      const renderedDx = allowed ? dx : dx * 0.12;
      const width = Math.max(1, node.getBoundingClientRect().width || window.innerWidth || 1);
      const clamped = Math.max(-width, Math.min(width, renderedDx));

      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        x.set(clamped);
      });
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
      const fastFlick = Math.abs(dx) >= 30 && releaseVelocity >= velocityThresholdRef.current;
      const success =
        !cancelled &&
        hadLock &&
        request.allowed &&
        (Math.abs(dx) >= commitDistanceRef.current || fastFlick);

      resetTracking();
      if (!hadLock) {
        x.set(0);
        return;
      }

      stopAnimation();
      settlingRef.current = true;
      lastDragAtRef.current = performance.now();

      if (!success) {
        const controls = reduceMotion
          ? animate(x, 0, {
              duration: 0.01,
              onComplete: () => {
                settlingRef.current = false;
                setIsInteracting(false);
              },
            })
          : animate(x, 0, {
              type: "spring",
              stiffness: 470,
              damping: 42,
              mass: 0.78,
              restSpeed: 10,
              restDelta: 0.5,
              onComplete: () => {
                settlingRef.current = false;
                setIsInteracting(false);
              },
            });
        stopAnimationRef.current = () => controls.stop();
        return;
      }

      if (completionModeRef.current === "settle") {
        // Lecture-style content navigation: commit the new section once, then
        // let React paint that destination before the shared drag MotionValue
        // settles home. Starting the settle on the next animation frame keeps
        // the segmented indicator, panel crossfade and finger-release motion on
        // the same visual clock instead of letting the drag layer get one frame
        // ahead of the tab indicator in WKWebView.
        if (request.wantsNext) onNextRef.current();
        else onPreviousRef.current();

        const settleDuration = reduceMotion ? 0.01 : 0.24;

        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          const controls = animate(x, 0, {
            duration: settleDuration,
            ease: [0.32, 0.72, 0, 1],
            onComplete: () => {
              settlingRef.current = false;
              setIsInteracting(false);
              HapticFeedback.selection();
            },
          });
          stopAnimationRef.current = () => controls.stop();
        });
        return;
      }

      const width = Math.max(1, node.getBoundingClientRect().width || window.innerWidth || 1);
      const exitTarget = dx < 0 ? -width : width;
      const distanceRemaining = Math.abs(exitTarget - x.get());
      const pxPerSecond = Math.max(width * 3.1, releaseVelocity * 1000);
      const exitDuration = reduceMotion
        ? 0.01
        : Math.max(0.14, Math.min(0.24, distanceRemaining / Math.max(1, pxPerSecond)));

      const controls = animate(x, exitTarget, {
        duration: exitDuration,
        ease: [0.32, 0.72, 0, 1],
        onComplete: () => {
          if (request.wantsNext) onNextRef.current();
          else onPreviousRef.current();

          const entranceOffset = -Math.sign(exitTarget) * Math.min(46, width * 0.11);

          // Give React/WebKit two paint opportunities to commit the new panel
          // while the old panel is still at the (mostly faded) exit position.
          // This prevents a one-frame flash of the outgoing content when the
          // MotionValue is moved back to the entrance position.
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = requestAnimationFrame(() => {
              rafRef.current = null;
              x.set(entranceOffset);

              const finishEntrance = () => {
                settlingRef.current = false;
                setIsInteracting(false);
                HapticFeedback.selection();
              };

              const entrance = reduceMotion
                ? animate(x, 0, { duration: 0.01, onComplete: finishEntrance })
                : animate(x, 0, {
                    type: "spring",
                    stiffness: 455,
                    damping: 40,
                    mass: 0.8,
                    restSpeed: 9,
                    restDelta: 0.45,
                    onComplete: finishEntrance,
                  });
              stopAnimationRef.current = () => entrance.stop();
            });
          });
        },
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
