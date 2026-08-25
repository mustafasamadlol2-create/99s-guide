import React, { useLayoutEffect, useRef, useState } from "react";

interface SmoothAutoHeightProps {
  children: React.ReactNode;
  dependency?: unknown;
  className?: string;
  contentClassName?: string;
  style?: React.CSSProperties;
  durationMs?: number;
  minMeasuredHeight?: number;
  includeOverflowInMeasurement?: boolean;
  /**
   * After a measured resize transition finishes, release the explicit height
   * back to `auto`. This is useful for content that can keep changing after the
   * tab transition (for example flashcard answers, images, async lists, etc.).
   * The next dependency change still animates from the last stable height.
   */
  settleToAuto?: boolean;
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
  minMeasuredHeight = 24,
  includeOverflowInMeasurement = false,
  settleToAuto = false,
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

    const clearSettleTimer = () => {
      if (settleTimerRef.current != null) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
    };

    const readIntrinsicHeight = () => {
      const rectHeight = node.getBoundingClientRect().height;
      const measured = includeOverflowInMeasurement
        ? Math.max(rectHeight, node.scrollHeight)
        : rectHeight;
      return Math.ceil(measured);
    };

    const rememberStableHeight = () => {
      const measured = readIntrinsicHeight();
      if (measured >= minMeasuredHeight) {
        lastStableHeightRef.current = measured;
      }
    };

    const settleHeightToAuto = () => {
      if (!settleToAuto) return;
      clearSettleTimer();
      settleTimerRef.current = window.setTimeout(() => {
        isAnimatingRef.current = false;
        setHeight(null);
        requestAnimationFrame(rememberStableHeight);
      }, durationMs + 80);
    };

    const animateTo = (targetHeight: number) => {
      if (targetHeight < minMeasuredHeight) return;

      if (reducedMotionRef.current) {
        lastStableHeightRef.current = targetHeight;
        setHeight(settleToAuto ? null : targetHeight);
        setHasMeasured(true);
        return;
      }

      if (!settleToAuto) {
        setHeight((previous) => (previous === targetHeight ? previous : targetHeight));
        lastStableHeightRef.current = targetHeight;
        setHasMeasured(true);
        return;
      }

      const currentShellHeight = Math.ceil(shell.getBoundingClientRect().height);
      const fromHeight = isAnimatingRef.current
        ? currentShellHeight
        : lastStableHeightRef.current && lastStableHeightRef.current >= minMeasuredHeight
          ? lastStableHeightRef.current
          : currentShellHeight;

      isAnimatingRef.current = true;
      setHasMeasured(true);
      setHeight(fromHeight);

      // Force the starting height to be committed before moving to the target.
      void shell.offsetHeight;

      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => {
          setHeight(targetHeight);
          lastStableHeightRef.current = targetHeight;
          settleHeightToAuto();
        });
      });
    };

    const dependencyChanged = previousDependencyRef.current !== dependency;
    previousDependencyRef.current = dependency;
    let dependencyTransitionPending = dependencyChanged;

    const measure = () => {
      cancelAnimationFrame(measureFrame);
      measureFrame = requestAnimationFrame(() => {
        const nextHeight = readIntrinsicHeight();
        if (nextHeight < minMeasuredHeight) return;

        if (settleToAuto) {
          if (dependencyTransitionPending || isAnimatingRef.current) {
            dependencyTransitionPending = false;
            animateTo(nextHeight);
          } else {
            // While settled at auto, let normal document flow handle live
            // changes. We only remember the true size for the next tab swap.
            lastStableHeightRef.current = nextHeight;
            setHeight(null);
            setHasMeasured(true);
          }
          return;
        }

        animateTo(nextHeight);
      });
    };

    // Initial measure. For settleToAuto consumers we keep natural flow on the
    // first paint; subsequent dependency changes animate between true heights.
    if (lastStableHeightRef.current == null) {
      const initialHeight = readIntrinsicHeight();
      if (initialHeight >= minMeasuredHeight) {
        lastStableHeightRef.current = initialHeight;
        setHasMeasured(true);
        if (!settleToAuto) setHeight(initialHeight);
      }
    } else {
      measure();
    }

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            // A new tab can finish mounting after its exit animation, images can
            // decode later, and async content can arrive after the first frame.
            // Re-measure every genuine content-size change and retarget the
            // active height animation instead of freezing an early measurement.
            const nextHeight = readIntrinsicHeight();
            if (nextHeight < minMeasuredHeight) return;

            if (settleToAuto) {
              if (isAnimatingRef.current) {
                animateTo(nextHeight);
              } else {
                lastStableHeightRef.current = nextHeight;
              }
            } else {
              animateTo(nextHeight);
            }
          })
        : null;

    resizeObserver?.observe(node);

    const mutationObserver =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => {
            // ResizeObserver is the primary source of truth. MutationObserver
            // catches transitions where a subtree is swapped but its first
            // measured box is temporarily the same size.
            measure();
          })
        : null;

    mutationObserver?.observe(node, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Images may decode after the incoming tab is already mounted. Capture
    // those events without forcing every consumer to manage image preload state.
    const images = Array.from(node.querySelectorAll("img"));
    const onAssetLoad = () => measure();
    images.forEach((image) => {
      if (!image.complete) image.addEventListener("load", onAssetLoad, { once: true });
    });

    return () => {
      cancelAnimationFrame(measureFrame);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      clearSettleTimer();
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      images.forEach((image) => image.removeEventListener("load", onAssetLoad));
    };
  }, [
    dependency,
    durationMs,
    includeOverflowInMeasurement,
    minMeasuredHeight,
    settleToAuto,
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
            ? `height ${durationMs}ms cubic-bezier(0.23, 1, 0.32, 1)`
            : undefined,
      }}
    >
      <div ref={contentRef} className={contentClassName}>
        {children}
      </div>
    </div>
  );
}
