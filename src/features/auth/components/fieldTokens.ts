/**
 * fieldTokens.ts — shared design tokens, spring presets, and the dark-mode
 * hook used by AnimatedField and any component that renders a field-like
 * element (e.g. the Academic Group select in AuthScreen).
 *
 * Lives in a separate file so that AnimatedField.tsx can export only its
 * React component and stay compatible with Vite Fast Refresh.
 */

import { useState, useEffect } from "react";

// ─── Dark-mode reactive hook ──────────────────────────────────────────────────

export function useDarkMode(): boolean {
  const [dark, setDark] = useState(
    () => document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const el  = document.documentElement;
    const obs = new MutationObserver(() =>
      setDark(el.classList.contains("dark")),
    );
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

// ─── State → visual token tables ─────────────────────────────────────────────
//
// Every value is a concrete CSS colour string so motion can interpolate
// smoothly between them via spring physics.

export const TOKENS = {
  light: {
    border: {
      idle:       "rgba(209,209,214,1)",
      hover:      "rgba(160,160,165,1)",
      focused:    "rgba(245,158,11,0.78)",
      typing:     "rgba(217,119,6,0.82)",
      filled:     "rgba(188,188,194,1)",
      valid:      "rgba(22,163,74,1)",
      invalid:    "rgba(220,38,38,1)",
      disabled:   "rgba(209,209,214,0.50)",
      loading:    "rgba(245,158,11,0.55)",
      autofilled: "rgba(245,158,11,0.62)",
    },
    shadow: {
      idle:       "0 1px 3px rgba(0,0,0,0.04), 0 0 0 0px rgba(0,0,0,0)",
      hover:      "0 2px 10px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.05)",
      focused:    "0 0 0 3.5px rgba(245,158,11,0.20), 0 2px 6px rgba(0,0,0,0.07)",
      typing:     "0 0 0 3.5px rgba(217,119,6,0.22),  0 2px 8px rgba(0,0,0,0.08)",
      filled:     "0 1px 4px rgba(0,0,0,0.05), 0 0 0 0px rgba(0,0,0,0)",
      valid:      "0 0 0 3.5px rgba(22,163,74,0.18),   0 2px 6px rgba(0,0,0,0.05)",
      invalid:    "0 0 0 3.5px rgba(220,38,38,0.18),   0 2px 6px rgba(0,0,0,0.07)",
      disabled:   "0 1px 2px rgba(0,0,0,0.02)",
      loading:    "0 0 0 3.5px rgba(245,158,11,0.14), 0 1px 4px rgba(0,0,0,0.05)",
      autofilled: "0 0 0 3.5px rgba(245,158,11,0.17), 0 1px 4px rgba(0,0,0,0.04)",
    },
    bg: {
      idle:       "rgba(242,242,247,1)",
      hover:      "rgba(236,236,241,1)",
      focused:    "rgba(242,242,247,1)",
      typing:     "rgba(242,242,247,1)",
      filled:     "rgba(242,242,247,1)",
      valid:      "rgba(240,253,244,1)",
      invalid:    "rgba(254,242,242,1)",
      disabled:   "rgba(246,246,251,1)",
      loading:    "rgba(242,242,247,1)",
      autofilled: "rgba(255,249,234,1)",
    },
    label: {
      idle:       "#6b6b70",
      hover:      "#48484c",
      focused:    "#b45309",   // amber-700 — 4.5:1 on white
      typing:     "#92400e",   // amber-800 — darker while typing
      filled:     "#48484c",
      valid:      "#15803d",   // green-700 — 4.5:1 on white
      invalid:    "#b91c1c",   // red-700   — 4.5:1 on white
      disabled:   "#c7c7cc",
      loading:    "#b45309",
      autofilled: "#92400e",
    },
    icon: {
      idle:       "#8e8e93",
      hover:      "#58585e",
      focused:    "#f59e0b",   // amber-400
      typing:     "#d97706",   // amber-500
      filled:     "#58585e",
      valid:      "#16a34a",   // green-600
      invalid:    "#dc2626",   // red-600
      disabled:   "#c7c7cc",
      loading:    "#f59e0b",
      autofilled: "#d97706",
    },
  },
  dark: {
    border: {
      idle:       "rgba(255,255,255,0.11)",
      hover:      "rgba(255,255,255,0.22)",
      focused:    "rgba(251,191,36,0.62)",
      typing:     "rgba(251,191,36,0.70)",
      filled:     "rgba(255,255,255,0.15)",
      valid:      "rgba(74,222,128,0.65)",
      invalid:    "rgba(248,113,113,0.80)",
      disabled:   "rgba(255,255,255,0.06)",
      loading:    "rgba(251,191,36,0.42)",
      autofilled: "rgba(251,191,36,0.52)",
    },
    shadow: {
      idle:       "0 1px 4px rgba(0,0,0,0.28), 0 0 0 0px rgba(0,0,0,0)",
      hover:      "0 2px 12px rgba(0,0,0,0.40), 0 1px 4px rgba(0,0,0,0.22)",
      focused:    "0 0 0 3.5px rgba(251,191,36,0.22), 0 2px 8px rgba(0,0,0,0.32)",
      typing:     "0 0 0 3.5px rgba(251,191,36,0.26), 0 2px 10px rgba(0,0,0,0.35)",
      filled:     "0 1px 4px rgba(0,0,0,0.28), 0 0 0 0px rgba(0,0,0,0)",
      valid:      "0 0 0 3.5px rgba(74,222,128,0.22),  0 2px 8px rgba(0,0,0,0.28)",
      invalid:    "0 0 0 3.5px rgba(248,113,113,0.22), 0 2px 8px rgba(0,0,0,0.32)",
      disabled:   "0 1px 2px rgba(0,0,0,0.15)",
      loading:    "0 0 0 3.5px rgba(251,191,36,0.18), 0 1px 6px rgba(0,0,0,0.28)",
      autofilled: "0 0 0 3.5px rgba(251,191,36,0.20), 0 1px 4px rgba(0,0,0,0.24)",
    },
    bg: {
      idle:       "rgba(44,44,46,1)",
      hover:      "rgba(52,52,54,1)",
      focused:    "rgba(48,46,42,1)",
      typing:     "rgba(50,47,42,1)",
      filled:     "rgba(44,44,46,1)",
      valid:      "rgba(28,44,32,1)",
      invalid:    "rgba(46,28,28,1)",
      disabled:   "rgba(36,36,38,1)",
      loading:    "rgba(44,44,46,1)",
      autofilled: "rgba(50,46,28,1)",
    },
    label: {
      idle:       "rgba(235,235,245,0.58)",
      hover:      "rgba(235,235,245,0.82)",
      focused:    "#fbbf24",   // amber-400
      typing:     "#fcd34d",   // amber-300
      filled:     "rgba(235,235,245,0.72)",
      valid:      "#4ade80",   // green-400
      invalid:    "#f87171",   // red-400
      disabled:   "rgba(235,235,245,0.28)",
      loading:    "#fbbf24",
      autofilled: "#fcd34d",
    },
    icon: {
      idle:       "rgba(235,235,245,0.48)",
      hover:      "rgba(235,235,245,0.72)",
      focused:    "#fbbf24",
      typing:     "#fcd34d",
      filled:     "rgba(235,235,245,0.65)",
      valid:      "#4ade80",
      invalid:    "#f87171",
      disabled:   "rgba(235,235,245,0.24)",
      loading:    "#fbbf24",
      autofilled: "#fcd34d",
    },
  },
} as const;

// ─── Spring / tween presets ───────────────────────────────────────────────────

/** Border + shadow + bg — spring with gentle overshoot */
export const WRAP_SPRING = { type: "spring", stiffness: 480, damping: 40, mass: 0.55 } as const;
/** Label / icon colour — faster tween, feels snappier */
export const COLOR_TWEEN = { type: "tween", duration: 0.20, ease: [0.25, 0.1, 0.25, 1] } as const;
