import React, { useRef, useCallback, useState, useEffect, useMemo, useLayoutEffect, Suspense, memo, lazy } from "react";
import { HapticFeedback } from "../device/haptic";

interface UseLongPressOptions {
  onLongPress: (e: any) => void;
  onClick?: (e: any) => void;
  delay?: number;
}

export function useLongPress({
  onLongPress,
  onClick,
  delay = 500,
}: UseLongPressOptions) {
  const timeoutRef = useRef<any>(null);
  const isLongPressTriggered = useRef(false);
  const startCoords = useRef({ x: 0, y: 0 });

  const start = useCallback(
    (e: any) => {
      // Only handle primary touch / mouse click
      if (e.button && e.button !== 0) return;

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      startCoords.current = { x: clientX, y: clientY };
      isLongPressTriggered.current = false;

      timeoutRef.current = setTimeout(() => {
        HapticFeedback.impact("heavy");
        onLongPress(e);
        isLongPressTriggered.current = true;
      }, delay);
    },
    [onLongPress, delay],
  );

  const cancel = useCallback(
    (e: any) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (!isLongPressTriggered.current && onClick) {
        const clientX = e.changedTouches
          ? e.changedTouches[0].clientX
          : e.clientX;
        const clientY = e.changedTouches
          ? e.changedTouches[0].clientY
          : e.clientY;

        const dx = Math.abs(clientX - startCoords.current.x);
        const dy = Math.abs(clientY - startCoords.current.y);

        // Threshold to avoid registering click during rapid list swipes
        if (dx < 12 && dy < 12) {
          onClick(e);
        }
      }
    },
    [onClick],
  );

  const move = useCallback((e: any) => {
    if (timeoutRef.current) {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const dx = Math.abs(clientX - startCoords.current.x);
      const dy = Math.abs(clientY - startCoords.current.y);

      // Cancel long press window if user drags beyond threshold (intentional scroll)
      if (dx > 12 || dy > 12) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  }, []);

  return {
    onMouseDown: start,
    onMouseUp: cancel,
    onMouseLeave: () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    },
    onTouchStart: start,
    onTouchEnd: cancel,
    onTouchMove: move,
  };
}
