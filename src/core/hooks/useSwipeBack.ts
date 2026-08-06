import { useEffect, useRef } from "react";
import { HapticFeedback } from "../device/haptic";

interface UseSwipeBackOptions {
  onSwipeBack: () => void;
  isEnabled: boolean;
  threshold?: number;
  onSwipeMove?: (dx: number) => void;
  onSwipeEnd?: (success: boolean) => void;
}

export function useSwipeBack({
  onSwipeBack,
  isEnabled,
  threshold = 90,
  onSwipeMove,
  onSwipeEnd,
}: UseSwipeBackOptions) {
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const isEligibleRef = useRef(false);

  // Store dynamic callbacks and variables in refs to prevent listener re-binding thrashing
  const onSwipeBackRef = useRef(onSwipeBack);
  const onSwipeMoveRef = useRef(onSwipeMove);
  const onSwipeEndRef = useRef(onSwipeEnd);
  const thresholdRef = useRef(threshold);

  useEffect(() => {
    onSwipeBackRef.current = onSwipeBack;
    onSwipeMoveRef.current = onSwipeMove;
    onSwipeEndRef.current = onSwipeEnd;
    thresholdRef.current = threshold;
  });

  useEffect(() => {
    if (!isEnabled || typeof window === "undefined") return;

    const handleTouchStart = (e: TouchEvent) => {
      const startX = e.touches[0].clientX;
      const startY = e.touches[0].clientY;

      // HIG guidelines: Natural iOS swipe back starts from the extreme left bevel edge (<= 25px)
      if (startX <= 25) {
        touchStartXRef.current = startX;
        touchStartYRef.current = startY;
        isEligibleRef.current = true;
      } else {
        isEligibleRef.current = false;
      }
    };

    let rAFId: number | null = null;

    const handleTouchMove = (e: TouchEvent) => {
      if (!isEligibleRef.current) return;

      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const dx = currentX - touchStartXRef.current;
      const dy = Math.abs(currentY - touchStartYRef.current);

      // Lock scroll axis if movement is cleanly horizontal right
      if (dx > 10 && dy < dx * 0.55) {
        if (e.cancelable) {
          e.preventDefault();
        }

        if (rAFId) {
          cancelAnimationFrame(rAFId);
        }

        rAFId = requestAnimationFrame(() => {
          if (onSwipeMoveRef.current && dx > 0) {
            onSwipeMoveRef.current(dx);
          }
        });
      } else if (dy > dx && dy > 15) {
        // Vertical swipe cancelled eligibility to prevent interference with scroll physics
        isEligibleRef.current = false;
        if (rAFId) {
          cancelAnimationFrame(rAFId);
        }
        if (onSwipeEndRef.current) {
          onSwipeEndRef.current(false);
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (rAFId) {
        cancelAnimationFrame(rAFId);
      }
      if (!isEligibleRef.current) return;
      isEligibleRef.current = false;

      const endX = e.changedTouches[0].clientX;
      const dx = endX - touchStartXRef.current;

      // Pop state if swipe displacement crossed threshold limits
      if (dx >= thresholdRef.current) {
        HapticFeedback.impact("light");
        if (onSwipeEndRef.current) {
          onSwipeEndRef.current(true);
        }
        onSwipeBackRef.current();
      } else {
        if (onSwipeEndRef.current) {
          onSwipeEndRef.current(false);
        }
      }
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isEnabled]); // Only reset listeners if enabled status explicitly changes
}
