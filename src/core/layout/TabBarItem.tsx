import React, { memo } from "react";
import { motion } from "motion/react";

export interface TabBarItemProps {
  id: string;
  icon: React.ElementType;
  label: string;
  isActive: boolean;
  isCompactHeight: boolean;
  isEngaged?: boolean;
  onClick: (id: string) => void;
  colorClass?: string;
  activeColorClass?: string;
}

export const TabBarItem: React.FC<TabBarItemProps> = memo(
  ({
    id,
    icon: Icon,
    label,
    isActive,
    isCompactHeight,
    isEngaged = true,
    onClick,
    colorClass = "text-neutral-500 dark:text-[#EBEBF599]",
    activeColorClass = "text-med-blue dark:text-blue-400",
  }) => {
    return (
      <button
        type="button"
        onClick={() => onClick(id)}
        aria-label={label}
        aria-current={isActive ? "page" : undefined}
        className="ios-tabbar-item flex flex-col items-center justify-center h-full cursor-pointer relative select-none w-full outline-none"
        style={{ WebkitTapHighlightColor: "transparent" }}
      >
        {/* Keep the active surface absolute and local to its slot. Avoiding
            shared-layout projection means a bar resize never re-projects the
            indicator across sibling tabs. */}
        {isActive && (
          <motion.div
            className="ios-tabbar-active-indicator absolute rounded-xl pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
          />
        )}

        <div
          className={`relative z-10 flex items-center justify-center transition-colors duration-300 ${
            isActive ? activeColorClass : colorClass
          }`}
        >
          {/* The icon never receives scale/y animation. It is allowed to move
              only as part of the parent bar's continuous resize, eliminating
              the vibration caused by overlapping item + shell transforms. */}
          <Icon
            className="w-icon-lg h-icon-lg"
            strokeWidth={isActive ? 2.5 : 1.8}
          />
        </div>

        <motion.span
          // Keep a constant 12px layout slot in both engaged/resting states.
          // Only opacity animates; height/margins do not collapse, so the icon
          // is not repeatedly re-centered mid-resize.
          animate={{
            opacity: !isCompactHeight && isEngaged ? (isActive ? 1 : 0.8) : 0,
          }}
          transition={{ duration: 0.34, ease: [0.32, 0.72, 0, 1] }}
          className={`relative z-10 h-[12px] min-h-[12px] mt-0.5 leading-[12px] overflow-hidden font-sans select-none transition-colors duration-300 ${
            isCompactHeight ? "hidden" : "block"
          } ${
            isActive
              ? `${activeColorClass} font-semibold text-[10.5px]`
              : "text-neutral-500 dark:text-[#EBEBF599] font-medium text-[10.5px]"
          }`}
        >
          {label}
        </motion.span>
      </button>
    );
  },
);
