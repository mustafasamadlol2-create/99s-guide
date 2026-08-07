/**
 * LaunchScreen — Launch transition for 99's Guide.
 *
 * ━━━ Design principles ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  • "Liquid" feel — every animated property uses a single, clean ease-out
 *    curve with no overshoot, no multi-step keyframes, no per-keyframe
 *    timing changes.  The result is continuous, decelerating motion like
 *    a drop of ink spreading in water.
 *  • Minimal surface — one animation per element; zero chained or alternating
 *    loops.  Fewer moving parts = fewer compositor sync points = no glitches
 *    on iOS WKWebView across hundreds of repeated runs.
 *  • GPU-only — only `opacity` and `transform` are animated; no filter, no
 *    colour, no layout property anywhere in any animation path.
 *  • Exit is one WAAPI call: opacity 1→0 + scale 1→1.05 simultaneously,
 *    ease-in so the splash decisively clears the screen.
 *
 * ━━━ Choreography ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  T = 0.04 s  Glow expands     scale 0.8→1.0, opacity 0→1   (1 600 ms)
 *  T = 0.05 s  Logo appears     scale 0.90→1.0, opacity 0→1  (  520 ms)
 *  T = 0.65 s  Slogan appears   translateY 8px→0, opacity 0→1 (  440 ms)
 *  T = 2.40 s  Exit begins      opacity+scale, single WAAPI   (  460 ms)
 *  T = 2.86 s  Component unmounts
 */

import React, { useEffect, useRef, memo } from "react";
import AppLogo from "./AppLogo";

// ─── CSS injection ─────────────────────────────────────────────────────────────
//
// Runs at module load — before any React paint — so keyframes are available to
// the browser compositor from the very first frame.  Guarded by ID; safe with HMR.

if (typeof document !== "undefined") {
  const ID = "ls-kf3";
  if (!document.getElementById(ID)) {
    const s  = document.createElement("style");
    s.id     = ID;

    // Single easing used everywhere: ease-out-quart.
    // Starts fast, decelerates smoothly to rest — the "liquid" feel.
    // Both standard and -webkit- variants for Safari / WKWebView.
    s.textContent = `
      @keyframes ls-in {
        from { opacity:0; transform:scale(0.90) translateZ(0); }
        to   { opacity:1; transform:scale(1.00) translateZ(0); }
      }
      @-webkit-keyframes ls-in {
        from { opacity:0; -webkit-transform:scale(0.90) translateZ(0); }
        to   { opacity:1; -webkit-transform:scale(1.00) translateZ(0); }
      }

      @keyframes ls-up {
        from { opacity:0; transform:translateY(8px) translateZ(0); }
        to   { opacity:1; transform:translateY(0px) translateZ(0); }
      }
      @-webkit-keyframes ls-up {
        from { opacity:0; -webkit-transform:translateY(8px) translateZ(0); }
        to   { opacity:1; -webkit-transform:translateY(0px) translateZ(0); }
      }

      @keyframes ls-glow {
        from { opacity:0; transform:scale(0.75) translateZ(0); }
        to   { opacity:1; transform:scale(1.00) translateZ(0); }
      }
      @-webkit-keyframes ls-glow {
        from { opacity:0; -webkit-transform:scale(0.75) translateZ(0); }
        to   { opacity:1; -webkit-transform:scale(1.00) translateZ(0); }
      }

      .ls-tag {
        font-family: -apple-system, BlinkMacSystemFont,
          "SF Pro Display", "SF Pro Text", "Inter", sans-serif;
        font-size:      13px;
        font-weight:    500;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        user-select:         none;
        -webkit-user-select: none;
        line-height: 1;
      }
      @media (min-width:640px)  { .ls-tag { font-size:13.5px; } }
      @media (min-width:1024px) { .ls-tag { font-size:14px; letter-spacing:0.20em; } }
    `;
    document.head.appendChild(s);
  }
}

// ─── Constants ─────────────────────────────────────────────────────────────────

// Single ease-out-quart curve — used for every entrance animation.
const EO = "cubic-bezier(0.25,0.46,0.45,0.94)";

// Entrance timing
const GLOW_DELAY    =  40;   // ms
const GLOW_DUR      = 1_600;
const LOGO_DELAY    =  50;
const LOGO_DUR      =  520;
const TAG_DELAY     = LOGO_DELAY + LOGO_DUR + 80;  // 650 ms — close behind logo
const TAG_DUR       =  440;

// Splash minimum visibility and safety limits
const MIN_SHOW_MS      = 2_400;
const SAFETY_MS        = 8_000;

// Exit: single WAAPI animation (opacity + scale together)
const EXIT_DUR         =  460;
const EXIT_EASE        = "cubic-bezier(0.4,0,1,1)";   // ease-in — decisive
const EXIT_SCALE_END   = "scale(1.05) translateZ(0)";

// ─── Theme ─────────────────────────────────────────────────────────────────────

const _dark = typeof document !== "undefined"
  ? document.documentElement.classList.contains("dark")
  : false;

const _rm = typeof window !== "undefined"
  ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
  : false;

const BG          = _dark ? "#111116"  : "#F5F1EC";
const LOGO_SHADOW = _dark
  ? "drop-shadow(0 4px 22px rgba(0,0,0,0.55))"
  : "drop-shadow(0 5px 18px rgba(0,0,0,0.09))";
const GLOW_BG     = _dark
  ? "radial-gradient(circle at 50% 50%, rgba(212,175,55,0.22) 0%, rgba(192,168,130,0.10) 40%, transparent 72%)"
  : "radial-gradient(circle at 50% 50%, rgba(180,145,80,0.09) 0%, rgba(160,130,80,0.04) 44%, transparent 70%)";

// ─── Prebuilt animation strings ─────────────────────────────────────────────────

const _glowAnim = (_dark && !_rm)
  ? `ls-glow ${GLOW_DUR}ms ${EO} ${GLOW_DELAY}ms both`
  : "none";

const _logoAnim = _rm
  ? "ls-in 240ms ease 0ms both"
  : `ls-in ${LOGO_DUR}ms ${EO} ${LOGO_DELAY}ms both`;

const _tagAnim = _rm
  ? "ls-up 240ms ease 80ms both"
  : `ls-up ${TAG_DUR}ms ${EO} ${TAG_DELAY}ms both`;

// ─── Frozen style objects ──────────────────────────────────────────────────────
//
// Hoisted to module scope — same object reference on every render, so React's
// reconciler skips structural diffing and the GC sees zero churn.

const S_WRAPPER: React.CSSProperties = {
  backgroundColor: BG,
  willChange:      "transform, opacity",
  transformOrigin: "50% 50%",
};

const S_GLOW: React.CSSProperties = {
  position:        "absolute",
  width:           "460px",
  height:          "460px",
  borderRadius:    "50%",
  background:      GLOW_BG,
  pointerEvents:   "none",
  willChange:      "transform, opacity",
  animation:       _glowAnim,
  WebkitAnimation: _glowAnim,
  contain:         "layout paint style",
};

const S_LOGO_WRAP: React.CSSProperties = {
  willChange:      "transform, opacity",
  animation:       _logoAnim,
  WebkitAnimation: _logoAnim,
  transformOrigin: "50% 50%",
};

const S_LOGO_INNER: React.CSSProperties = {
  display:         "flex",
  transform:       "scale(1.15)",
  transformOrigin: "center",
  filter:          LOGO_SHADOW,
  WebkitFilter:    LOGO_SHADOW,
};

const S_TAG_WRAP: React.CSSProperties = {
  marginTop:       "20px",
  willChange:      "transform, opacity",
  animation:       _tagAnim,
  WebkitAnimation: _tagAnim,
};

const S_TAG_TEXT: React.CSSProperties = _dark
  ? {
      background:           "linear-gradient(90deg, #AEAEB2 0%, #D4AF37 48%, #C8C8CC 100%)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor:  "transparent",
      backgroundClip:       "text",
      color:                "transparent",
    }
  : {
      color:      "#6E6E73",
    };

// ─── Types ─────────────────────────────────────────────────────────────────────

interface LaunchScreenProps { onDone: () => void; }

// ─── Component ─────────────────────────────────────────────────────────────────

export const LaunchScreen = memo(function LaunchScreen({ onDone }: LaunchScreenProps) {
  const wrapperRef    = useRef<HTMLDivElement>(null);
  const exitCalledRef = useRef(false);
  const isReadyRef    = useRef(false);
  const startRef      = useRef(Date.now());
  const onDoneRef     = useRef(onDone);
  onDoneRef.current   = onDone;

  useEffect(() => {

    // ── doExit ──────────────────────────────────────────────────────────────
    //
    // Single WAAPI call animating opacity AND transform together.
    // One animation object → one compositor task → no sync jitter on iOS.
    // CSS-transition fallback for ancient WKWebView builds.

    function doExit() {
      if (exitCalledRef.current) return;
      exitCalledRef.current = true;

      const el = wrapperRef.current;
      if (!el) { onDoneRef.current(); return; }

      const dur  = _rm ? 160 : EXIT_DUR;
      const from = { opacity: "1", transform: "scale(1) translateZ(0)" };
      const to   = _rm
        ? { opacity: "0", transform: "scale(1) translateZ(0)" }
        : { opacity: "0", transform: EXIT_SCALE_END };

      try {
        const anim = el.animate([from, to], {
          duration: dur,
          easing:   _rm ? "ease-out" : EXIT_EASE,
          fill:     "forwards",
        });
        // Lock final state so fill:"forwards" is never silently dropped.
        anim.onfinish = () => {
          el.style.opacity   = "0";
          el.style.transform = _rm ? "" : EXIT_SCALE_END;
        };
      } catch {
        el.style.transition = `opacity ${dur}ms ease-in, transform ${dur}ms ease-in`;
        el.style.opacity    = "0";
        if (!_rm) el.style.transform = EXIT_SCALE_END;
      }

      setTimeout(() => onDoneRef.current(), dur);
    }

    // ── maybeExit ───────────────────────────────────────────────────────────
    // Wait for MIN_SHOW_MS, then double-rAF to ensure the app content below
    // has been painted before the exit animation begins (prevents white flash).

    function maybeExit() {
      if (!isReadyRef.current) return;
      const left = MIN_SHOW_MS - (Date.now() - startRef.current);
      if (left > 0) { setTimeout(maybeExit, left); return; }
      requestAnimationFrame(() => requestAnimationFrame(doExit));
    }

    // ── listeners ───────────────────────────────────────────────────────────

    function onReady() {
      isReadyRef.current = true;
      maybeExit();
    }
    document.addEventListener("app-ready", onReady);

    // Safety: force-exit if app-ready never fires (network stall, JS error).
    const safety = setTimeout(() => { isReadyRef.current = true; doExit(); }, SAFETY_MS);

    // bfcache restore (iOS Safari / iPad PWA): page thawed from memory —
    // splash is stale, dismiss immediately.
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted && !exitCalledRef.current) doExit();
    }
    window.addEventListener("pageshow", onPageShow);

    // App-switcher resume without pageshow (some iOS PWA configs).
    function onViz() {
      if (document.visibilityState === "visible" && !exitCalledRef.current) {
        if (Date.now() - startRef.current >= MIN_SHOW_MS) doExit();
      }
    }
    document.addEventListener("visibilitychange", onViz);

    return () => {
      document.removeEventListener("app-ready", onReady);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onViz);
      clearTimeout(safety);
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="fixed inset-0 z-[9999]"
      aria-hidden="true"
      role="status"
      aria-label="Loading"
      style={S_WRAPPER}
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">

        {/* Ambient glow — dark mode only */}
        {_dark && <div aria-hidden="true" style={S_GLOW} />}

        {/* Logo */}
        <div style={S_LOGO_WRAP}>
          <div style={S_LOGO_INNER}>
            <AppLogo size="lg" iconOnly />
          </div>
        </div>

        {/* Tagline — appears 80 ms after logo settles */}
        <div style={S_TAG_WRAP}>
          <p className="ls-tag" style={S_TAG_TEXT}>
            Your Guide to Success
          </p>
        </div>

      </div>
    </div>
  );
});
