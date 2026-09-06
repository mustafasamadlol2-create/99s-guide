/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, Suspense, memo, lazy } from "react";
import { motion } from "motion/react";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
 key?: any;
 className?: string;
 variant?: "text" | "rect" | "circle";
 height?: string | number;
 width?: string | number;
}

const Skeleton = memo(function Skeleton({
 className = "",
 variant = "rect",
 height,
 width,
}: SkeletonProps) {
 const baseStyle =
 "bg-[#1C1C1E]/5 dark:bg-white/[0.08] relative overflow-hidden shrink-0";
 const variantStyles = {
 text: "rounded-md h-4 w-full",
 rect: "rounded-md",
 circle: "rounded-full",
 };

 const style: React.CSSProperties = {
 ...(height ? { height } : {}),
 ...(width ? { width } : {}),
 };

 return (
 <div
 className={`${baseStyle} ${variantStyles[variant]} ${className}`}
 style={style}
 >
 <motion.div
 className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 dark:via-white/10 to-transparent"
 animate={{ translateX: ["-100%", "200%"] }}
 transition={{
 duration: 1.5,
 repeat: Infinity,
 ease: "easeInOut",
 }}
 />
 </div>
 );
});



/**
 * Premium Apple-Quality Dashboard / Home Skeleton
 */
export function ListSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex items-start gap-4 p-4 bg-white dark:bg-[#1C1C1E] rounded-xl border border-neutral-200/60 dark:border-white/[0.10] shadow-elevation-1">
          <Skeleton variant="rect" width={40} height={40} className="rounded-lg bg-neutral-200 dark:bg-[#2C2C2E]" />
          <div className="space-y-2 flex-grow mt-1">
            <Skeleton variant="text" width="60%" className="h-4 bg-neutral-200 dark:bg-[#2C2C2E]" />
            <Skeleton variant="text" width="40%" className="h-3 bg-neutral-200 dark:bg-[#2C2C2E]" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Premium Apple-Quality Dashboard / Home Skeleton
 */
export function DashboardSkeleton() {
 return (
 <div className="space-y-section w-full animate-fadeIn p-4 sm:p-6">
 {/* Header Profile Summary Section Skeleton */}
 <div className="flex items-center justify-between gap-4 pb-4">
 <div className="space-y-2">
 <Skeleton variant="text" width={140} className="h-5 bg-neutral-200 dark:bg-[#2C2C2E]" />
 <Skeleton variant="text" width={220} className="h-3 bg-neutral-200 dark:bg-[#2C2C2E]" />
 </div>
 <Skeleton variant="circle" width={48} height={48} className="bg-neutral-200 dark:bg-[#2C2C2E]" />
 </div>

 {/* Bento Grid Stats Card Skeleton */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 {[...Array(4)].map((_, i) => (
 <div
 key={i}
 className="p-card-padding bg-white dark:bg-[var(--bg-surface-1)] rounded-lg border border-neutral-200/60 dark:border-white/[0.10] space-y-3 shadow-elevation-1"
 >
 <div className="flex items-center justify-between">
 <Skeleton variant="circle" width={24} height={24} className="bg-neutral-200 dark:bg-[#2C2C2E]" />
 <Skeleton variant="rect" width={32} height={16} className="rounded-full bg-neutral-200 dark:bg-[#2C2C2E]" />
 </div>
 <Skeleton variant="text" width="60%" className="h-4 bg-neutral-200 dark:bg-[#2C2C2E]" />
 <Skeleton variant="text" width="40%" className="h-3 bg-neutral-200 dark:bg-[#2C2C2E]" />
 </div>
 ))}
 </div>

 {/* Urgent Announcements & Notifications Header Skeleton */}
 <div className="bg-neutral-100/50 dark:bg-[var(--bg-surface-1)] border border-neutral-200/50 dark:border-white/[0.12] rounded-lg p-card-padding space-y-3">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Skeleton variant="circle" width={18} height={18} className="bg-neutral-200 dark:bg-[#2C2C2E]" />
 <Skeleton variant="text" width={120} className="h-3 bg-neutral-200 dark:bg-[#2C2C2E]" />
 </div>
 <Skeleton variant="rect" width={48} height={16} className="rounded-full bg-neutral-200 dark:bg-[#2C2C2E]" />
 </div>
 <Skeleton variant="text" width="95%" className="h-3 bg-neutral-200 dark:bg-[#2C2C2E]" />
 <Skeleton variant="text" width="80%" className="h-3 bg-neutral-200 dark:bg-[#2C2C2E]" />
 </div>

 {/* Primary Subjects Grid */}
 <div className="space-y-3">
 <div className="flex items-center justify-between">
 <Skeleton variant="text" width={120} className="h-4 bg-neutral-200 dark:bg-[#2C2C2E]" />
 <Skeleton variant="text" width={60} className="h-3 bg-neutral-200 dark:bg-[#2C2C2E]" />
 </div>
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
 {[...Array(3)].map((_, i) => (
 <div
 key={i}
 className="p-card-padding bg-white dark:bg-[var(--bg-surface-1)] rounded-lg border border-neutral-200/60 dark:border-white/[0.10] space-y-4 shadow-elevation-1 flex items-start gap-card-padding"
 >
 <Skeleton variant="rect" width={44} height={44} className="rounded-md bg-neutral-200 dark:bg-[#2C2C2E]" />
 <div className="space-y-2 flex-grow">
 <Skeleton variant="text" width="70%" className="h-4 bg-neutral-200 dark:bg-[#2C2C2E]" />
 <Skeleton variant="text" width="50%" className="h-3 bg-neutral-200 dark:bg-[#2C2C2E]" />
 <div className="w-full h-2 bg-neutral-100 dark:bg-[#2C2C2E] rounded-full mt-2 overflow-hidden">
 <div className="bg-neutral-200 dark:bg-neutral-700 h-full w-[40%] animate-pulse" />
 </div>
 </div>
 </div>
 ))}
 </div>
 </div>
 </div>
 );
}



/**
 * Premium Dynamic Live Users Presence Skeleton
 */
export function LivePresenceSkeleton() {
 return (
 <div className="space-y-3 w-full">
 <div className="flex items-center justify-between pb-2 border-b border-neutral-100 dark:border-white/[0.06]">
 <div className="flex items-center gap-2">
 <Skeleton variant="circle" width={12} height={12} className="bg-neutral-200 dark:bg-[#2C2C2E]" />
 <Skeleton variant="text" width={110} className="h-4 bg-neutral-200 dark:bg-[#2C2C2E]" />
 </div>
 <Skeleton variant="circle" width={16} height={16} className="bg-neutral-200 dark:bg-[#2C2C2E]" />
 </div>
 <div className="grid grid-cols-2 gap-2 mt-1">
 {[...Array(4)].map((_, i) => (
 <div
 key={i}
 className="flex items-center gap-3 p-2 bg-neutral-50/50 dark:bg-[var(--bg-surface-1)]/40 rounded-lg border border-neutral-100/50 dark:border-white/[0.04]"
 >
 <div className="relative">
 <Skeleton variant="circle" width={26} height={26} className="bg-neutral-200 dark:bg-[#2C2C2E]" />
 <div className="absolute bottom-0 right-0 w-2 h-2 rounded-full border border-white bg-neutral-200 dark:bg-neutral-700 animate-pulse" />
 </div>
 <div className="space-y-1 flex-grow">
 <Skeleton variant="text" width="85%" className="h-3 bg-neutral-200 dark:bg-[#2C2C2E]" />
 <Skeleton variant="text" width="55%" className="h-2 bg-neutral-200 dark:bg-[#2C2C2E]" />
 </div>
 </div>
 ))}
 </div>
 </div>
 );
}
