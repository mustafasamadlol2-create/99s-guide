import React, { memo } from "react";
import { motion } from "motion/react";

export interface SidebarNavItemProps {
  id: string;
  icon: React.ElementType;
  label: string;
  isActive: boolean;
  isAsideCollapsed: boolean;
  onClick: (id: string) => void;
  colorClass?: string;
  bgClass?: string;
  iconBadge?: React.ReactNode;
  rightBadge?: React.ReactNode;
  isTablet?: boolean;
}

// Same motion language as the iPhone floating tab bar: immediate response,
// soft landing, and no elastic overshoot. The sidebar itself remains fixed.
const itemVariants = {
  hidden: { opacity: 0, y: 4 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 330, damping: 31, mass: 0.7 },
  },
};

const indicatorTransition = {
  type: "spring" as const,
  stiffness: 360,
  damping: 31,
  mass: 0.72,
};

const contentTransition = {
  type: "spring" as const,
  stiffness: 360,
  damping: 31,
  mass: 0.68,
};

export const SidebarNavItem: React.FC<SidebarNavItemProps> = memo(
  function SidebarNavItem({
    id,
    icon: Icon,
    label,
    isActive,
    isAsideCollapsed,
    onClick,
    colorClass,
    bgClass,
    iconBadge,
    rightBadge,
  }) {
    const hasCustomColor = !!colorClass;
    const hasCustomBg = !!bgClass;

    const iconColorClass = isActive
      ? hasCustomColor
        ? ""
        : "text-neutral-900 dark:text-white"
      : hasCustomColor
        ? `${colorClass} opacity-75 group-hover:opacity-100`
        : "text-neutral-500 dark:text-[#EBEBF599] group-hover:text-neutral-700 dark:group-hover:text-neutral-200";

    const labelColorClass = isActive
      ? hasCustomColor
        ? ""
        : "text-neutral-900 dark:text-white"
      : hasCustomColor
        ? `${colorClass} opacity-75 group-hover:opacity-100`
        : "text-neutral-500 dark:text-[#EBEBF599] group-hover:text-neutral-700 dark:group-hover:text-neutral-200";

    return (
      <motion.div variants={itemVariants} className="sidebar-nav-item-wrap">
        <motion.button
          onClick={() => onClick(id)}
          aria-label={label}
          aria-current={isActive ? "page" : undefined}
          title={label}
          className={[
            "sidebar-nav-item relative flex items-center w-full border-none outline-none cursor-pointer",
            "z-0 antialiased rounded-2xl group min-h-[56px]",
            isAsideCollapsed ? "justify-center p-1" : "gap-3.5 px-3.5 py-1.5 text-left",
            "focus-visible:ring-2 focus-visible:ring-med-blue focus-visible:ring-offset-2",
            "dark:focus-visible:ring-offset-neutral-950",
            isActive
              ? `font-semibold ${hasCustomColor ? colorClass : "text-neutral-900 dark:text-white"}`
              : "font-medium",
          ].filter(Boolean).join(" ")}
          style={{ WebkitTapHighlightColor: "transparent" }}
          whileTap={{ scale: 0.965, opacity: 0.9 }}
          transition={{ type: "spring", stiffness: 420, damping: 32, mass: 0.62 }}
        >
          {/* Shared moving glass pill — mirrors the mobile active indicator. */}
          {isActive && (
            <motion.div
              layoutId="sidebar-active-pill"
              className={[
                "sidebar-active-indicator absolute pointer-events-none",
                hasCustomBg ? bgClass : "sidebar-active-indicator-neutral",
              ].filter(Boolean).join(" ")}
              initial={false}
              transition={indicatorTransition}
            />
          )}

          {/* Inactive hover/touch surface. */}
          {!isActive && (
            <span aria-hidden="true" className="sidebar-nav-hover-surface absolute pointer-events-none" />
          )}

          <div className="relative shrink-0 flex items-center justify-center z-10 w-11 h-11">
            <motion.div
              animate={{
                y: isActive ? -1 : 0,
                scale: isActive ? 1.045 : 1,
              }}
              transition={contentTransition}
              className="flex items-center justify-center"
            >
              <Icon
                className={[
                  "w-[25px] h-[25px] sidebar-nav-icon",
                  iconColorClass,
                ].filter(Boolean).join(" ")}
                strokeWidth={isActive ? 2.35 : 1.85}
              />
            </motion.div>
            {iconBadge}
          </div>

          {!isAsideCollapsed && (
            <motion.span
              animate={{
                opacity: isActive ? 1 : 0.82,
                y: isActive ? -0.5 : 0,
              }}
              transition={contentTransition}
              className={[
                "relative z-10 flex-1 truncate leading-none text-[16px] sidebar-nav-label",
                labelColorClass,
              ].filter(Boolean).join(" ")}
            >
              {label}
            </motion.span>
          )}

          {!isAsideCollapsed && rightBadge && (
            <motion.div
              animate={{ opacity: isActive ? 1 : 0.8, scale: isActive ? 1 : 0.98 }}
              transition={contentTransition}
              className="relative z-10 shrink-0"
            >
              {rightBadge}
            </motion.div>
          )}
        </motion.button>
      </motion.div>
    );
  },
);
