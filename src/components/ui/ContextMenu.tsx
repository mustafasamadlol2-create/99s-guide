import React, { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect, Suspense, memo, lazy } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useLongPress } from "../../core/hooks/useLongPress";
import { HapticFeedback } from "../../core/device/haptic";

interface ContextMenuOption {
 value: string;
 label: string;
 icon?: React.ReactNode;
 isDestructive?: boolean;
}

interface ContextMenuProps {
 key?: any;
 children:
 React.ReactElement | ((openMenu: (e: any) => void) => React.ReactElement);
 options: ContextMenuOption[];
 onSelect: (value: string) => void;
 triggerDelay?: number;
}

// Staff-level React Context to allow any deeply nested descendant control (Apple UI System patterns)
const ContextMenuTriggerContext = React.createContext<{
 openMenu: (e: any) => void;
 isOpen: boolean;
} | null>(null);

export function ContextMenu({
 children,
 options,
 onSelect,
 triggerDelay = 500,
}: ContextMenuProps) {
 const [isOpen, setIsOpen] = useState(false);
 const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
 const [elementRect, setElementRect] = useState<DOMRect | null>(null);
 const [focusedOptionIndex, setFocusedOptionIndex] = useState<number>(-1);
 const originalRef = useRef<HTMLDivElement>(null);
 const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
 const shouldReduceMotion = useReducedMotion();

 const handleTrigger = (e: any) => {
 if (e && e.preventDefault) {
 e.preventDefault();
 }
 if (e && e.stopPropagation) {
 e.stopPropagation();
 }

 if (originalRef.current) {
 const rect = originalRef.current.getBoundingClientRect();
 setElementRect(rect);

 // Determine smart positioning of the options context card (above or below)
 const spaceBelow = window.innerHeight - rect.bottom;
 const spaceAbove = rect.top;
 const menuHeight = options.length * 44 + 16; // approximate menu size

 let top = rect.bottom + 8;
 if (spaceBelow < menuHeight && spaceAbove > menuHeight) {
 top = rect.top - menuHeight;
 }

 // Helper to dynamically read CSS safe area variables
 const getPixelValue = (cssVar: string, fallback: number) => {
 const val = getComputedStyle(document.documentElement)
 .getPropertyValue(cssVar)
 .trim();
 if (!val) return fallback;
 const parsed = parseFloat(val);
 return isNaN(parsed) ? fallback : parsed;
 };

 const safeTop = getPixelValue("--safe-area-top", 0);
 const safeBottom = getPixelValue("--safe-area-bottom", 0);
 const safeLeft = getPixelValue("--safe-area-left", 0);
 const safeRight = getPixelValue("--safe-area-right", 0);

 // Clamp vertically inside safe bounds (Dynamic Island, notch, status bar, home indicator)
 const minTop = safeTop + 12;
 const maxTop = window.innerHeight - safeBottom - menuHeight - 12;
 top = Math.max(minTop, Math.min(maxTop, top));

 // Clamp horizontally inside safe bounds
 let left = rect.left;
 const minLeft = safeLeft + 12;
 const maxLeft = window.innerWidth - safeRight - 220 - 12;
 left = Math.max(minLeft, Math.min(maxLeft, left));

 setMenuPosition({ top, left });
 setIsOpen(true);
 HapticFeedback.notification("success");
 }
 };

 const renderedChild =
 typeof children === "function" ? children(handleTrigger) : children;

 const gestureProps = useLongPress({
 onLongPress: handleTrigger,
 onClick: (e) => {
 // standard click triggers child's normal click if defined
 if ((renderedChild.props as any).onClick) {
 (renderedChild.props as any).onClick(e);
 }
 },
 delay: triggerDelay,
 });

 // Handle right click on desktop
 const handleContextMenu = (e: React.MouseEvent) => {
 e.preventDefault();
 handleTrigger(e);
 };

 // Keyboard navigation for opening custom actions lists
 const handleKeyDown = (e: React.KeyboardEvent) => {
 if (e.key === "Enter" || e.key === " ") {
 // Space or Enter on trigger can trigger primary action or menu if specified
 if ((renderedChild.props as any).onClick) {
 (renderedChild.props as any).onClick(e);
 } else {
 e.preventDefault();
 handleTrigger(e);
 }
 } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
 e.preventDefault();
 handleTrigger(e);
 }
 };

 useEffect(() => {
 if (isOpen) {
 document.body.style.overflow = "hidden";
 setFocusedOptionIndex(0);
 // Let element mount, then focus the first option for accessibility/screen reader announcement
 const t = setTimeout(() => {
 optionRefs.current[0]?.focus();
 }, 60);
 return () => clearTimeout(t);
 } else {
 document.body.style.overflow = "";
 setFocusedOptionIndex(-1);
 }
 }, [isOpen]);

 const handleOptionClick = (
 value: string,
 e: React.MouseEvent | React.KeyboardEvent,
 ) => {
 e.stopPropagation();
 HapticFeedback.impact("light");
 onSelect(value);
 setIsOpen(false);
 // Restore focus back on closing
 originalRef.current?.focus();
 };

 const handleMenuKeyDown = (e: React.KeyboardEvent) => {
 if (e.key === "Escape") {
 e.preventDefault();
 setIsOpen(false);
 originalRef.current?.focus();
 } else if (e.key === "ArrowDown") {
 e.preventDefault();
 const nextIndex = (focusedOptionIndex + 1) % options.length;
 setFocusedOptionIndex(nextIndex);
 optionRefs.current[nextIndex]?.focus();
 } else if (e.key === "ArrowUp") {
 e.preventDefault();
 const prevIndex =
 (focusedOptionIndex - 1 + options.length) % options.length;
 setFocusedOptionIndex(prevIndex);
 optionRefs.current[prevIndex]?.focus();
 } else if (e.key === "Tab") {
 e.preventDefault();
 const nextIndex = e.shiftKey
 ? (focusedOptionIndex - 1 + options.length) % options.length
 : (focusedOptionIndex + 1) % options.length;
 setFocusedOptionIndex(nextIndex);
 optionRefs.current[nextIndex]?.focus();
 }
 };

 const contextValue = useMemo(
 () => ({ openMenu: handleTrigger, isOpen }),
 [handleTrigger, isOpen],
 );

 return (
 <ContextMenuTriggerContext.Provider value={contextValue}>
 <div
 ref={originalRef}
 {...gestureProps}
 onContextMenu={handleContextMenu}
 onKeyDown={handleKeyDown}
 tabIndex={0}
 role="button"
 aria-haspopup="menu"
 aria-expanded={isOpen}
 aria-label={
 (renderedChild as React.ReactElement<any>).props["aria-label"] ||
 "Context Menu Item. Press Shift+F10 or long-press for more options."
 }
 className="inline-block w-full cursor-pointer select-none rounded-lg"
 >
 {renderedChild}
 </div>

 <AnimatePresence>
 {isOpen && elementRect && (
 <div
 className="fixed inset-0 z-[100] overflow-hidden select-none"
 role="presentation"
 >
 {/* Dark blur backdrop */}
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 transition={{ duration: 0.22, ease: "easeOut" }}
 onClick={() => setIsOpen(false)}
 className="absolute inset-0 bg-black/30 backdrop-blur-[12px] dark:bg-[#000000]/50 saturate-150"
 style={{ WebkitBackdropFilter: "blur(12px) saturate(1.5)" }}
 />

 {/* Simulated physical lifted clone of the longpressed item */}
 <motion.div
 initial={
 shouldReduceMotion
 ? { opacity: 0, scale: 0.99 }
 : {
 position: "fixed",
 top: elementRect.top,
 left: elementRect.left,
 width: elementRect.width,
 height: elementRect.height,
 scale: 1,
 zIndex: 101,
 boxShadow: "0 0px 0px rgba(0,0,0,0)",
 }
 }
 animate={
 shouldReduceMotion
 ? { opacity: 1, scale: 1 }
 : {
 scale: 1.03,
 boxShadow: "0 25px 50px -12px rgba(0,0,0,0.3)",
 transition: {
 type: "spring",
 stiffness: 400,
 damping: 40,
 },
 }
 }
 exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
 onClick={() => setIsOpen(false)}
 style={
 shouldReduceMotion
 ? {
 position: "fixed",
 top: elementRect.top,
 left: elementRect.left,
 width: elementRect.width,
 height: elementRect.height,
 zIndex: 101,
 }
 : undefined
 }
 className="pointer-events-none rounded-lg"
 aria-hidden="true"
 >
 {React.cloneElement(renderedChild as React.ReactElement<any>, {
 className:
 ((renderedChild.props as any).className || "") +
 " !shadow-elevation-0 !border-transparent",
 tabIndex: -1,
 })}
 </motion.div>

 {/* Elastic iOS styled action list */}
 <motion.div
 initial={
 shouldReduceMotion
 ? { opacity: 0, scale: 0.95 }
 : {
 opacity: 0,
 y: menuPosition.top > elementRect.top ? -8 : 8,
 scale: 0.88,
 originX: 0.1,
 originY: menuPosition.top > elementRect.top ? 0 : 1,
 }
 }
 animate={{
 opacity: 1,
 y: 0,
 scale: 1,
 transition: { type: "spring", stiffness: 400, damping: 40, mass: 1 },
 }}
 exit={{
 opacity: 0,
 scale: 0.9,
 transition: { duration: 0.14, ease: "easeIn" },
 }}
 style={{
 position: "fixed",
 top: menuPosition.top,
 left: menuPosition.left,
 width: "220px",
 zIndex: 102,
 }}
 className="liquid-glass-thick rounded-md shadow-elevation-3 p-2 flex flex-col space-y-0.5"
 role="menu"
 aria-label="Actions list"
 onKeyDown={handleMenuKeyDown}
 >
 {options.map((opt, index) => (
 <button
 key={opt.value}
 ref={(el) => {
 optionRefs.current[index] = el;
 }}
 onClick={(e) => handleOptionClick(opt.value, e)}
 onKeyDown={(e) => {
 if (e.key === "Enter" || e.key === " ") {
 e.preventDefault();
 handleOptionClick(opt.value, e);
 }
 }}
 role="menuitem"
 tabIndex={0}
 className={`w-full py-3 px-4 rounded-lg text-caption font-semibold flex items-center justify-between transition-colors text-left group cursor-pointer focus:bg-med-gold/10 focus:ring-1 focus:ring-amber-500/40 ${
 opt.isDestructive
 ? "text-red-650 hover:bg-med-error/10 dark:text-red-400"
 : "text-neutral-800 hover:bg-neutral-100/60 dark:text-white dark:hover:bg-white/[0.12]/60"
 }`}
 >
 <span className="truncate">{opt.label}</span>
 {opt.icon && (
 <span
 className={`w-icon-md h-icon-md flex items-center justify-center transition-transform group- shrink-0 ${opt.isDestructive ? "text-med-error" : "text-neutral-500 dark:text-[#EBEBF599]"}`}
 >
 {opt.icon}
 </span>
 )}
 </button>
 ))}
 </motion.div>
 </div>
 )}
 </AnimatePresence>
 </ContextMenuTriggerContext.Provider>
 );
}
