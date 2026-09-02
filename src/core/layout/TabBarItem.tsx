import React, { memo } from "react";

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
 * Phone tab item deliberately contains no transform/layout animation.
 *
 * The floating capsule itself is allowed to morph on scroll, but the icon,
 * label and hit target stay in one fixed slot. Selection is communicated only
 * through colour + a stationary glass surface, preventing the iOS/WKWebView
 * micro-jitter that appeared when several Motion transforms overlapped.
 */
export const TabBarItem: React.FC<TabBarItemProps> = memo(
  ({
    id,
    icon: Icon,
    label,
    isActive,
    isCompactHeight,
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
        className="ios-tabbar-item flex flex-col items-center justify-center cursor-pointer relative select-none w-full outline-none"
        style={{ WebkitTapHighlightColor: "transparent" }}
      >
        <div
          aria-hidden="true"
          className={`ios-tabbar-active-indicator absolute rounded-xl pointer-events-none ${
            isActive ? "ios-tabbar-active-indicator-visible" : "ios-tabbar-active-indicator-hidden"
          }`}
        />

        <div
          className={`ios-tabbar-icon-slot relative z-10 flex items-center justify-center ${
            isActive ? activeColorClass : colorClass
          }`}
        >
          <Icon
            className="w-icon-lg h-icon-lg"
            strokeWidth={2}
          />
        </div>

        <span
          className={`ios-tabbar-label-slot relative z-10 font-sans select-none ${
            isCompactHeight ? "ios-tabbar-label-compact-height" : ""
          } ${
            isActive ? activeColorClass : "text-neutral-500 dark:text-[#EBEBF599]"
          }`}
        >
          {label}
        </span>
      </button>
    );
  },
);
