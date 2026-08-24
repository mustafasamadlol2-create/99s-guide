/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, Suspense, memo, lazy } from "react";
import { AnimatePresence, motion } from "motion/react";
import { iOSAlertOptions, iOSAlertAction } from "../../core/device/alert";
import { HapticFeedback } from "../../core/device/haptic";

export default function IOSAlert() {
 const [alertData, setAlertData] = useState<iOSAlertOptions | null>(null);

 useEffect(() => {
 const handleShowAlert = (e: Event) => {
 const customEvent = e as CustomEvent<iOSAlertOptions>;
 setAlertData(customEvent.detail);
 // Trigger native double haptic click for alerts
 HapticFeedback.notification("success");
 };

 window.addEventListener("show-ios-alert", handleShowAlert);
 return () => {
 window.removeEventListener("show-ios-alert", handleShowAlert);
 };
 }, []);

 if (!alertData) return null;

 const handleActionClick = (action: iOSAlertAction) => {
 HapticFeedback.impact("light");
 setAlertData(null);
 if (action.onClick) {
 action.onClick();
 }
 };

 const actions = alertData.actions || [{ label: "OK", style: "default" }];
 const isMultiVertical = actions.length > 2;

 return (
 <AnimatePresence>
 <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 overflow-hidden select-none pointer-events-auto">
 {/* Backdrop overlay */}
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 transition={{ duration: 0.25 }}
 onClick={() => {
 // Standard iOS alert doesn't close on clicking backdrop, but let's snap back with light haptic
 HapticFeedback.impact("light");
 }}
 className="absolute inset-0 bg-black/40 dark:bg-[#000000]/55 backdrop-blur-xs"
 />

 {/* SwiftUI Alert Dialog Shell */}
 <motion.div
 initial={{ scale: 1.12, opacity: 0 }}
 animate={{ scale: 1, opacity: 1 }}
 exit={{ scale: 0.95, opacity: 0 }}
 transition={{
 type: "spring",
 stiffness: 400,
 damping: 40,
 }}
  className="ios-alert-panel relative w-full max-w-[270px] bg-neutral-100/90 dark:bg-[#1C1C1E]/90 backdrop-blur-overlay rounded-md overflow-hidden shadow-elevation-3 border border-neutral-200/40 dark:border-white/[0.05] flex flex-col text-center"
 >
 {/* Title & Message Panel */}
 <div className="px-5 pt-5 pb-4 space-y-2">
 <h3 className="text-body font-semibold text-neutral-900 dark:text-white">
 {alertData.title}
 </h3>
 {alertData.message && (
 <p className="text-secondary-label text-neutral-600 dark:text-neutral-450 whitespace-pre-wrap">
 {alertData.message}
 </p>
 )}
 </div>

 {/* Action Buttons list (SwiftUI style) */}
 <div
 className={`border-t border-neutral-300/60 dark:border-white/[0.08] flex ${isMultiVertical ? "flex-col" : "flex-row"}`}
 >
 {actions.map((act, index) => {
 const isCancel = act.style === "cancel";
 const isDestructive = act.style === "destructive";

 // Apply appropriate label styling
 let labelClass =
 "text-body font-normal text-med-blue dark:text-blue-400";
 if (isCancel) {
 labelClass =
 "text-body font-semibold text-med-blue dark:text-blue-400";
 } else if (isDestructive) {
 labelClass =
 "text-body font-normal text-med-error dark:text-red-400";
 }

 return (
 <button
 key={index}
 onClick={() => handleActionClick(act)}
 className={`flex-1 py-3 text-center text-ellipsis overflow-hidden font-sans cursor-pointer   transition-colors ${
 index > 0 && !isMultiVertical
 ? "border-l border-neutral-300/60 dark:border-white/[0.08]"
 : ""
 } ${
 index > 0 && isMultiVertical
 ? "border-t border-neutral-300/60 dark:border-white/[0.08]"
 : ""
 }`}
 >
 <span className={labelClass}>{act.label}</span>
 </button>
 );
 })}
 </div>
 </motion.div>
 </div>
 </AnimatePresence>
 );
}
