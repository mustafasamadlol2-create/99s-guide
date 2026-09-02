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
        {/* One shared glass selection surface gives the original premium
            left/right travel between tabs. It animates only when selection
            changes; the scroll-driven shell resize is handled independently. */}
        {isActive && (
          <motion.div
            layoutId="ios_mobile_tab_indicator"
            className="ios-tabbar-active-indicator absolute rounded-xl pointer-events-none"
            initial={false}
            transition={{
              type: "spring",
              stiffness: 320,
              damping: 35,
              mass: 0.76,
            }}
          />
        )}

        <div
          className={`relative z-10 flex items-center justify-center transition-colors duration-300 ${
            isActive ? activeColorClass : colorClass
          }`}
        >
          <motion.div
            className="ios-tabbar-icon-motion"
            animate={
              isActive
                ? { y: [0, -1.15, 0], scale: [1, 1.045, 1] }
                : { y: 0, scale: 1 }
            }
            transition={
              isActive
                ? { duration: 0.32, ease: [0.32, 0.72, 0, 1] }
                : { duration: 0 }
            }
          >
            <Icon
              className="w-icon-lg h-icon-lg"
              strokeWidth={isActive ? 2.5 : 1.8}
            />
          </motion.div>
        </div>

        <motion.span
          // The label keeps a constant layout slot in both bar sizes. Only its
          // opacity changes, so hiding text never re-centres the icon mid-resize.
          animate={{
            opacity: !isCompactHeight && isEngaged ? (isActive ? 1 : 0.8) : 0,
          }}
          transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
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
