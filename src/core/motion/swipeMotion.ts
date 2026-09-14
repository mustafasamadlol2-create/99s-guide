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
 * Root paging is deliberately a different implementation from the short
 * content nudges used inside Console. The interactive phase is 1:1 with the
 * finger; release is generated from real spring physics and then executed as
 * compositor keyframes (WAAPI) so React/JS does not have to paint each snap
 * frame.  The numbers below are slightly softer than the previous rigid spring
 * while remaining critically damped: fast, weighty and without visible bounce.
 */
export const IOS_MAIN_TAB_PAGER_MOTION = {
  ...IOS_SWIPE_MOTION,

  // Instagram/UIKit-style page selection: position wins at half a page, while
  // a decisive fling can still advance before the halfway mark.
  commitProgress: 0.50,
  velocityThreshold: 0.56, // px / ms
  flickDistance: 0,

  // Directional lock stays intentionally small so horizontal intent is picked
  // up quickly without stealing ordinary vertical scrolling.
  axisLockDistance: 5,
  verticalRejectDistance: 18,
  verticalRejectRatio: 1.25,
  horizontalLockMaxVerticalRatio: 0.96,

  // Keep the release velocity responsive. The latest sample carries most of the
  // weight so the spring begins with the same momentum the user's finger had.
  velocityPreviousWeight: 0.26,
  velocityCurrentWeight: 0.74,

  // UIKit-like edge rubber band. Small drags begin at roughly 0.5x finger
  // travel, then progressively resist larger pulls.
  boundaryResistance: 0.50,

  // Near-critical release. Previous stiffness was 560; this softer 500 spring
  // glides instead of snapping rigidly, while damping ~= 2*sqrt(k*m) prevents
  // oscillation. maxDurationMs is a safety ceiling, not a cubic duration.
  completionSpring: {
    type: "spring" as const,
    stiffness: 470,
    damping: 43.4,
    mass: 1,
    restSpeed: 0.18,
    restDelta: 0.005,
    maxDurationMs: 300,
  },

  cancelSpring: {
    type: "spring" as const,
    stiffness: 500,
    damping: 44.7,
    mass: 1,
    restSpeed: 0.16,
    restDelta: 0.004,
    maxDurationMs: 290,
  },

  // Motion velocity is normalized to screen-widths/sec for the page spring.
  maxSpringVelocityScreensPerSecond: 5.0,

  // Browser spring samples are generated at 120 Hz and handed to WAAPI. The
  // browser can interpolate those transform keyframes on its compositor thread
  // on both 60 Hz and ProMotion/120 Hz displays.
  compositorSampleRate: 120,
} as const;

export type CompositorSpringConfig = {
  stiffness: number;
  damping: number;
  mass: number;
  restSpeed?: number;
  restDelta?: number;
  maxDurationMs?: number;
};

export type SampledSpring = {
  values: number[];
  offsets: number[];
  durationMs: number;
};

/**
 * Pre-sample a physical damped spring for Web Animations.
 *
 * The interactive drag itself still comes directly from touch input; this is
 * only for finger-up.  Sampling once at release means the browser receives a
 * transform-only keyframe animation and can run the settle on the compositor
 * rather than asking React/Motion to update application state every frame.
 */
export function sampleCompositorSpring(
  from: number,
  to: number,
  initialVelocity: number,
  config: CompositorSpringConfig,
  sampleRate = IOS_MAIN_TAB_PAGER_MOTION.compositorSampleRate,
): SampledSpring {
  const safeRate = Math.max(60, Math.min(240, sampleRate));
  const dt = 1 / safeRate;
  const maxDurationMs = Math.max(180, config.maxDurationMs ?? 320);
  const maxSteps = Math.max(2, Math.ceil((maxDurationMs / 1000) * safeRate));
  const restSpeed = Math.max(0.0001, config.restSpeed ?? 0.18);
  const restDelta = Math.max(0.00001, config.restDelta ?? 0.005);
  const minSettleSeconds = 0.14;

  let x = from;
  let v = Number.isFinite(initialVelocity) ? initialVelocity : 0;
  let elapsed = 0;

  const values: number[] = [from];
  const times: number[] = [0];
  const direction = Math.sign(to - from);

  for (let step = 1; step <= maxSteps; step += 1) {
    const springForce = -config.stiffness * (x - to);
    const dampingForce = -config.damping * v;
    const acceleration = (springForce + dampingForce) / Math.max(0.001, config.mass);

    // Semi-implicit Euler is stable for this short critically-damped interval
    // and preserves the supplied release velocity better than an easing curve.
    v += acceleration * dt;
    x += v * dt;
    elapsed += dt;

    // Instagram/UIKit does not visibly bounce past the neighboring page. If a
    // large fling would mathematically overshoot, land exactly on the page and
    // finish there rather than exposing a rubbery rebound.
    if (direction !== 0 && Math.sign(to - x) !== direction) {
      x = to;
      v = 0;
    }

    values.push(x);
    times.push(elapsed);

    if (
      elapsed >= minSettleSeconds &&
      Math.abs(to - x) <= restDelta &&
      Math.abs(v) <= restSpeed
    ) {
      break;
    }
  }

  // Always end on the exact pixel/page target. This avoids a 0.2px residual
  // transform that can keep text rasterized on a half-pixel in WKWebView.
  if (values[values.length - 1] !== to) {
    const maxDurationSeconds = maxDurationMs / 1000;
    if (elapsed >= maxDurationSeconds - dt * 0.5) {
      values[values.length - 1] = to;
    } else {
      values.push(to);
      times.push(Math.min(maxDurationSeconds, elapsed + dt));
    }
  }

  const durationSeconds = Math.max(dt, times[times.length - 1]);
  const durationMs = Math.max(1, Math.round(durationSeconds * 1000));
  const offsets = times.map((time, index) =>
    index === times.length - 1 ? 1 : Math.max(0, Math.min(1, time / durationSeconds)),
  );

  return { values, offsets, durationMs };
}

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
