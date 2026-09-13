/**
 * One native iOS motion language for every touch swipe in 99's Guide.
 *
 * The reference is the approved Notifications/Settings -> Profile interactive
 * pop: direct 1:1 finger tracking, a firm over-damped completion spring, a
 * slightly firmer cancellation spring, a small live-underlay parallax and no
 * opacity handoff. Keep these values centralized so new swipe surfaces cannot
 * silently drift into a second animation style.
 */
export const IOS_SWIPE_MOTION = {
  // Recognition / commit character.
  commitProgress: 0.30,
  flickDistance: 32,
  velocityThreshold: 0.50, // px / ms
  axisLockDistance: 6,
  verticalRejectDistance: 18,

  // Axis/velocity filtering copied from the approved Notifications -> Profile
  // interactive pop. Every other swipe recognizer reads these exact values so
  // the app has one gesture character instead of subtly different pagers.
  verticalRejectRatio: 1.25,
  horizontalLockMaxVerticalRatio: 0.95,
  velocityPreviousWeight: 0.58,
  velocityCurrentWeight: 0.42,
  completionVelocityScreensPerSecond: 4.0,
  cancelVelocityScreensPerSecond: 1.6,

  // Parent-page reveal used by native pushed-page Back transitions.
  underlayOffset: 22,

  // Matches the approved Notifications/Settings completion.
  completionSpring: {
    type: "spring" as const,
    stiffness: 430,
    damping: 42,
    mass: 0.82,
    restSpeed: 18,
    restDelta: 0.45,
  },

  // Slightly firmer return when the gesture is cancelled.
  cancelSpring: {
    type: "spring" as const,
    stiffness: 520,
    damping: 46,
    mass: 0.78,
    restSpeed: 16,
    restDelta: 0.35,
  },

  // Native boundary rubber-band for pagers/action cells.
  boundaryResistance: 0.12,

  // Keep the whole outgoing page opaque; only a side separation shadow appears.
  layerShadowLtr: "-18px 0 30px -18px rgba(0,0,0,0.48)",
  layerShadowRtl: "18px 0 30px -18px rgba(0,0,0,0.48)",
} as const;


/**
 * Root-tab pager motion (Welcome / Modules / Schedule / Console / Profile).
 *
 * This intentionally does NOT use the short "content nudge" used by Console
 * filters. Root tabs behave like a native full-page pager: the outgoing page
 * tracks the finger 1:1, the adjacent page is already positioned beside it,
 * and release uses one short, non-bouncy deceleration. No scale, fade, card
 * choreography or haptic is part of this transition.
 */
export const IOS_MAIN_TAB_PAGER_MOTION = {
  ...IOS_SWIPE_MOTION,

  // Instagram/UIKit-style page selection: position wins at half a page, while
  // a decisive fling can still advance before the halfway mark.
  commitProgress: 0.50,
  velocityThreshold: 0.62, // px / ms
  flickDistance: 0,

  // Directional lock stays intentionally small so horizontal intent is picked
  // up quickly without stealing ordinary vertical scrolling.
  axisLockDistance: 6,
  verticalRejectDistance: 16,
  verticalRejectRatio: 1.22,
  horizontalLockMaxVerticalRatio: 0.82,

  // Keep the release velocity responsive. The latest sample carries most of the
  // weight so the spring begins with the same momentum the user's finger had.
  velocityPreviousWeight: 0.30,
  velocityCurrentWeight: 0.70,

  // UIKit-like edge rubber band. Small drags begin at roughly 0.5x finger
  // travel, then progressively resist larger pulls.
  boundaryResistance: 0.50,

  // Release is physics-driven, not duration/easing driven. These values are
  // very close to critically damped at mass 1, giving a fast, weighty settle
  // with effectively no visible bounce. Typical release-to-rest is ~250–300 ms.
  completionSpring: {
    type: "spring" as const,
    stiffness: 560,
    damping: 46,
    mass: 1,
    restSpeed: 0.12,
    restDelta: 0.004,
  },

  cancelSpring: {
    type: "spring" as const,
    stiffness: 620,
    damping: 50,
    mass: 1,
    restSpeed: 0.10,
    restDelta: 0.0035,
  },

  // Motion's spring velocity is expressed in animated units per second. Root
  // paging animates normalized progress, so this is a screen-widths/sec guard.
  // It prevents pathological touch samples from producing a visually explosive
  // launch while preserving the actual fling direction and momentum.
  maxSpringVelocityScreensPerSecond: 5.5,
} as const;


/**
 * Slightly softer release profile for nested Console pagers.
 * Recognition thresholds stay identical to the global iOS gesture, while the
 * settle curve is closer to critically damped UIKit paging so the page glides
 * into place instead of feeling like it snaps at finger-up. This profile is
 * intentionally scoped to Console + Role filters only.
 */
export const IOS_CONSOLE_SMOOTH_MOTION = {
  ...IOS_SWIPE_MOTION,

  // Keep more of the previous sample so tiny finger-speed spikes do not become
  // visible as a sudden acceleration when the spring takes over.
  velocityPreviousWeight: 0.72,
  velocityCurrentWeight: 0.28,
  completionVelocityScreensPerSecond: 3.2,
  cancelVelocityScreensPerSecond: 1.25,

  // Near-critical spring: quick, soft and non-bouncy, similar to UIKit paging.
  completionSpring: {
    type: "spring" as const,
    stiffness: 360,
    damping: 34,
    mass: 0.86,
    restSpeed: 10,
    restDelta: 0.22,
  },

  // Cancellation is a touch firmer so an aborted gesture returns cleanly
  // without oscillation, while still avoiding the previous mechanical snap.
  cancelSpring: {
    type: "spring" as const,
    stiffness: 420,
    damping: 38,
    mass: 0.84,
    restSpeed: 9,
    restDelta: 0.20,
  },

  // Local content pager tuning for All / Owner / Admin / Student.
  roleDragFactor: 0.40,
  roleDragMax: 52,
} as const;

export function getNativeSwipeLayerShadow(isRtl: boolean): string {
  return isRtl ? IOS_SWIPE_MOTION.layerShadowRtl : IOS_SWIPE_MOTION.layerShadowLtr;
}

/** Shadow for a foreground page leaving in the supplied physical X direction. */
export function getSwipeLayerShadowForExitSign(exitSign: 1 | -1): string {
  return exitSign > 0
    ? IOS_SWIPE_MOTION.layerShadowLtr
    : IOS_SWIPE_MOTION.layerShadowRtl;
}
