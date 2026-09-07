/**
 * Unified motion language for the authentication surface.
 *
 * Major entrances and panel changes intentionally use one restrained iOS-like
 * fade/lift curve. Focus, press and layout micro-interactions keep dedicated
 * springs because they are feedback, not page choreography.
 */

export const IOS_AUTH_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const IOS_AUTH_TRANSITION = {
  type: "tween" as const,
  duration: 0.34,
  ease: IOS_AUTH_EASE,
} as const;

// ─── Motion presets ──────────────────────────────────────────────────────────

export const SP = {
  /** Same visual language as all auth entrances. */
  logo: IOS_AUTH_TRANSITION,
  /** Form/card/panel entrance and mode changes. */
  gentle: IOS_AUTH_TRANSITION,
  /** Focus rings, borders, fast micro-interactions. */
  snappy: { type: "spring" as const, stiffness: 500, damping: 38, mass: 0.7 },
  /** Button press feedback. */
  tap: { type: "spring" as const, stiffness: 600, damping: 42, mass: 0.6 },
  /** Layout-only size changes. */
  layout: { type: "spring" as const, stiffness: 380, damping: 34, mass: 0.8 },
} as const;

const HIDDEN = { opacity: 0, y: 10, scale: 0.992 } as const;
const VISIBLE = { opacity: 1, y: 0, scale: 1 } as const;
const EXIT = { opacity: 0, y: -5, scale: 0.996 } as const;

/** Auth card entrance. */
export const CARD_V = { hidden: HIDDEN, visible: VISIBLE, exit: EXIT } as const;

/** Logo uses the same restrained entrance instead of a separate scale spring. */
export const LOGO_V = { hidden: HIDDEN, visible: VISIBLE, exit: EXIT } as const;

/** Page container. */
export const PAGE_V = { hidden: HIDDEN, visible: VISIBLE, exit: EXIT } as const;

/** Tiny stagger keeps fields legible as a group without a cascading delay. */
export const STAGGER_V = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.018, delayChildren: 0 } },
} as const;

/** Individual field. */
export const FIELD_V = {
  hidden: HIDDEN,
  visible: { ...VISIBLE, transition: IOS_AUTH_TRANSITION },
  exit: EXIT,
} as const;

/** Notices use the same motion language; no scaleY/shake entrance. */
export const ERROR_V = { hidden: HIDDEN, visible: VISIBLE, exit: EXIT } as const;

/** Success panels use the same motion language. */
export const SUCCESS_V = { hidden: HIDDEN, visible: VISIBLE, exit: EXIT } as const;

/**
 * Auth navigation is intentionally non-directional. Moving every screen with
 * the same subtle lift avoids mixed left/right/fade patterns and is more stable
 * in WKWebView during rapid mode changes.
 */
export function slideVariants(_direction: number) {
  return { enter: HIDDEN, center: VISIBLE, exit: EXIT };
}

export type AuthMode = "login" | "register" | "forgot" | "sent";
export const MODE_IDX: Record<AuthMode, number> = {
  login: 0, register: 1, forgot: 2, sent: 3,
};
