import React, { memo, useId } from "react";
import { motion } from "motion/react";
import { BookOpen, CircleCheck } from "lucide-react";
import { Subject, SubjectId } from "../../../core/types";
import { HapticFeedback } from "../../../core/device/haptic";

interface SwipeableSubjectButtonProps {
  key?: any;
  subject: Subject;
  lecturesCount: number;
  iconInfo: any;
  IconComponent: any;
  onSelectSubject: (id: SubjectId) => void;
  isRtl: boolean;
  isTouchDevice: boolean;
  index: number;
  progressPct: number;
}

export const SwipeableSubjectButton = memo(function SwipeableSubjectButton({
  subject,
  lecturesCount,
  iconInfo,
  IconComponent,
  onSelectSubject,
  isRtl,
  isTouchDevice,
  index,
  progressPct,
}: SwipeableSubjectButtonProps) {
  const gradId = useId().replace(/:/g, "");

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleTap();
    }
  };

  const handleTap = () => {
    HapticFeedback.impact("light");
    onSelectSubject(subject.id);
  };

  return (
    <motion.div
      onClick={handleTap}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      className="ios-staggered-card macos-interactive relative group flex flex-col justify-between w-full h-full min-h-[160px] p-5 z-10 bg-white dark:bg-[#1C1C1E] rounded-xl text-left cursor-pointer select-none overflow-hidden shadow-elevation-1 ring-1 ring-black/[0.03] dark:ring-white/10"
      style={{
        WebkitBackfaceVisibility: "hidden",
        backfaceVisibility: "hidden",
        WebkitTransform: "translate3d(0,0,0)",
        transform: "translate3d(0,0,0)",
      }}
    >
      {/* Subtle base color tint */}
      <div className="absolute inset-0 opacity-[0.02] dark:opacity-[0.03] pointer-events-none" style={{ backgroundColor: iconInfo.glow }}></div>
      
      {/* Animated gradient background */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-[0.05] pointer-events-none transition-opacity duration-300" style={{ background: `linear-gradient(to bottom right, transparent, ${iconInfo.glow})` }}></div>
      
      {/* Ambient glowing radial background */}
      <div className="absolute inset-0 opacity-[0.035] group-hover:opacity-[0.045] pointer-events-none transition-opacity duration-300" style={{ background: `radial-gradient(circle at ${isRtl ? "top left" : "top right"}, ${iconInfo.glow} 0%, transparent 80%)` }}></div>

      <div className="flex justify-between items-start gap-3 w-full relative z-10 pointer-events-none shrink-0">
        <div 
          className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${iconInfo.text} relative ring-1 ring-black/[0.03] dark:ring-white/10 overflow-hidden`}
          style={{ 
            background: `radial-gradient(120% 120% at 50% 0%, color-mix(in srgb, ${iconInfo.glow} 16%, transparent) 0%, color-mix(in srgb, ${iconInfo.glow} 4%, transparent) 100%)`, 
            boxShadow: `0 8px 20px -6px color-mix(in srgb, ${iconInfo.glow} 35%, transparent), inset 0 1.5px 1.5px rgba(255,255,255,0.4), inset 0 -1.5px 1.5px rgba(0,0,0,0.03)`,
          }}
        >
          <div className="absolute inset-0 rounded-full bg-white/30 dark:bg-[#000000]/20 backdrop-blur-sm" />
          <IconComponent className="w-icon-md h-icon-md relative z-10 filter drop-shadow-md" />
        </div>
        
        <div className="flex flex-col items-end gap-1">
          <span 
            className={`text-xs font-semibold font-mono px-3 py-2 rounded-lg tracking-[0.12em] backdrop-blur-sm bg-white/50 dark:bg-[#2C2C2E]/30 ${iconInfo.text}`}
            style={{ 
              border: `1px solid color-mix(in srgb, ${iconInfo.glow} 30%, transparent)`, 
              boxShadow: `0 4px 12px -4px color-mix(in srgb, ${iconInfo.glow} 25%, transparent), inset 0 1px 1px rgba(255,255,255,0.4)` 
            }}
          >
            {subject.id}
          </span>
        </div>
      </div>
      
      <div className="mt-auto relative z-10 pointer-events-none flex-1 flex flex-col justify-end pt-5">
        <div className="flex flex-col gap-1 mb-4">
          <h3 className="font-display font-semibold text-neutral-900/95 dark:text-white/95 text-lg text-balance">
            {isRtl ? subject.nameAr : subject.name}
          </h3>
          <span className="text-sm font-medium text-neutral-500 dark:text-[#EBEBF599]/80 dark:text-[#EBEBF599] line-clamp-1">
            {lecturesCount === 0 
              ? (isRtl ? "لم يتم إضافة محاضرات" : "No lectures yet") 
              : (isRtl ? "قيد الدراسة" : "In progress")}
          </span>
        </div>
        
        <div className="flex items-center justify-between w-full pt-4 border-t border-black/[0.04] dark:border-white/[0.04]">
          <span className="flex items-center gap-2 text-sm font-medium text-neutral-500 dark:text-[#EBEBF599]/90 dark:text-[#EBEBF599]">
            <BookOpen className="w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599]/70 dark:text-[#EBEBF599]/70" />{" "}
            {lecturesCount} {isRtl ? "محاضرة" : "lectures"}
          </span>
          <div className="flex items-center gap-2">
            <div className="relative w-icon-xl h-icon-xl flex items-center justify-center">
              <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 44 44">
                <defs>
                  <linearGradient id={`grad-${gradId}`} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor={iconInfo.glow} />
                    <stop offset="100%" stopColor={iconInfo.glow} stopOpacity="0.4" />
                  </linearGradient>
                </defs>
                <circle cx="22" cy="22" r="16" fill="none" className="stroke-neutral-200/80 dark:stroke-neutral-800" strokeWidth="5" />
                <circle 
                  cx="22" 
                  cy="22" 
                  r="16" 
                  fill="none" 
                  stroke={`url(#grad-${gradId})`} 
                  strokeWidth="5" 
                  strokeDasharray="100.53" 
                  style={{ 
                    strokeDashoffset: 100.53 - (100.53 * progressPct) / 100,
                    filter: progressPct > 0 ? `drop-shadow(0px 0px 4px color-mix(in srgb, ${iconInfo.glow} 50%, transparent))` : 'none',
                  }} 
                  strokeLinecap="round" 
                  className="transition-all duration-1000 ease-[var(--ease-spring)]" 
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                {progressPct === 100 ? (
                  <CircleCheck className={`w-4 h-4 ${iconInfo.text}`} />
                ) : (
                  <span className={`text-caption-2 font-semibold font-mono ${progressPct > 0 ? iconInfo.text : 'text-neutral-500 dark:text-[#EBEBF599]'}`}>
                    {progressPct}%
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
});
