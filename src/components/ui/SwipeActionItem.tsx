import React, { useEffect, useRef, useState } from "react";
import {
  motion,
  useAnimation,
  useDragControls,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import { HapticFeedback } from "../../core/device/haptic";
import { isAppleTouchNavigationDevice } from "../../core/hooks/useSwipeBack";

interface SwipeAction {
  label: string;
  icon: React.ReactNode;
  bgClass: string;
  textClass?: string;
  onClick: () => void;
  isDestructive?: boolean;
}

interface SwipeActionItemProps {
  children: React.ReactNode;
  actions: SwipeAction[];
  keyId: string;
  direction?: "ltr" | "rtl";
  disabled?: boolean;
  className?: string;
}

const INTERACTIVE_CHILD_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="switch"]',
  '[role="slider"]',
  '[data-swipe-actions-disabled="true"]',
].join(",");

const OPEN_EVENT = "app-swipe-actions-open";

/**
 * iOS/iPadOS trailing swipe-actions cell.
 *
 * - Touch gestures only; Mac/Windows mouse layouts render the child as-is.
 * - Never performs a destructive action on a full swipe: the gesture only
 *   reveals explicit action buttons.
 * - Interactive descendants keep their native tap/edit behavior and never
 *   begin a row drag.
 * - Only one row stays open at a time.
 */
export function SwipeActionItem({
  children,
  actions,
  keyId,
  direction,
  disabled = false,
  className = "rounded-xl",
}: SwipeActionItemProps) {
  const shouldReduceMotion = useReducedMotion();
  const controls = useAnimation();
  const dragControls = useDragControls();
  const x = useMotionValue(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const thresholdHapticRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);

  const actionWidth = 72;
  const totalWidth = actions.length * actionWidth;
  const resolvedDirection =
    direction ??
    (typeof document !== "undefined" && document.documentElement.dir === "rtl" ? "rtl" : "ltr");
  const revealSign = resolvedDirection === "rtl" ? 1 : -1;
  const revealTarget = revealSign * totalWidth;
  const isAppleTouch = isAppleTouchNavigationDevice();

  useEffect(() => {
    const unsubscribe = x.on("change", (latest) => {
      const crossed = Math.abs(latest) >= Math.max(24, totalWidth * 0.72);
      if (crossed && !thresholdHapticRef.current) {
        thresholdHapticRef.current = true;
        void HapticFeedback.impact("light");
      } else if (!crossed && thresholdHapticRef.current) {
        thresholdHapticRef.current = false;
      }
    });
    return unsubscribe;
  }, [totalWidth, x]);

  useEffect(() => {
    if (!isOpen) return;

    const handleOtherRowOpened = (event: Event) => {
      const detail = (event as CustomEvent<{ keyId?: string }>).detail;
      if (detail?.keyId === keyId) return;
      void controls.start({
        x: 0,
        transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
      });
      setIsOpen(false);
      thresholdHapticRef.current = false;
    };

    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || containerRef.current?.contains(target)) return;
      void controls.start({
        x: 0,
        transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
      });
      setIsOpen(false);
      thresholdHapticRef.current = false;
    };

    window.addEventListener(OPEN_EVENT, handleOtherRowOpened as EventListener);
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    return () => {
      window.removeEventListener(OPEN_EVENT, handleOtherRowOpened as EventListener);
      document.removeEventListener("pointerdown", handleOutsidePointer, true);
    };
  }, [controls, isOpen, keyId]);

  useEffect(() => {
    if (!disabled) return;
    x.set(0);
    controls.set({ x: 0 });
    setIsOpen(false);
    thresholdHapticRef.current = false;
  }, [controls, disabled, x]);

  const snapClosed = () => {
    void controls.start({
      x: 0,
      transition: shouldReduceMotion
        ? { duration: 0.01 }
        : { type: "spring", stiffness: 430, damping: 40, mass: 0.78 },
    });
    setIsOpen(false);
    thresholdHapticRef.current = false;
  };

  const snapOpen = () => {
    void controls.start({
      x: revealTarget,
      transition: shouldReduceMotion
        ? { duration: 0.01 }
        : { type: "spring", stiffness: 430, damping: 40, mass: 0.78 },
    });
    setIsOpen(true);
    thresholdHapticRef.current = false;
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { keyId } }));
  };

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: any) => {
    thresholdHapticRef.current = false;
    const logicalOffset = info.offset.x * revealSign;
    const logicalVelocity = info.velocity.x * revealSign;

    if (logicalOffset > totalWidth * 0.44 || logicalVelocity > 260) {
      snapOpen();
    } else {
      snapClosed();
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isAppleTouch || disabled || actions.length === 0) return;
    if (event.pointerType !== "touch") return;

    const target = event.target as Element | null;
    if (target?.closest(INTERACTIVE_CHILD_SELECTOR)) return;

    dragControls.start(event);
  };

  const handleActionClick = (action: SwipeAction, event: React.MouseEvent) => {
    event.stopPropagation();
    snapClosed();
    action.onClick();
  };

  if (!isAppleTouch || disabled || actions.length === 0) {
    return (
      <div ref={containerRef} className="w-full relative">
        {children}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`w-full relative overflow-hidden select-none ${className}`}
      style={{ touchAction: "pan-y" }}
    >
      <div
        className={`absolute inset-y-0 z-0 flex items-stretch ${
          resolvedDirection === "rtl" ? "left-0 justify-start flex-row-reverse" : "right-0 justify-end"
        }`}
        aria-hidden={!isOpen}
      >
        {actions.map((action, index) => (
          <button
            key={`${keyId}-action-${index}`}
            type="button"
            onClick={(event) => handleActionClick(action, event)}
            className={`h-full flex flex-col items-center justify-center font-semibold gap-1 text-caption select-none ${action.bgClass} ${action.textClass || "text-white"}`}
            style={{ width: `${actionWidth}px` }}
            tabIndex={isOpen ? 0 : -1}
            data-haptic={action.isDestructive ? "warning" : "selection"}
            aria-label={action.label}
          >
            <span className="w-icon-md h-icon-md flex items-center justify-center pointer-events-none">
              {action.icon}
            </span>
            <span className="pointer-events-none">{action.label}</span>
          </button>
        ))}
      </div>

      <motion.div
        drag="x"
        dragControls={dragControls}
        dragListener={false}
        dragDirectionLock
        dragConstraints={
          resolvedDirection === "rtl"
            ? { left: 0, right: totalWidth }
            : { left: -totalWidth, right: 0 }
        }
        dragElastic={
          resolvedDirection === "rtl"
            ? { left: 0.04, right: 0.1 }
            : { left: 0.1, right: 0.04 }
        }
        dragMomentum={false}
        onPointerDown={handlePointerDown}
        onDragEnd={handleDragEnd}
        animate={controls}
        style={{ x }}
        className="relative z-10 w-full"
      >
        {children}
      </motion.div>
    </div>
  );
}
