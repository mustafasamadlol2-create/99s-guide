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
 * The live gesture is a 1:1 MotionValue transform and never changes React
 * state. Release uses one slightly-overdamped spring for both the page and the
 * floating selector. Values are expressed in the units Motion expects for a
 * pixel MotionValue (restSpeed is px/s, restDelta is px).
 */
export const IOS_MAIN_TAB_PAGER_MOTION = {
  ...IOS_SWIPE_MOTION,

  // UIKit-like intent recognition. The live pan remains strictly 1:1, but the
  // user no longer has to drag a large fraction of the display before release.
  // A small, deliberate displacement can commit on position alone and an even
  // shorter flick commits from its predicted end position. Axis locking below
  // remains the guard against accidental diagonal/vertical touches.
  commitProgress: 0.10,
  shortCommitDistance: 20,
  velocityThreshold: 0.12, // px / ms
  flickDistance: 5,
  releaseProjectionMs: 220,
  projectedCommitProgress: 0.08,

  // Fast directional lock without stealing normal vertical scroll.
  axisLockDistance: 3,
  verticalRejectDistance: 18,
  verticalRejectRatio: 1.25,
  horizontalLockMaxVerticalRatio: 0.96,

  // Smooth the release estimate across adjacent samples. A 50/50-ish low
  // pass keeps short flick intent intact (thresholds below are intentionally
  // permissive) while removing the last-sample jitter that can make a 60/120
  // Hz release feel like a web snap rather than a UIKit settle.
  velocityPreviousWeight: 0.48,
  velocityCurrentWeight: 0.52,

  // Requested edge resistance.
  boundaryResistance: 0.50,

  // UIKit-like critically damped settle. The previous very-high stiffness was
  // fast but could look like a CSS/web snap at finger-up. This pair keeps the
  // same quick navigation character while spreading acceleration over a few
  // more display frames, which reads substantially smoother on both 60 Hz and
  // 120 Hz panels without adding visible bounce.
  completionSpring: {
    type: "spring" as const,
    stiffness: 850,
    damping: 53,
    mass: 0.82,
    restSpeed: 28,
    restDelta: 0.40,
  },

  cancelSpring: {
    type: "spring" as const,
    stiffness: 980,
    damping: 56,
    mass: 0.78,
    restSpeed: 27,
    restDelta: 0.34,
  },

  // Clamp pathological touch velocity without flattening normal flings.
  maxSpringVelocityScreensPerSecond: 4.8,
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

  velocityPreviousWeight: 0.72,
  velocityCurrentWeight: 0.28,
  completionVelocityScreensPerSecond: 3.2,
  cancelVelocityScreensPerSecond: 1.25,

  completionSpring: {
    type: "spring" as const,
    stiffness: 360,
    damping: 34,
    mass: 0.86,
    restSpeed: 10,
    restDelta: 0.22,
  },

  cancelSpring: {
    type: "spring" as const,
    stiffness: 420,
    damping: 38,
    mass: 0.84,
    restSpeed: 9,
    restDelta: 0.20,
  },

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
