import React, { memo } from "react";
import { motion } from "motion/react";
import { IOS_CONSOLE_SMOOTH_MOTION } from "../motion/swipeMotion";

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

/**
 * iPhone floating-tab item.
 *
 * The glass selector itself is owned once by App.tsx. Keeping it out of every
 * item avoids a Framer layoutId animation racing the root pager at swipe
 * handoff. The item is therefore responsible only for semantics + icon paint.
 */
export const TabBarItem: React.FC<TabBarItemProps> = memo(
  ({
    id,
    icon: Icon,
    label,
    isActive,
    isCompactHeight: _isCompactHeight,
    isEngaged = true,
    onClick,
    colorClass = "text-neutral-500 dark:text-[#EBEBF599]",
    activeColorClass = "text-med-blue dark:text-blue-400",
  }) => {
    return (
      <motion.button
        data-tab-id={id}
        onClick={() => onClick(id)}
        aria-label={label}
        aria-current={isActive ? "page" : undefined}
        className="ios-tabbar-item flex items-center justify-center h-full cursor-pointer relative select-none w-full outline-none"
        style={{ WebkitTapHighlightColor: "transparent" }}
        whileTap={{ scale: 0.965 }}
      >
        <div
          className={`relative z-10 flex items-center justify-center transition-colors duration-200 ${
            isActive ? activeColorClass : colorClass
          }`}
        >
          <motion.div
            className="ios-tabbar-icon-motion flex items-center justify-center"
            animate={{
              scale: isActive ? (isEngaged ? 1.045 : 1.02) : 1,
            }}
            transition={IOS_CONSOLE_SMOOTH_MOTION.completionSpring}
          >
            <Icon
              className="w-icon-lg h-icon-lg"
              strokeWidth={isActive ? 2.5 : 1.8}
            />
          </motion.div>
        </div>
      </motion.button>
    );
  },
);

TabBarItem.displayName = "TabBarItem";
