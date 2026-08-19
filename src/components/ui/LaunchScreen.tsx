/**
 * LaunchScreen — 99's Guide launch transition.
 *
 * Choreography:
 *   T +040 ms  Glow expands    scale 0.75→1.00, opacity 0→1  (1 600 ms, dark only)
 *   T +050 ms  Logo appears    scale 0.90→1.00, opacity 0→1  (  600 ms)
 *   T +750 ms  Tagline appears translateY 8→0,  opacity 0→1  (  500 ms)
 *   T 2200 ms  Exit            opacity 1→0, scale 1→1.05     (  200 ms)
 *   T 2400 ms  Unmount
 *
 * GPU strategy — what makes this compositor-thread-only on every frame:
 *
 *   1. `perspective` on the wrapper creates a 3-D rendering context so every
 *      direct child with `translateZ(0)` gets its own dedicated GPU layer
 *      *before* any animation frame fires.  No layer-promotion cost mid-flight.
 *
 *   2. `backface-visibility: hidden` on every animated element is the single
 *      most effective hint on WebKit / WKWebView.  It forces the element onto
 *      the GPU compositor immediately and prevents the "checkerboard" flicker
 *      that appears when Safari promotes a layer late.
 *
 *   3. Only `opacity` and `transform` are ever animated.  These are the two
 *      properties that bypass the main thread entirely and run on the
 *      compositor.  No filter, no colour, no layout property is touched.
 *
 *   4. Exit is one single WAAPI call with both properties in the same keyframe
 *      array.  One Animation object = one compositor task = zero sync jitter.
 *
 *   5. `will-change` is declared upfront on every element that will animate so
 *      the browser allocates GPU memory before the first frame — not at the
 *      start of the animation when it would cause a frame drop.
 */

import React, { useEffect, useRef, memo } from "react";
import AppLogo from "./AppLogo";

/* ─── Visual-viewport offset correction ───────────────────────────────────────
   On iPad Landscape in Safari, the address bar offsets the visual viewport from
   the layout viewport (visualViewport.offsetTop > 0).  `position:fixed; inset:0`
   fills the *layout* viewport, so without correction the logo flex-centers in
   the layout viewport — appearing shifted upward by the browser chrome height.

   We compute a one-time `translateY` that moves the wrapper so its flex-center
   lands in the *visual* viewport center.  The formula:
     offset = vvp.offsetTop + (layoutH - vvp.height) / 2
   where layoutH = window.innerHeight (layout viewport height).
   This is compositor-only — no layout recalc, no frame drop.
   Falls back to 0 on SSR or if visualViewport is unavailable.                  */

const _getVvOffsetCorrection = (): string => {
  if (typeof window === "undefined") return "translateZ(0)";
  const vvp = window.visualViewport;
  if (!vvp || vvp.height < 1) return "translateZ(0)";
  const layoutH = window.innerHeight || vvp.height;
  const dy = Math.round(vvp.offsetTop + (layoutH - vvp.height) / 2);
  return dy !== 0
    ? `translateY(${dy}px) translateZ(0)`
    : "translateZ(0)";
};

/* ─── CSS injection ────────────────────────────────────────────────────────────
   Runs synchronously at module load — before React renders a single frame —
   so the compositor already has the keyframe definitions when it paints frame 1.
   Guarded by ID so HMR hot-reloads never duplicate the tag.                    */

if (typeof document !== "undefined") {
  const TAG_ID = "ls-v4";
  if (!document.getElementById(TAG_ID)) {
    const el   = document.createElement("style");
    el.id      = TAG_ID;
    /* Every keyframe uses the same ease-out-quart curve:
       cubic-bezier(0.25, 0.46, 0.45, 0.94)
       → starts immediately, decelerates to a natural rest; no overshoot.
       `-webkit-` variants included for full WKWebView / Safari compatibility. */
    el.textContent = `
      @keyframes ls-in {
        from { opacity: 0; transform: scale(0.90) translateZ(0); }
        to   { opacity: 1; transform: scale(1.00) translateZ(0); }
      }
      @-webkit-keyframes ls-in {
        from { opacity: 0; -webkit-transform: scale(0.90) translateZ(0); }
        to   { opacity: 1; -webkit-transform: scale(1.00) translateZ(0); }
      }
      @keyframes ls-up {
        from { opacity: 0; transform: translateY(8px) translateZ(0); }
        to   { opacity: 1; transform: translateY(0px) translateZ(0); }
      }
      @-webkit-keyframes ls-up {
        from { opacity: 0; -webkit-transform: translateY(8px) translateZ(0); }
        to   { opacity: 1; -webkit-transform: translateY(0px) translateZ(0); }
      }
      @keyframes ls-glow {
        from { opacity: 0; transform: scale(0.75) translateZ(0); }
        to   { opacity: 1; transform: scale(1.00) translateZ(0); }
      }
      @-webkit-keyframes ls-glow {
        from { opacity: 0; -webkit-transform: scale(0.75) translateZ(0); }
        to   { opacity: 1; -webkit-transform: scale(1.00) translateZ(0); }
      }
      .ls-tag {
        font-family:         "SF Pro Display", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size:           13px;
        font-weight:         400;
        letter-spacing:      0.04em;
        text-transform:      none;
        line-height:         1;
        user-select:         none;
        -webkit-user-select: none;
      }
      @media (min-width: 640px)  { .ls-tag { font-size: 13.5px; } }
      @media (min-width: 1024px) { .ls-tag { font-size: 14px; letter-spacing: 0.20em; } }
    `;
    document.head.appendChild(el);
  }
}

/* ─── Timing constants ─────────────────────────────────────────────────────── */

const EO = "cubic-bezier(0.25,0.46,0.45,0.94)"; // ease-out-quart, every entrance

const GLOW_DELAY   =   40;
const GLOW_DUR     = 1_600;
const LOGO_DELAY   =   50;
const LOGO_DUR     =  600;
const TITLE_DELAY  = LOGO_DELAY + LOGO_DUR - 200;
const TITLE_DUR    =  500;
const TAG_DELAY    = TITLE_DELAY + TITLE_DUR - 100;
const TAG_DUR      =  500;

const MIN_SHOW_MS  = 2_400;
const SAFETY_MS    = 6_000;

const EXIT_DUR     =  200;
const EXIT_EASE    = "cubic-bezier(0.4,0,1,1)"; // ease-in: decisive exit

type TimerHandle = ReturnType<typeof setTimeout>;

// Unlike Date.now(), performance.now() is monotonic and is not affected by
// system-clock changes while the launch screen is visible.
const getMonotonicTime = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

/* ─── Theme (captured once at module load) ─────────────────────────────────── */

const _dark = typeof document !== "undefined"
  && document.documentElement.classList.contains("dark");

const _rm = typeof window !== "undefined"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const BG = _dark ? "#052050" : "#F5F7F8";

const SHADOW = _dark
  ? "drop-shadow(0 4px 22px rgba(0,0,0,0.55))"
  : "drop-shadow(0 5px 18px rgba(0,0,0,0.09))";

const GLOW_BG = _dark
  ? "radial-gradient(circle at 50% 50%,rgba(59,130,246,.22) 0%,rgba(29,78,216,.10) 40%,transparent 72%)"
  : "";

/* ─── Pre-built animation strings ──────────────────────────────────────────── */

const _glowAnim = (_dark && !_rm)
  ? `ls-glow ${GLOW_DUR}ms ${EO} ${GLOW_DELAY}ms both`
  : "none";

const _logoAnim = _rm
  ? "ls-in 240ms ease 0ms both"
  : `ls-in ${LOGO_DUR}ms ${EO} ${LOGO_DELAY}ms both`;

const _titleAnim = _rm ? `ls-up 240ms ease 80ms both` : `ls-up ${TITLE_DUR}ms ${EO} ${TITLE_DELAY}ms both`;

const _tagAnim = _rm
  ? "ls-up 240ms ease 80ms both"
  : `ls-up ${TAG_DUR}ms ${EO} ${TAG_DELAY}ms both`;

/* ─── Frozen style objects ──────────────────────────────────────────────────
   Allocated once at module scope.  React's reconciler receives the same object
   reference on every render → structural diffing is skipped → zero GC churn.

   The `backfaceVisibility + WebkitBackfaceVisibility: "hidden"` pair is the
   critical GPU hint.  It forces WebKit to place the element on a dedicated
   compositor layer immediately, so the animation starts on the GPU from
   frame 1 with no mid-flight layer-promotion stutter.                         */

// Wrapper: `position:fixed; inset:0` always fills the layout viewport correctly,
// even during the iOS Safari ICB startup bug (portrait dimensions reported
// during landscape launch).  This is immune to the ICB bug because the browser
// itself sizes the element — no captured dimensions needed.
//
// `perspective` creates a 3-D rendering context so every child with
// translateZ(0) gets its own GPU layer before frame 1.
//
// The inner `absolute inset-0` container fills the wrapper and provides flex
// centering.  On iPad Landscape, the address bar offsets the visual viewport
// from the layout viewport (visualViewport.offsetTop > 0).  We apply a
// `transform: translateY()` correction so the logo is centered in the *visual*
// viewport, not the layout viewport.  Transform is compositor-only — no layout
// recalc, no frame drop.
//
// GPU isolation: will-change + backface-visibility on every animated child.
const S_WRAPPER: React.CSSProperties = {
  position:                 "fixed",
  top:                      0,
  left:                     0,
  right:                    0,
  bottom:                   0,
  zIndex:                   9999,
  backgroundColor:          BG,
  perspective:              "1000px",
  WebkitPerspective:        "1000px",
  willChange:               "transform, opacity",
  transformOrigin:          "50% 50%",
  WebkitOverflowScrolling:  "touch",
  transform:                _getVvOffsetCorrection(),
  WebkitTransform:          _getVvOffsetCorrection(),
};

const S_GLOW: React.CSSProperties = {
  position:                    "absolute",
  width:                       "460px",
  height:                      "460px",
  borderRadius:                "50%",
  background:                  GLOW_BG,
  pointerEvents:               "none",
  transform:                   "translateZ(0)",
  WebkitTransform:             "translateZ(0)",
  willChange:                  "transform, opacity",
  backfaceVisibility:          "hidden",
  WebkitBackfaceVisibility:    "hidden",
  animation:                   _glowAnim,
  WebkitAnimation:             _glowAnim,
};

// Logo outer: animated with ls-in.
const S_LOGO_WRAP: React.CSSProperties = {
  transform:                   "translateZ(0)",
  WebkitTransform:             "translateZ(0)",
  willChange:                  "transform, opacity",
  backfaceVisibility:          "hidden",
  WebkitBackfaceVisibility:    "hidden",
  transformOrigin:             "50% 50%",
  animation:                   _logoAnim,
  WebkitAnimation:             _logoAnim,
};

// Logo inner: scale(1.15) + drop-shadow.  Its own GPU layer (via translateZ)
// ensures the shadow composites correctly and is independent of the parent's
// entrance transform axis.
const S_LOGO_INNER: React.CSSProperties = {
  display:                     "flex",
  transform:                   "scale(1.15) translateZ(0)",
  WebkitTransform:             "scale(1.15) translateZ(0)",
  transformOrigin:             "center",
  backfaceVisibility:          "hidden",
  WebkitBackfaceVisibility:    "hidden",
  filter:                      SHADOW,
  WebkitFilter:                SHADOW,
};

// Title stack (99's Guide): animated with ls-up.
const S_TITLE_WRAP: React.CSSProperties = {
  display:                     "flex",
  flexDirection:               "column",
  alignItems:                  "flex-start",
  justifyContent:              "center",
  transform:                   "translateZ(0)",
  WebkitTransform:             "translateZ(0)",
  willChange:                  "transform, opacity",
  backfaceVisibility:          "hidden",
  WebkitBackfaceVisibility:    "hidden",
  animation:                   _titleAnim,
  WebkitAnimation:             _titleAnim,
};

// Tagline outer: animated with ls-up.
const S_TAG_WRAP: React.CSSProperties = {
  marginTop:                   "20px",
  transform:                   "translateZ(0)",
  WebkitTransform:             "translateZ(0)",
  willChange:                  "transform, opacity",
  backfaceVisibility:          "hidden",
  WebkitBackfaceVisibility:    "hidden",
  animation:                   _tagAnim,
  WebkitAnimation:             _tagAnim,
};

const S_TAG_TEXT: React.CSSProperties = _dark ? { color: "#FFFFFF" } : { color: "#0F172A" };


/* ─── Component ─────────────────────────────────────────────────────────────── */

interface LaunchScreenProps { onDone: () => void; }

export const LaunchScreen = memo(function LaunchScreen({ onDone }: LaunchScreenProps) {
  const wrapperRef    = useRef<HTMLDivElement>(null);
  const exitCalledRef = useRef(false);
  const isReadyRef    = useRef(false);
  const exitScheduledRef = useRef(false);
  const startRef      = useRef(getMonotonicTime());
  const exitCheckTimerRef = useRef<TimerHandle | null>(null);
  const exitTimerRef = useRef<TimerHandle | null>(null);
  const exitAnimationRef = useRef<Animation | null>(null);
  const exitFrameRef = useRef<number | null>(null);
  const exitFrame2Ref = useRef<number | null>(null);
  // Ref keeps the callback fresh without re-running the effect.
  const onDoneRef     = useRef(onDone);
  onDoneRef.current   = onDone;

  useEffect(() => {
    function clearPendingExitWork() {
      if (exitCheckTimerRef.current !== null) {
        clearTimeout(exitCheckTimerRef.current);
        exitCheckTimerRef.current = null;
      }
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      if (exitFrameRef.current !== null) {
        cancelAnimationFrame(exitFrameRef.current);
        exitFrameRef.current = null;
      }
      if (exitFrame2Ref.current !== null) {
        cancelAnimationFrame(exitFrame2Ref.current);
        exitFrame2Ref.current = null;
      }
    }

    /* doExit ──────────────────────────────────────────────────────────────────
       One WAAPI call animates opacity + transform in the same keyframe array.
       Single Animation object → single compositor task → zero inter-property
       sync jitter across any display refresh rate.
       `composite: "replace"` tells the compositor to discard any prior
       transform (from CSS animations on children) and start clean.
       CSS-transition fallback covers edge-case WKWebView builds.              */
    function doExit() {
      if (exitCalledRef.current) return;
      exitCalledRef.current = true;
      exitScheduledRef.current = true;
      clearPendingExitWork();

      const el = wrapperRef.current;
      if (!el) { onDoneRef.current(); return; }

      const dur = _rm ? 160 : EXIT_DUR;

      try {
        const anim = el.animate(
          [
            { opacity: "1", transform: "scale(1.000) translateZ(0)" },
            { opacity: "0", transform: _rm ? "scale(1.000) translateZ(0)"
                                           : "scale(1.050) translateZ(0)" },
          ],
          {
            duration:  dur,
            easing:    _rm ? "ease-out" : EXIT_EASE,
            fill:      "forwards",
            composite: "replace",
          } as KeyframeAnimationOptions,
        );
        exitAnimationRef.current = anim;
        // Commit final state in case the browser silently drops fill:"forwards".
        anim.onfinish = () => {
          exitAnimationRef.current = null;
          el.style.opacity = "0";
        };
      } catch {
        // Fallback: CSS transition (no scale on reduced-motion or old WebKit).
        el.style.transition = `opacity ${dur}ms ease-in, transform ${dur}ms ease-in`;
        el.style.opacity    = "0";
        if (!_rm) el.style.transform = "scale(1.05) translateZ(0)";
      }

      exitTimerRef.current = setTimeout(() => {
        exitTimerRef.current = null;
        onDoneRef.current();
      }, dur);
    }

    /* maybeExit ───────────────────────────────────────────────────────────────
       Respects MIN_SHOW_MS then waits for two animation frames before calling
       doExit.  The double rAF guarantees the app content beneath the splash
       has been composited before the fade begins — no single-frame white gap.  */
    function maybeExit() {
      if (
        !isReadyRef.current ||
        exitCalledRef.current ||
        exitScheduledRef.current
      ) return;

      const remaining = MIN_SHOW_MS - (getMonotonicTime() - startRef.current);
      if (remaining > 0) {
        exitCheckTimerRef.current = setTimeout(() => {
          exitCheckTimerRef.current = null;
          maybeExit();
        }, remaining);
        return;
      }

      exitScheduledRef.current = true;
      exitFrameRef.current = requestAnimationFrame(() => {
        exitFrameRef.current = null;
        exitFrame2Ref.current = requestAnimationFrame(() => {
          exitFrame2Ref.current = null;
          doExit();
        });
      });
    }

    /* Listeners ───────────────────────────────────────────────────────────── */

    function onReady() {
      isReadyRef.current = true;
      maybeExit();
    }
    document.addEventListener("app-ready", onReady);

    // Safety net: force-exit if app-ready never arrives.
    const safetyTimer = setTimeout(
      () => { isReadyRef.current = true; doExit(); },
      SAFETY_MS,
    );

    // bfcache restore (iOS Safari / iPad PWA): page thawed from memory cache
    // after backgrounding — the splash would be stale, dismiss immediately.
    function onPageShow(ev: PageTransitionEvent) {
      if (ev.persisted && !exitCalledRef.current) doExit();
    }
    window.addEventListener("pageshow", onPageShow);

    // App-switcher resume: some iOS PWA configurations fire visibilitychange
    // without a preceding pageshow event.
    function onVisibility() {
      if (
        document.visibilityState === "visible" &&
        !exitCalledRef.current &&
        getMonotonicTime() - startRef.current >= MIN_SHOW_MS
      ) doExit();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("app-ready", onReady);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(safetyTimer);
      clearPendingExitWork();
      exitAnimationRef.current?.cancel();
      exitAnimationRef.current = null;
    };
  }, []); // empty deps — every mutable value lives in a ref

      /* Render ─────────────────────────────────────────────────────────────────── */
  return (
    <div
      ref={wrapperRef}
      aria-hidden="true"
      role="status"
      aria-label="Loading"
      style={S_WRAPPER}
    >
      {/* SVG Filter for outline - REMOVED */}

      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none overflow-hidden">
        {_dark && <div aria-hidden="true" style={S_GLOW} />}
        
        {/* Background Watermark: Giant solid logo (low opacity), extending beyond viewport */}
        <div style={{ position: "absolute", inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: _dark ? 0.06 : 0.03, pointerEvents: "none", overflow: "hidden" }}>
<img 
              src={_dark ? "/Dark_mode.png" : "/Light_mode.png"} 
              style={{ width: "200vmax", height: "200vmax", minWidth: "1200px", minHeight: "1200px", objectFit: "contain", transform: "translateZ(0)" }} 
              alt="" 
            />
        </div>

        {/* Coordinated Central Branding Group */}
        <div className="flex flex-col md:flex-row items-center justify-center" style={{ ...S_LOGO_WRAP, gap: 'clamp(24px, 6vw, 80px)', width: '100%', maxWidth: '1200px', padding: '0 8vw', boxSizing: 'border-box', marginTop: '-5vh' }}>
          
          {/* Primary Logo */}
          <div className="flex shrink justify-center md:justify-end min-w-0" style={S_LOGO_INNER}>
            <img 
              src={_dark ? "/Dark_mode.png" : "/Light_mode.png"} 
              style={{ width: 'clamp(120px, 30vw, 240px)', height: 'auto', objectFit: 'contain', maxWidth: '100%' }} 
              alt="99 Logo" 
            />
          </div>
          
          {/* Typography Group */}
          <div className="flex flex-col items-center md:items-start shrink min-w-0" style={{ fontFamily: '"SF Pro Display", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
             <div style={{ fontSize: 'clamp(48px, 12vw, 90px)', fontWeight: 700, color: _dark ? '#ffffff' : '#0B2A5B', lineHeight: 1, letterSpacing: '-0.02em', marginBottom: '-0.1em', whiteSpace: 'nowrap' }}>
                99's
             </div>
             <div style={{ fontSize: 'clamp(64px, 16vw, 120px)', fontWeight: 700, color: _dark ? '#3EA6A6' : '#1C8C8C', lineHeight: 0.85, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
                Guide
             </div>
             
             {/* Subtitle directly follows Guide layout flow */}
             <div style={{ ...S_TAG_WRAP, marginTop: 'clamp(16px, 3vw, 24px)' }}>
               <p className="ls-tag text-center md:text-left" style={{ color: _dark ? '#ffffff' : '#0B2A5B', fontSize: 'clamp(16px, 4vw, 26px)', margin: 0, letterSpacing: '0.04em', fontWeight: 400, textTransform: 'none', whiteSpace: 'nowrap' }}>
                 Your Medical Study Guide
               </p>
             </div>
          </div>
          
        </div>
      </div>
    </div>
  );
});