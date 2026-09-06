/**
 * AppLogo — renders the official 99's Guide brand icon.
 *
 * Uses the real app icon images (/logo-light.png and /logo-dark.png) as the single source of truth
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
        className={`relative overflow-hidden ${circle ? "rounded-full" : radius} flex items-center justify-center shadow-elevation-3 shrink-0 flex-shrink-0 bg-transparent`}
        style={{ width, height: width, minWidth: width, minHeight: width }}
      >
        {/* Light mode logo (hidden in dark mode) */}
        <img
          src="/logo-light.png"
          alt="99's Guide"
          aria-hidden="true"
          draggable={false}
          decoding="async"
          className="w-full h-full object-cover block dark:hidden"
        />
        {/* Dark mode logo (hidden in light mode) */}
        <img
          src="/logo-dark.png"
          alt="99's Guide"
          aria-hidden="true"
          draggable={false}
          decoding="async"
          className="w-full h-full object-cover hidden dark:block"
        />
      </div>

      {!iconOnly && (
        <div 
          className={`mt-3 select-none ${darkTheme ? "text-white" : "text-neutral-800"}`}
          style={{ fontFamily: '"SF Pro Display", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}
        >
          <h1
            className="text-[#D5C7B5]"
            style={{
              fontSize: size === "xl" ? "1.5rem" : size === "lg" ? "1.15rem" : "0.85rem",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              lineHeight: 1
            }}
          >
            99's Guide
          </h1>
          {size !== "sm" && size !== "xs" && (
            <>
              <div className="flex items-center justify-center gap-2 my-1">
                <span className="h-[1px] w-8 bg-med-gold/30" />
                <span className="w-1.5 h-1.5 rounded-full bg-med-gold" />
                <span className="h-[1px] w-8 bg-med-gold/30" />
              </div>
              <p
                className="text-neutral-500 dark:text-[#EBEBF599]"
                style={{ 
                  fontWeight: 400,
                  letterSpacing: "0.04em",
                  fontSize: size === "xl" ? "0.85rem" : size === "lg" ? "0.75rem" : "0.6rem",
                  marginTop: "0.15rem"
                }}
              >
                Your Medical Study Guide
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
});

export default AppLogo;
