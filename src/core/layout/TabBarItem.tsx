import React, { memo } from "react";

export interface TabBarItemProps {
  id: string;
  icon: React.ElementType;
  label: string;
  isActive: boolean;
  isCompactHeight: boolean;
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
    onClick,
    colorClass = "text-neutral-500 dark:text-[#EBEBF599]",
    activeColorClass = "text-med-blue",
  }) => {
    return (
      <button
        onClick={() => onClick(id)}
        aria-label={label}
        aria-current={isActive ? "page" : undefined}
        className="flex flex-col items-center justify-center h-full cursor-pointer relative select-none w-full"
      >
        <div
          className={`relative flex items-center justify-center ${
            isActive ? activeColorClass : colorClass
          }`}
        >
          <Icon
            className="w-icon-lg h-icon-lg"
            strokeWidth={isActive ? 2.2 : 1.5}
          />
        </div>
        <span
          className={`mt-1 font-sans select-none ${isCompactHeight ? "hidden" : "block"} ${
            isActive
              ? `${activeColorClass} font-medium text-caption-2`
              : "text-neutral-500 dark:text-[#EBEBF599] font-medium text-caption-2"
          }`}
        >
          {label}
        </span>
      </button>
    );
  },
);
