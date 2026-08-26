import { useEffect, useRef } from "react";

/**
 * Makes the legal/support pages reliably respond to desktop mouse-wheel input
 * even when they are nested inside the app's main scroll canvas.
 *
 * Touch scrolling is left to the browser/WKWebView. The wheel listener is
 * intentionally native + non-passive so we can keep the scroll inside the
 * legal page instead of allowing the parent canvas to swallow the gesture.
 */
export const useReliableLegalScroll = () => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.defaultPrevented || event.deltaY === 0) return;

      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      if (maxScrollTop <= 0) return;

      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? element.clientHeight
            : 1;
      const deltaY = event.deltaY * unit;
      const current = element.scrollTop;
      const next = Math.min(maxScrollTop, Math.max(0, current + deltaY));

      if (next === current) return;

      // Keep the wheel gesture owned by this page instead of the parent app
      // canvas. This is the path that was failing on desktop mouse wheels.
      event.preventDefault();
      event.stopPropagation();
      element.scrollTop = next;
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, []);

  return scrollRef;
};
