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

/**
 * iPhone floating-tab item.
 *
 * The visible phone bar is intentionally icon-only. `label` remains available
 * to VoiceOver through aria-label, while no text lane participates in layout.
 * Keeping the button geometry this simple is also important for WKWebView: the
 * active selector and icon no longer shift vertically when the shell changes
 * between its resting and engaged sizes.
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
        onClick={() => onClick(id)}
        aria-label={label}
        aria-current={isActive ? "page" : undefined}
        className="ios-tabbar-item flex items-center justify-center h-full cursor-pointer relative select-none w-full outline-none"
        style={{ WebkitTapHighlightColor: "transparent" }}
        whileTap={{ scale: 0.965 }}
      >
        {isActive && (
          <motion.div
            layoutId="ios_mobile_tab_indicator"
            className="ios-tabbar-active-indicator absolute pointer-events-none"
            initial={false}
            transition={{
              type: "spring",
              stiffness: 380,
              damping: 34,
              mass: 0.68,
            }}
          />
        )}

        <div
          className={`relative z-10 flex items-center justify-center transition-colors duration-300 ${
            isActive ? activeColorClass : colorClass
          }`}
        >
          {/* On iPhone this glyph keeps its layout footprint but its paint is
              mirrored by App's compositor-only icon layer. On non-phone
              surfaces it remains the visible icon. */}
          <motion.div
            className="ios-tabbar-icon-motion flex items-center justify-center"
            animate={{
              scale: isActive ? (isEngaged ? 1.045 : 1.02) : 1,
            }}
            transition={{ type: "spring", stiffness: 380, damping: 34, mass: 0.64 }}
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
