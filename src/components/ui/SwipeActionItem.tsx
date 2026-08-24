import React, { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect, Suspense, memo, lazy } from "react";
import {
 motion,
 useMotionValue,
 useTransform,
 useAnimation,
 useReducedMotion,
} from "motion/react";
import { HapticFeedback } from "../../core/device/haptic";

interface SwipeAction {
 label: string;
 icon: React.ReactNode;
 bgClass: string; // e.g. 'bg-med-error'
 textClass?: string; // e.g. 'text-white'
 onClick: () => void;
 isDestructive?: boolean;
}

interface SwipeActionItemProps {
 children: React.ReactNode;
 actions: SwipeAction[];
 keyId: string;
}

export function SwipeActionItem({
 children,
 actions,
 keyId,
}: SwipeActionItemProps) {
 const shouldReduceMotion = useReducedMotion();
 const controls = useAnimation();
 const x = useMotionValue(0);
 const containerRef = useRef<HTMLDivElement>(null);

 // Width of each swipe action block is 70px
 const actionWidth = 70;
 const totalWidth = actions.length * actionWidth;

 const [isOpen, setIsOpen] = useState(false);
 const [hasThresholdHaptic, setHasThresholdHaptic] = useState(false);

 // Monitor x to trigger subtle haptic when dragging goes past actions width
 useEffect(() => {
 const unsubscribe = x.on("change", (latest) => {
 if (latest < -totalWidth - 30 && !hasThresholdHaptic) {
 HapticFeedback.impact("light");
 setHasThresholdHaptic(true);
 } else if (latest >= -totalWidth - 30 && hasThresholdHaptic) {
 setHasThresholdHaptic(false);
 }
 });
 return unsubscribe;
 }, [x, totalWidth, hasThresholdHaptic]);

 const handleDragEnd = async (_event: any, info: any) => {
 const dragOffset = info.offset.x;
 const dragVelocity = info.velocity.x;

 // Reset snap animations
 setHasThresholdHaptic(false);

 // If swiped far to the left or swift swift velocity left
 if (dragOffset < -totalWidth / 2 || dragVelocity < -200) {
 // Locked open to actions menu
 await controls.start({
 x: -totalWidth,
 transition: { type: "spring", stiffness: 400, damping: 40, mass: 1 },
 }).catch(() => {});
 setIsOpen(true);
 } else {
 // Snap closed
 await controls.start({
 x: 0,
 transition: { type: "spring", stiffness: 400, damping: 40, mass: 1 },
 }).catch(() => {});
 setIsOpen(false);
 }
 };

 const handleActionClick = (action: SwipeAction, e: React.MouseEvent) => {
 e.stopPropagation();
 HapticFeedback.impact("medium");
 controls.start({ x: 0, transition: { duration: 0.18, ease: "easeOut" } }).catch(() => {});
 setIsOpen(false);
 action.onClick();
 };

 if (shouldReduceMotion || actions.length === 0) {
 return (
 <div ref={containerRef} className="w-full relative">
 {children}
 </div>
 );
 }

 return (
 <div
 ref={containerRef}
 className="w-full relative overflow-hidden select-none rounded-lg"
 style={{ touchAction: "pan-y" }}
 >
 {/* Behind actions panel */}
 <div className="absolute inset-y-0 right-0 flex items-center justify-end z-0">
 {actions.map((act, index) => {
 // Slide-in skew effect based on drag offset coordinates for depth
 return (
 <button
 key={index}
 onClick={(e) => handleActionClick(act, e)}
 className={`h-full flex flex-col items-center justify-center cursor-pointer font-semibold gap-1 text-caption select-none transition-colors duration-200  ${act.bgClass} ${act.textClass || "text-white"}`}
 style={{ width: `${actionWidth}px` }}
 >
 <span className="w-icon-md h-icon-md flex items-center justify-center transition-transform">
 {act.icon}
 </span>
 <span>{act.label}</span>
 </button>
 );
 })}
 </div>

 {/* Foreground scroll cell wrapper */}
 <motion.div
 drag="x"
 dragDirectionLock
 dragConstraints={{ left: -totalWidth, right: 0 }}
 dragElastic={{ left: 0.12, right: 0.04 }}
 dragMomentum={false}
 onDragEnd={handleDragEnd}
 animate={controls}
 style={{ x }}
 className="relative z-10 w-full bg-transparent"
 >
 {children}
 </motion.div>
 </div>
 );
}
