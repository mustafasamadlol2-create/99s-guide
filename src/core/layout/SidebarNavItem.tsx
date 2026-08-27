import React, { memo } from "react";

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

/**
 * Sidebar navigation intentionally uses CSS-only, compositor-friendly motion.
 *
 * The previous shared-layout spring indicator looked attractive but forced
 * layout measurements while the sidebar width was changing. In Safari/WKWebView
 * (especially iPad) that competed with the main page reflow and made both tab
 * navigation and collapse/expand feel heavy. The active surface now settles
 * locally with opacity/transform only, while the sidebar remains a fixed rail.
 */
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
    const hasCustomColor = Boolean(colorClass);
    const hasCustomBg = Boolean(bgClass);

    const iconColorClass = isActive
      ? hasCustomColor
        ? colorClass
        : "text-neutral-900 dark:text-white"
      : hasCustomColor
        ? `${colorClass} opacity-75 group-hover:opacity-100`
        : "text-neutral-500 dark:text-[#EBEBF599] group-hover:text-neutral-700 dark:group-hover:text-neutral-200";

    const labelColorClass = isActive
      ? hasCustomColor
        ? colorClass
        : "text-neutral-900 dark:text-white"
      : hasCustomColor
        ? `${colorClass} opacity-75 group-hover:opacity-100`
        : "text-neutral-500 dark:text-[#EBEBF599] group-hover:text-neutral-700 dark:group-hover:text-neutral-200";

    return (
      <div className="sidebar-nav-item-wrap">
        <button
          type="button"
          onClick={() => onClick(id)}
          aria-label={label}
          aria-current={isActive ? "page" : undefined}
          title={label}
          className={[
            "sidebar-nav-item relative flex items-center w-full border-none outline-none cursor-pointer",
            "z-0 antialiased rounded-2xl group min-h-[56px]",
            isAsideCollapsed
              ? "sidebar-nav-item-collapsed justify-center p-1"
              : "sidebar-nav-item-expanded gap-3.5 px-3.5 py-1.5 text-left",
            "focus-visible:ring-2 focus-visible:ring-med-blue focus-visible:ring-offset-2",
            "dark:focus-visible:ring-offset-neutral-950",
            isActive
              ? `sidebar-nav-item-active font-semibold ${
                  hasCustomColor ? colorClass : "text-neutral-900 dark:text-white"
                }`
              : "font-medium",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{ WebkitTapHighlightColor: "transparent" }}
        >
          <span
            aria-hidden="true"
            className={[
              "sidebar-active-indicator absolute pointer-events-none",
              hasCustomBg ? bgClass : "sidebar-active-indicator-neutral",
              isActive
                ? "sidebar-active-indicator-visible"
                : "sidebar-active-indicator-hidden",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="sidebar-active-indicator-sheen" />
          </span>

          <span
            aria-hidden="true"
            className={[
              "sidebar-nav-hover-surface absolute pointer-events-none",
              isActive ? "sidebar-nav-hover-surface-suppressed" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          />

          <div className="sidebar-nav-icon-slot relative shrink-0 flex items-center justify-center z-10 w-11 h-11">
            <div className="sidebar-nav-icon-motion flex items-center justify-center">
              <Icon
                className={[
                  "w-[25px] h-[25px] sidebar-nav-icon",
                  iconColorClass,
                ]
                  .filter(Boolean)
                  .join(" ")}
                strokeWidth={isActive ? 2.3 : 1.85}
              />
            </div>
            {iconBadge}
          </div>

          {!isAsideCollapsed && (
            <span
              className={[
                "relative z-10 flex-1 truncate leading-none text-[16px] sidebar-nav-label",
                labelColorClass,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {label}
            </span>
          )}

          {!isAsideCollapsed && rightBadge && (
            <div className="sidebar-nav-right-badge relative z-10 shrink-0">
              {rightBadge}
            </div>
          )}
        </button>
      </div>
    );
  },
);
