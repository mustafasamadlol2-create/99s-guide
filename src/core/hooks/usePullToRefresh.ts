import { useState, useRef, useEffect } from "react";
import { HapticFeedback } from "../device/haptic";

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  resistance?: number;
  triggerHeight?: number;
}

export function usePullToRefresh({
  onRefresh,
  triggerHeight = 70,
}: UsePullToRefreshOptions) {
  const [pullY, setPullY] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const onRefreshRef = useRef(onRefresh);
  const isRefreshingRef = useRef(isRefreshing);
  const hasThresholdHapticRef = useRef(false);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
    isRefreshingRef.current = isRefreshing;
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    
    // Find the nearest scrollable parent
    const scrollParent = el.closest(".ios-scrollable") || el;

    let rAFId: number | null = null;
    let isPulling = false;

    const handleScroll = () => {
      if (isRefreshingRef.current) return;
      
      // On iOS Safari, pulling down at the top makes scrollTop negative
      const st = scrollParent.scrollTop;
      
      if (st < 0) {
        isPulling = true;
        const currentPullY = Math.abs(st);
        
        if (rAFId) cancelAnimationFrame(rAFId);
        
        rAFId = requestAnimationFrame(() => {
          setPullY(currentPullY);
          
          if (currentPullY >= triggerHeight && !hasThresholdHapticRef.current) {
            HapticFeedback.impact("medium");
            hasThresholdHapticRef.current = true;
          } else if (currentPullY < triggerHeight && hasThresholdHapticRef.current) {
            hasThresholdHapticRef.current = false;
          }
        });
      } else if (isPulling) {
        // Reset when rubber-banding snaps back to 0
        isPulling = false;
        hasThresholdHapticRef.current = false;
        if (rAFId) cancelAnimationFrame(rAFId);
        setPullY(0);
      }
    };

    const handleTouchEnd = async () => {
      if (isRefreshingRef.current || !isPulling) return;
      
      const st = scrollParent.scrollTop;
      if (st < -triggerHeight) {
        setIsRefreshing(true);
        HapticFeedback.notification("success");
        try {
          await onRefreshRef.current();
        } catch (err) {
          // ignore
        } finally {
          setIsRefreshing(false);
          setPullY(0);
          hasThresholdHapticRef.current = false;
          isPulling = false;
        }
      }
    };

    // Use passive scroll listener for 100% native iOS performance (no touchmove blocking)
    scrollParent.addEventListener("scroll", handleScroll, { passive: true });
    scrollParent.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      scrollParent.removeEventListener("scroll", handleScroll);
      scrollParent.removeEventListener("touchend", handleTouchEnd);
      if (rAFId) cancelAnimationFrame(rAFId);
    };
  }, [triggerHeight]);

  return { pullY, isRefreshing, containerRef };
}
