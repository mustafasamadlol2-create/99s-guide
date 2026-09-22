/**
 * AppLogo — renders the official 99's Guide brand icon.
 *
 * The selected device App Icon is shared with the in-app logo so the My 99
 * selector has a visible effect on every platform. The primary/original choice
 * keeps the established light/dark brand behavior; alternate choices use the
 * same official mark with their selected treatment.
 */
import React, { memo, useEffect, useState } from "react";
import {
  APP_ICON_CHANGE_EVENT,
  getAppIconAssetSrc,
  getStoredAppIconId,
} from "../../features/personalization/appIcon/appIconClient";
import type { AppIconId } from "../../features/personalization/appIcon/appIconTypes";

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
  const [appIconId, setAppIconId] = useState<AppIconId>(() => getStoredAppIconId());

  useEffect(() => {
    const refresh = () => setAppIconId(getStoredAppIconId());
    window.addEventListener(APP_ICON_CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(APP_ICON_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const alternateIconSrc = appIconId === "primary" ? null : getAppIconAssetSrc(appIconId);

  return (
    <div className={`flex flex-col items-center justify-center text-center shrink-0 flex-shrink-0 select-none ${className}`}>
      {/* Icon container — clips to circle or rounded rect */}
      <div
        className={`relative overflow-hidden ${circle ? "rounded-full" : radius} flex items-center justify-center shadow-elevation-3 shrink-0 flex-shrink-0 bg-transparent`}
        style={{ width, height: width, minWidth: width, minHeight: width }}
      >
        {alternateIconSrc ? (
          <img
            src={alternateIconSrc}
            alt="99's Guide"
            aria-hidden="true"
            draggable={false}
            decoding="async"
            className="block h-full w-full object-cover"
          />
        ) : (
          <>
            {/* Primary choice preserves the official adaptive light/dark mark. */}
            <img
              src="/logo-light.png"
              alt="99's Guide"
              aria-hidden="true"
              draggable={false}
              decoding="async"
              className="w-full h-full object-cover block dark:hidden"
            />
            <img
              src="/logo-dark.png"
              alt="99's Guide"
              aria-hidden="true"
              draggable={false}
              decoding="async"
              className="w-full h-full object-cover hidden dark:block"
            />
          </>
        )}
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
