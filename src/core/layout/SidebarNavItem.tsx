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

const itemVariants = {
  hidden: { opacity: 0, x: -6 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { type: "spring" as const, stiffness: 400, damping: 32 },
  },
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
    isTablet,
  }) {
    const hasCustomColor = !!colorClass;
    const hasCustomBg = !!bgClass;

    const iconColorClass = isActive
      ? hasCustomColor
        ? ""                                    // inherits from button's colorClass
        : "text-neutral-900 dark:text-white"
      : hasCustomColor
        ? `${colorClass} opacity-70 group-hover:opacity-100`
        : "text-neutral-500 dark:text-[#EBEBF599] group-hover:text-neutral-700 dark:group-hover:text-neutral-300";

    const labelColorClass = isActive
      ? hasCustomColor
        ? ""                                    // inherits from button's colorClass
        : "text-neutral-900 dark:text-white"
      : hasCustomColor
        ? `${colorClass} opacity-70 group-hover:opacity-100`
        : "text-neutral-500 dark:text-[#EBEBF599] opacity-80 group-hover:opacity-100";

    return (
      <motion.div variants={itemVariants}>
        <button
          onClick={() => onClick(id)}
          aria-label={label}
          aria-current={isActive ? "page" : undefined}
          title={label}
          className={[
            // layout
            "relative flex items-center w-full border-none outline-none cursor-pointer",
            "z-0 antialiased rounded-xl group",
            isTablet ? "gap-3.5 min-h-[54px]" : "gap-3 min-h-[48px]",
            isAsideCollapsed
              ? isTablet ? "justify-center p-3.5" : "justify-center p-3"
              : "px-3 py-3 text-left",
            // focus ring
            "focus-visible:ring-2 focus-visible:ring-med-blue focus-visible:ring-offset-2",
            "dark:focus-visible:ring-offset-neutral-950",
            // active/inactive text color
            isActive
              ? `font-semibold ${hasCustomColor ? colorClass : "text-neutral-900 dark:text-white"}`
              : "font-medium",
            // subtle press feedback via CSS active state
            "active:scale-[0.965] active:opacity-[0.88]",
            "transition-transform duration-[80ms] ease-out",
          ].filter(Boolean).join(" ")}
        >
          {/* ── Animated sliding active background (shared layoutId → smooth pill slide) */}
          {isActive && (
            <motion.div
              layoutId="sidebar-active-pill"
              className={[
                "absolute inset-0 rounded-xl",
                hasCustomBg ? bgClass : "bg-neutral-200/80 dark:bg-white/[0.12]",
              ].filter(Boolean).join(" ")}
              initial={false}
              transition={{ type: "spring", stiffness: 350, damping: 30 }}
            />
          )}

          {/* ── Hover surface (inactive only) */}
          {!isActive && (
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100
                         bg-neutral-100/70 dark:bg-white/[0.05]
                         transition-opacity duration-150 ease-out"
            />
          )}


          {/* ── Icon */}
          <div
            className={`relative shrink-0 flex items-center justify-center z-10
              ${isTablet ? "w-10 h-10" : "w-8 h-8"}`}
          >
            <motion.div
              animate={{ scale: isActive ? 1.08 : 1 }}
              transition={{ type: "spring", stiffness: 420, damping: 22 }}
              className="flex items-center justify-center"
            >
              <Icon
                className={[
                  isTablet ? "w-[23px] h-[23px]" : "w-[20px] h-[20px]",
                  "transition-colors duration-200",
                  iconColorClass,
                ].filter(Boolean).join(" ")}
              />
            </motion.div>
            {iconBadge}
          </div>

          {/* ── Label */}
          {!isAsideCollapsed && (
            <span
              className={[
                "relative z-10 flex-1 truncate leading-none",
                isTablet ? "text-[15.5px]" : "text-[15px]",
                "transition-opacity duration-150",
                labelColorClass,
              ].filter(Boolean).join(" ")}
            >
              {label}
            </span>
          )}

          {/* ── Right badge */}
          {!isAsideCollapsed && rightBadge && (
            <div className="relative z-10 shrink-0">{rightBadge}</div>
          )}
        </button>
      </motion.div>
    );
  },
);
