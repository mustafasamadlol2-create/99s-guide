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
      <motion.button
        onClick={() => onClick(id)}
        aria-label={label}
        aria-current={isActive ? "page" : undefined}
        className="ios-tabbar-item flex flex-col items-center justify-center h-full cursor-pointer relative select-none w-full outline-none"
        style={{ WebkitTapHighlightColor: "transparent" }}
        whileTap={{ scale: 0.92 }}
      >
        {/* Active Background Pill (Shared Layout Animation) */}
        {isActive && (
          <motion.div
            layoutId="ios_mobile_tab_indicator"
            className="ios-tabbar-active-indicator absolute rounded-xl pointer-events-none"
            initial={false}
            transition={{
              type: "spring",
              stiffness: 450,
              damping: 32,
              mass: 0.8
            }}
          />
        )}

        <div
          className={`relative z-10 flex items-center justify-center transition-colors duration-300 ${
            isActive ? activeColorClass : colorClass
          }`}
        >
          <motion.div
             animate={{ 
               y: isActive && !isCompactHeight && isEngaged ? -2 : 0,
               scale: isActive ? (isEngaged ? 1.05 : 1.02) : 1
             }}
             transition={{ type: "spring", stiffness: 450, damping: 30 }}
          >
            <Icon
              className="w-icon-lg h-icon-lg"
              strokeWidth={isActive ? 2.5 : 1.8}
            />
          </motion.div>
        </div>
        <motion.span
          animate={{ 
            opacity: !isCompactHeight && isEngaged ? (isActive ? 1 : 0.8) : 0,
            y: !isCompactHeight && isEngaged ? (isActive ? -1 : 0) : 4,
            height: !isCompactHeight && isEngaged ? "auto" : 0,
            marginTop: !isCompactHeight && isEngaged ? 2 : 0
          }}
          transition={{ type: "spring", stiffness: 450, damping: 30 }}
          className={`relative z-10 overflow-hidden font-sans select-none transition-colors duration-300 ${isCompactHeight ? "hidden" : "block"} ${
            isActive
              ? `${activeColorClass} font-semibold text-[10.5px]`
              : "text-neutral-500 dark:text-[#EBEBF599] font-medium text-[10.5px]"
          }`}
        >
          {label}
        </motion.span>
      </motion.button>
    );
  },
);
