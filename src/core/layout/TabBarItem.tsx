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
        whileTap={{ scale: 0.965 }}
      >
        {/* Active Background Pill (Shared Layout Animation) */}
        {isActive && (
          <motion.div
            layoutId="ios_mobile_tab_indicator"
            className="ios-tabbar-active-indicator absolute rounded-xl pointer-events-none"
            initial={false}
            transition={{
              type: "spring",
              stiffness: 310,
              damping: 34,
              mass: 0.78
            }}
          />
        )}

        <div
          className={`relative z-10 flex items-center justify-center transition-colors duration-300 ${
            isActive ? activeColorClass : colorClass
          }`}
        >
          <motion.div
             // Only the newly-selected item gets a tiny iOS-style confirmation.
             // Deactivation is instantaneous, so sibling icons never wobble when
             // the route changes or when the outer capsule changes size.
             animate={isActive
               ? { y: [0, -1.25, 0], scale: [1, 1.055, 1] }
               : { y: 0, scale: 1 }}
             transition={isActive
               ? { duration: 0.34, ease: [0.32, 0.72, 0, 1] }
               : { duration: 0 }}
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
          transition={{ duration: 0.38, ease: [0.32, 0.72, 0, 1] }}
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
