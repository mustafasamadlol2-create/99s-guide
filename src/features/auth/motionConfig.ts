/**
 * Premium motion system for authentication screens.
 * Inspired by Apple HIG, Linear, Arc Browser, and Notion.
 * All springs resolve well under 300ms effective duration.
 */

// ─── Spring presets ───────────────────────────────────────────────────────────

export const SP = {
  /** Soft logo entrance: scale 0.9 → 1 with gentle overshoot */
  logo:   { type: "spring" as const, stiffness: 280, damping: 26, mass: 0.8  },
  /** General content — form containers, cards */
  gentle: { type: "spring" as const, stiffness: 340, damping: 32, mass: 0.8  },
  /** Focus rings, borders, fast micro-interactions */
  snappy: { type: "spring" as const, stiffness: 500, damping: 38, mass: 0.7  },
  /** Button press feedback */
  tap:    { type: "spring" as const, stiffness: 600, damping: 42, mass: 0.6  },
  /** Layout shifts (card height resize) */
  layout: { type: "spring" as const, stiffness: 380, damping: 34, mass: 0.8  },
} as const;

// ─── Variant sets ─────────────────────────────────────────────────────────────

/** Auth card entrance */
export const CARD_V = {
  hidden:  { opacity: 0, scale: 0.96, y: 20 },
  visible: { opacity: 1, scale: 1,    y: 0  },
} as const;

/** Logo: scale 0.88 → 1 with spring */
export const LOGO_V = {
  hidden:  { opacity: 0, scale: 0.88 },
  visible: { opacity: 1, scale: 1    },
} as const;

/** Page container fade */
export const PAGE_V = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1 },
} as const;

/** Stagger parent — wrap a group of animated fields in this */
export const STAGGER_V = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.065, delayChildren: 0 } },
} as const;

/** Individual field: fade + slide up 10px with gentle spring */
export const FIELD_V = {
  hidden:  { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 340, damping: 32, mass: 0.8 },
  },
};

/** Error/notice panel: scale in from origin top */
export const ERROR_V = {
  hidden:  { opacity: 0, scaleY: 0.85, y: -10, originY: 0 },
  visible: { opacity: 1, scaleY: 1,    y: 0               },
  exit:    { opacity: 0, scaleY: 0.85, y: -8,  originY: 0 },
} as const;

/** Success state morph */
export const SUCCESS_V = {
  hidden:  { opacity: 0, scale: 0.88 },
  visible: { opacity: 1, scale: 1    },
  exit:    { opacity: 0, scale: 0.92 },
} as const;

// ─── Directional slide — for navigation between auth panels ──────────────────

/**
 * Returns enter/center/exit variants for a directional slide.
 * direction: 1 = forward (→), -1 = back (←)
 */
export function slideVariants(direction: number) {
  return {
    enter:  { opacity: 0, x: direction * 32 },
    center: { opacity: 1, x: 0             },
    exit:   { opacity: 0, x: direction * -20 },
  };
}

// ─── Mode ordering (for direction calculation) ────────────────────────────────

export type AuthMode = "login" | "register" | "forgot" | "sent";
export const MODE_IDX: Record<AuthMode, number> = {
  login: 0, register: 1, forgot: 2, sent: 3,
};
