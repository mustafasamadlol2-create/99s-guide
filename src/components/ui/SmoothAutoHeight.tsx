import React, { useLayoutEffect, useRef, useState } from "react";

interface SmoothAutoHeightProps {
  children: React.ReactNode;
  dependency?: unknown;
  className?: string;
  contentClassName?: string;
  style?: React.CSSProperties;
  durationMs?: number;
  minMeasuredHeight?: number;
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
}: SmoothAutoHeightProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [hasMeasured, setHasMeasured] = useState(false);
  const reducedMotionRef = useRef(false);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    reducedMotionRef.current = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  }, []);

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    let frame = 0;

    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const nextHeight = Math.ceil(node.getBoundingClientRect().height);
        // AnimatePresence can briefly leave an empty frame between outgoing
        // and incoming content. Ignore that transient zero-height state.
        if (nextHeight < minMeasuredHeight) return;
        setHeight((previous) => (previous === nextHeight ? previous : nextHeight));
        setHasMeasured(true);
      });
    };

    measure();

    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(node);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [dependency, minMeasuredHeight]);

  return (
    <div
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
