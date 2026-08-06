/**
 * AppLogo — renders the official 99's Guide brand icon.
 *
 * Uses the real app icon image (/app_icon.jpg) as the single source of truth
 * so every logo in the app always matches the official branding exactly.
 */

import React, { memo } from "react";

// ─── Size map ─────────────────────────────────────────────────────────────────
const PIXEL_SIZES = {
  xs: { width: 36,  radius: "rounded-lg", text: "text-caption" },
  sm: { width: 50,  radius: "rounded-md", text: "text-caption" },
  md: { width: 80,  radius: "rounded-md", text: "text-caption" },
  lg: { width: 140, radius: "rounded-lg", text: "text-body"    },
  xl: { width: 220, radius: "rounded-lg", text: "text-body"    },
} as const;

interface AppLogoProps {
  className?: string;
  size?: keyof typeof PIXEL_SIZES;
  darkTheme?: boolean;
  iconOnly?: boolean;
  circle?: boolean;
}

const AppLogo = memo(function AppLogo({
  className = "",
  size      = "md",
  darkTheme = true,
  iconOnly  = false,
  circle    = false,
}: AppLogoProps) {
  const { width, radius } = PIXEL_SIZES[size];

  return (
    <div className={`flex flex-col items-center justify-center text-center shrink-0 flex-shrink-0 select-none ${className}`}>
      {/* Icon container — clips to circle or rounded rect */}
      <div
        className={`relative overflow-hidden ${circle ? "rounded-full" : radius} flex items-center justify-center shadow-elevation-3 shrink-0 flex-shrink-0`}
        style={{ width, height: width, minWidth: width, minHeight: width }}
      >
        <img
          src="/app_icon.jpg"
          alt="99's Guide"
          aria-hidden="true"
          draggable={false}
          decoding="async"
          className="w-full h-full object-cover"
          style={{ display: "block" }}
        />
      </div>

      {!iconOnly && (
        <div className={`mt-3 select-none ${darkTheme ? "text-white" : "text-neutral-800"}`}>
          <h1
            className="font-display font-semibold text-[#D5C7B5]"
            style={{
              fontSize: size === "xl" ? "1.5rem" : size === "lg" ? "1.15rem" : "0.85rem",
            }}
          >
            99's Guide
          </h1>

          {size !== "sm" && size !== "xs" && (
            <>
              <div className="flex items-center justify-center gap-2 my-1">
                <span className="h-0 w-8 bg-med-gold/30" />
                <span className="w-2 h-2 rounded-full bg-med-gold" />
                <span className="h-0 w-8 bg-med-gold/30" />
              </div>
              <p
                className="text-caption sm:text-caption uppercase text-neutral-500 dark:text-[#EBEBF599] font-medium"
                style={{ letterSpacing: "0.2em" }}
              >
                Your Guide To Success
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
});

export default AppLogo;
