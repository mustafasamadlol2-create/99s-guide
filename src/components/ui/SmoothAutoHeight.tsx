import React, { useLayoutEffect, useRef, useState } from "react";

interface SmoothAutoHeightProps {
  children: React.ReactNode;
  dependency?: unknown;
  className?: string;
  contentClassName?: string;
  style?: React.CSSProperties;
  durationMs?: number;
  transitionEasing?: string;
  minMeasuredHeight?: number;
  includeOverflowInMeasurement?: boolean;
  /**
   * After a measured resize transition finishes, release the explicit height
   * back to `auto`. This is useful for content that can keep changing after the
   * tab transition (for example flashcard answers, images, async lists, etc.).
   * The next dependency change still animates from the last stable height.
   */
  settleToAuto?: boolean;
  /**
   * For tab switches: animate to one measured target only, then release to auto.
   * ResizeObserver changes during the short transition are ignored so complex
   * panels (MCQ/flashcards) cannot stretch the animation into a slow chain.
   */
  singlePassOnDependencyChange?: boolean;
  /**
   * Opt-in for tab/card swaps where the incoming panel is mounted immediately.
   * The shell is pinned to the previous stable intrinsic height before paint,
   * then animated to the newly measured panel height. Other callers retain the
   * original measurement behavior.
   */
  usePreviousStableHeightOnDependencyChange?: boolean;
}

/**
 * Animates only the container height while its content swaps/resizes.
 * The content itself remains natural-flow content, so this does not scale,
 * blur, or distort the UI during the transition.
 */
export function SmoothAutoHeight({
  children,
  dependency,
  className = "",
  contentClassName = "",
  style,
  durationMs = 380,
  transitionEasing = "cubic-bezier(0.23, 1, 0.32, 1)",
  minMeasuredHeight = 24,
  includeOverflowInMeasurement = false,
  settleToAuto = false,
  singlePassOnDependencyChange = false,
  usePreviousStableHeightOnDependencyChange = false,
}: SmoothAutoHeightProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [hasMeasured, setHasMeasured] = useState(false);
  const reducedMotionRef = useRef(false);

  const previousDependencyRef = useRef(dependency);
  const lastStableHeightRef = useRef<number | null>(null);
  const isAnimatingRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    reducedMotionRef.current = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  }, []);

  useLayoutEffect(() => {
    const node = contentRef.current;
    const shell = shellRef.current;
    if (!node || !shell) return;

    let measureFrame = 0;
    let settleTimer: number | null = null;
    let transitionFrame: number | null = null;
    let secondTransitionFrame: number | null = null;
    let dependencyChanged = previousDependencyRef.current !== dependency;
    previousDependencyRef.current = dependency;

    const clearTimers = () => {
      cancelAnimationFrame(measureFrame);
      if (transitionFrame != null) cancelAnimationFrame(transitionFrame);
      if (secondTransitionFrame != null) cancelAnimationFrame(secondTransitionFrame);
      if (settleTimer != null) window.clearTimeout(settleTimer);
    };

    const readIntrinsicHeight = () => {
      const rectHeight = node.getBoundingClientRect().height;
      const measured = includeOverflowInMeasurement
        ? Math.max(rectHeight, node.scrollHeight)
        : rectHeight;
      return Math.ceil(measured);
    };

    const commitStable = (measured: number) => {
      if (measured < minMeasuredHeight) return;
      lastStableHeightRef.current = measured;
      setHasMeasured(true);
    };

    const releaseToAuto = () => {
      isAnimatingRef.current = false;
      setHeight(null);
      requestAnimationFrame(() => {
        const finalHeight = readIntrinsicHeight();
        if (finalHeight >= minMeasuredHeight) lastStableHeightRef.current = finalHeight;
      });
    };

    const animateOnceTo = (targetHeight: number) => {
      if (targetHeight < minMeasuredHeight) return;
      const currentHeight = Math.ceil(shell.getBoundingClientRect().height);

      if (reducedMotionRef.current || Math.abs(targetHeight - currentHeight) <= 1) {
        commitStable(targetHeight);
        setHeight(settleToAuto ? null : targetHeight);
        return;
      }

      isAnimatingRef.current = true;
      setHasMeasured(true);
      setHeight(currentHeight);
      void shell.offsetHeight;

      transitionFrame = requestAnimationFrame(() => {
        secondTransitionFrame = requestAnimationFrame(() => {
          setHeight(targetHeight);
          lastStableHeightRef.current = targetHeight;
          if (settleToAuto) {
            settleTimer = window.setTimeout(releaseToAuto, durationMs + 20);
          }
        });
      });
    };

    const animateFromPreviousStableHeight = (targetHeight: number) => {
      if (targetHeight < minMeasuredHeight) return;
      const previousHeight = lastStableHeightRef.current;
      if (previousHeight == null) {
        animateOnceTo(targetHeight);
        return;
      }

      if (reducedMotionRef.current || Math.abs(targetHeight - previousHeight) <= 1) {
        commitStable(targetHeight);
        setHeight(settleToAuto ? null : targetHeight);
        return;
      }

      isAnimatingRef.current = true;
      setHasMeasured(true);

      // useLayoutEffect runs before paint, so restoring the previous intrinsic
      // height here prevents the incoming panel from flashing at its final size.
      setHeight(previousHeight);

      transitionFrame = requestAnimationFrame(() => {
        secondTransitionFrame = requestAnimationFrame(() => {
          setHeight(targetHeight);
          lastStableHeightRef.current = targetHeight;
          if (settleToAuto) {
            settleTimer = window.setTimeout(releaseToAuto, durationMs + 20);
          }
        });
      });
    };

    const measureAfterPaint = (animate: boolean) => {
      cancelAnimationFrame(measureFrame);
      measureFrame = requestAnimationFrame(() => {
        const measured = readIntrinsicHeight();
        if (measured < minMeasuredHeight) return;
        if (animate) animateOnceTo(measured);
        else {
          commitStable(measured);
          if (!settleToAuto) setHeight(measured);
        }
      });
    };

    if (lastStableHeightRef.current == null) {
      const initial = readIntrinsicHeight();
      if (initial >= minMeasuredHeight) {
        commitStable(initial);
        if (!settleToAuto) setHeight(initial);
      }
    } else if (dependencyChanged) {
      // Lecture-style card swaps can measure the already-mounted incoming panel
      // immediately and animate from the cached previous height before paint.
      // Other users (for example Calendar) retain the original post-paint path.
      if (usePreviousStableHeightOnDependencyChange) {
        animateFromPreviousStableHeight(readIntrinsicHeight());
      } else {
        measureAfterPaint(true);
      }
    } else {
      measureAfterPaint(false);
    }

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            const measured = readIntrinsicHeight();
            if (measured < minMeasuredHeight) return;

            if (singlePassOnDependencyChange && isAnimatingRef.current) {
              // Ignore intermediate child-by-child MCQ/Anki layout changes during
              // the short tab transition. Once released to auto, natural flow
              // handles any remaining async growth instantly and correctly.
              return;
            }

            commitStable(measured);
            if (!settleToAuto) setHeight(measured);
          })
        : null;

    resizeObserver?.observe(node);

    // If an image finishes later, natural auto height handles it after the
    // transition. We only cache the resulting stable height for the next swap.
    const images = Array.from(node.querySelectorAll("img"));
    const onAssetLoad = () => {
      if (isAnimatingRef.current && singlePassOnDependencyChange) return;
      const measured = readIntrinsicHeight();
      if (measured >= minMeasuredHeight) commitStable(measured);
    };
    images.forEach((image) => {
      if (!image.complete) image.addEventListener("load", onAssetLoad, { once: true });
    });

    return () => {
      clearTimers();
      resizeObserver?.disconnect();
      images.forEach((image) => image.removeEventListener("load", onAssetLoad));
    };
  }, [
    dependency,
    durationMs,
    includeOverflowInMeasurement,
    minMeasuredHeight,
    settleToAuto,
    singlePassOnDependencyChange,
    usePreviousStableHeightOnDependencyChange,
  ]);

  return (
    <div
      ref={shellRef}
      className={className}
      style={{
        ...style,
        height: height == null ? undefined : `${height}px`,
        transition:
          hasMeasured && !reducedMotionRef.current
            ? `height ${durationMs}ms ${transitionEasing}`
            : undefined,
      }}
    >
      <div ref={contentRef} className={contentClassName}>
        {children}
      </div>
    </div>
  );
}
