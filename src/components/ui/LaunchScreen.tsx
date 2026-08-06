/**
 * LaunchScreen — Launch transition for 99's Guide.
 *
 * ━━━ Architecture ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  All theme/motion values are captured at module load (before first React
 *  paint) and stored as frozen module-level constants.  The component body
 *  creates only 4 refs and 1 event listener — zero allocations per render.
 *
 *  All style objects are hoisted to module scope so the renderer receives the
 *  same object reference on every render pass — zero structural diffing cost,
 *  zero GC pressure from short-lived inline object literals.
 *
 * ━━━ 3-Phase Choreography ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  T = 0.05 s  Logo entrance   scale 0.92→1.03→1.0, opacity 0→1   (640 ms)
 *  T = 0.69 s  Logo breathing  scale 1.0→1.05, slow drift          (2 160 ms)
 *  T = 1.05 s  Slogan reveal   translateY 10px→0, opacity 0→1      (550 ms)
 *  T = 1.05 s  Dark glow pulse scale 1→1.4, opacity 0.5→1          (2 000 ms)
 *  T = 2.80 s  Crossfade exit  wrapper opacity 1→0                 (420 ms)
 *
 * ━━━ GPU / Compositor Safety ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Entrance: pure CSS animations — compositor-driven from first paint.
 *  Exit:     WAAPI opacity-only on the outer wrapper — compositor thread only.
 *  Animated properties: transform + opacity only. No layout, no filter.
 *  will-change declared only on elements that actually animate; intermediary
 *  wrapper divs do NOT carry will-change to avoid unnecessary GPU layer promotion.
 *  prefers-reduced-motion → 150 ms plain crossfade, no movement.
 *
 * ━━━ Zero-flash crossfade ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  App renders underneath the z-[9999] wrapper the entire time.
 *  Fading the wrapper opacity is a true GPU crossfade — at no intermediate
 *  frame is there a solid colour separating splash from app.
 *  fill:"forwards" holds opacity:0 until React unmounts the node.
 */

import React, { useEffect, useRef, memo } from "react";
import AppLogo from "./AppLogo";

// ─── CSS injection (module level — before first React paint) ─────────────────
//
// Keyframes are injected at module load, not inside a useEffect, so the browser
// has the animation definitions by the time it composites the very first frame.
// The style tag is guarded by ID so HMR reloads never duplicate it.
if (typeof document !== "undefined") {
  const STYLE_ID = "ls-keyframes";
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = `
      @keyframes ls-logo-in {
        0%   { opacity:0; transform:scale(0.92) translateZ(0);
               animation-timing-function:cubic-bezier(0.0,0.0,0.2,1); }
        65%  { opacity:1; transform:scale(1.03) translateZ(0);
               animation-timing-function:cubic-bezier(0.4,0.0,0.6,1); }
        100% { opacity:1; transform:scale(1.00) translateZ(0); }
      }
      @keyframes ls-logo-breathe {
        from { transform:scale(1)    translateZ(0); }
        to   { transform:scale(1.05) translateZ(0); }
      }
      @keyframes ls-slogan-in {
        from { opacity:0; transform:translateY(10px) translateZ(0); }
        to   { opacity:1; transform:translateY(0)    translateZ(0); }
      }
      @keyframes ls-glow-expand {
        from { transform:scale(1)   translateZ(0); opacity:0.5; }
        to   { transform:scale(1.4) translateZ(0); opacity:1;   }
      }
      .ls-slogan {
        font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Inter",sans-serif;
        font-size:14px;
        font-weight:400;
        letter-spacing:0.20em;
        text-transform:uppercase;
        user-select:none;
        line-height:1.2;
      }
      @media (min-width:640px)  { .ls-slogan { font-size:15px; } }
      @media (min-width:768px)  { .ls-slogan { font-size:15px; } }
      @media (min-width:1024px) { .ls-slogan { font-size:16px; letter-spacing:0.18em; } }
    `;
    document.head.appendChild(s);
  }
}

// ─── Animation timing constants ───────────────────────────────────────────────

const MIN_SHOW_MS   = 2_800;
const EASE_EMERGE   = "cubic-bezier(0.16,1,0.3,1)";

const LOGO_DELAY    = 50;
const LOGO_DUR      = 640;
const BREATHE_DELAY = LOGO_DELAY + LOGO_DUR;   // 690 ms — starts when entrance ends
const BREATHE_DUR   = 2_160;                    // 690 + 2160 = 2850 ≈ exit time
const SLOGAN_DELAY  = LOGO_DELAY + 1_000;       // 1.05 s — 0.6 s after logo settles
const SLOGAN_DUR    = 550;
const GLOW_DUR      = 2_000;

// ─── Theme palette ────────────────────────────────────────────────────────────

const THEME = {
  dark: {
    bg:         "#111116",
    glow:       "radial-gradient(circle at 50% 50%, rgba(212,175,55,0.20) 0%, rgba(192,168,130,0.10) 38%, rgba(150,140,120,0.04) 62%, transparent 76%)",
    logoFilter: "drop-shadow(0 4px 20px rgba(0,0,0,0.55))" as string | undefined,
  },
  light: {
    bg:         "#F5F1EC",
    glow:       "radial-gradient(circle at 50% 50%, rgba(180,145,80,0.08) 0%, rgba(160,130,80,0.04) 40%, transparent 70%)",
    logoFilter: "drop-shadow(0 6px 20px rgba(0,0,0,0.08))" as string | undefined,
  },
} as const;

// ─── Runtime values — captured once at module load ────────────────────────────
//
// isDark and rm are determined by the OS/browser the moment this module is first
// imported — always before React renders a frame.  They are stable for the entire
// splash lifetime: toggling system theme or reduced-motion during the splash
// requires a full page reload, which re-imports this module anyway.
//
// Capturing at module scope means the component body performs zero DOM reads
// and creates zero intermediate objects during render.

const _isDark = typeof document !== "undefined"
  ? document.documentElement.classList.contains("dark")
  : false;

const _rm = typeof window !== "undefined"
  ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
  : false;

const _theme = _isDark ? THEME.dark : THEME.light;

// ─── Animation strings — built once ──────────────────────────────────────────

const _logoAnim = _rm
  ? "ls-logo-in 280ms ease 0ms both"
  : [
      `ls-logo-in ${LOGO_DUR}ms ${EASE_EMERGE} ${LOGO_DELAY}ms both`,
      `ls-logo-breathe ${BREATHE_DUR}ms ease-in-out ${BREATHE_DELAY}ms forwards`,
    ].join(", ");

const _sloganAnim = _rm
  ? "ls-slogan-in 280ms ease 150ms both"
  : `ls-slogan-in ${SLOGAN_DUR}ms ${EASE_EMERGE} ${SLOGAN_DELAY}ms both`;

const _glowAnim = _isDark && !_rm
  ? `ls-glow-expand ${GLOW_DUR}ms ease-in-out ${SLOGAN_DELAY}ms forwards`
  : "none";

// ─── Frozen style objects — allocated once, never recreated on render ─────────
//
// Inline style objects written inside JSX are new heap allocations on every
// render.  Hoisting them here means React's reconciler receives the same object
// reference each time — structural diffing is skipped, the GC sees no churn,
// and the JS engine can optimise the shapes as monomorphic property accesses.

const _wrapperStyle: React.CSSProperties = {
  backgroundColor: _theme.bg,
  contain:         "layout paint",  // prevent wrapper from affecting page layout/paint
  willChange:      "opacity",       // pre-promote GPU layer for the exit crossfade
};

// Content wrapper: pure flex container — no independent animation, no willChange.
// Each animated child (glow, logo, slogan) promotes its own GPU layer.
const _contentStyle: React.CSSProperties = {
  // intentionally empty — layout controlled by Tailwind classes
};

const _glowStyle: React.CSSProperties = {
  position:     "absolute",
  width:        "440px",
  height:       "440px",
  borderRadius: "50%",
  background:   _theme.glow,
  transform:    "translateZ(0)",   // force GPU layer from frame 1
  pointerEvents: "none",
  opacity:      _isDark ? 0.5 : 1,
  animation:    _glowAnim,
  willChange:   "transform, opacity",   // animated by ls-glow-expand
  contain:      "layout paint style",   // glow is visually self-contained
};

const _logoOuterStyle: React.CSSProperties = {
  position:   "relative",
  willChange: "transform, opacity",    // CSS entrance + breathe run on this node
  animation:  _logoAnim,
};

const _logoInnerStyle: React.CSSProperties = {
  transform:       "scale(1.15)",
  transformOrigin: "center",
  display:         "flex",
  ...(_theme.logoFilter ? { filter: _theme.logoFilter } : {}),
};

const _sloganWrapStyle: React.CSSProperties = {
  marginTop:  "28px",
  willChange: "transform, opacity",    // CSS entrance animation
  animation:  _sloganAnim,
};

// Dark: metallic silver→gold→silver gradient via background-clip.
// All clip properties on the SAME element — required for WKWebView/Safari.
// Light: plain solid color — no clip, no artefact possible.
const _sloganTextStyle: React.CSSProperties = _isDark
  ? {
      background:           "linear-gradient(90deg, #C8C8CC 0%, #D4AF37 50%, #C8C8CC 100%)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor:  "transparent",
      backgroundClip:       "text",
      color:                "transparent",
    }
  : {
      color:      "#3A3A3C",
      background: "transparent",
    };

// ─── Types ────────────────────────────────────────────────────────────────────

interface LaunchScreenProps {
  onDone: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────
//
// memo: LaunchScreen has no internal state and its sole prop (onDone) is a
// stable callback from Root.  memo ensures StrictMode's double-invoke in
// development doesn't trigger a second full render in production builds.

export const LaunchScreen = memo(function LaunchScreen({ onDone }: LaunchScreenProps) {
  const wrapperRef    = useRef<HTMLDivElement>(null);
  const exitCalledRef = useRef(false);
  const isReadyRef    = useRef(false);
  const startRef      = useRef(Date.now());
  // Keep onDone in a ref so the effect closure never becomes stale even if the
  // parent passes a new function reference (Root re-renders once on mount).
  const onDoneRef     = useRef(onDone);
  onDoneRef.current   = onDone;

  // ── Exit logic (WAAPI) ──────────────────────────────────────────────────────
  //
  // Animates the outer wrapper opacity 1→0 on the compositor thread.
  // The App is always rendered underneath z-[9999], so this is a true GPU
  // crossfade — no intermediate solid colour frame at any opacity level.
  // fill:"forwards" holds opacity:0 until React unmounts the node, so there is
  // zero gap between animation end and DOM removal.

  useEffect(() => {
    function doExit() {
      if (exitCalledRef.current) return;
      exitCalledRef.current = true;

      const wrapper = wrapperRef.current;
      if (!wrapper) { onDoneRef.current(); return; }

      const exitDur = _rm ? 150 : 420;

      wrapper.animate(
        [{ opacity: "1" }, { opacity: "0" }],
        { duration: exitDur, easing: "cubic-bezier(0.4,0,0.6,1)", fill: "forwards" },
      );

      setTimeout(() => onDoneRef.current(), exitDur);
    }

    function maybeExit() {
      if (!isReadyRef.current) return;
      const remaining = MIN_SHOW_MS - (Date.now() - startRef.current);
      if (remaining > 0) { setTimeout(maybeExit, remaining); return; }
      // Double rAF: first ensures paint is committed, second fires post-paint.
      requestAnimationFrame(() => requestAnimationFrame(doExit));
    }

    function handler() {
      isReadyRef.current = true;
      maybeExit();
    }

    document.addEventListener("app-ready", handler);
    return () => document.removeEventListener("app-ready", handler);
  }, []); // stable — all mutable state is in refs

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      ref={wrapperRef}
      className="fixed inset-0 z-[9999]"
      aria-hidden="true"
      role="status"
      aria-label="Application loading"
      style={_wrapperStyle}
    >
      <div
        className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
        style={_contentStyle}
      >
        {/* Ambient glow — self-contained GPU layer, expands on slogan reveal */}
        <div aria-hidden="true" style={_glowStyle} />

        {/* Logo — CSS entrance + breathe; exits via parent wrapper fade */}
        {/*                                                                    */}
        {/* Outer div: animation + willChange — no filter, no scale directly. */}
        {/* Inner div: scale(1.15) + drop-shadow on its own compositing layer */}
        {/* so the shadow scales correctly and is independent of the entrance  */}
        {/* transform axis.  display:flex collapses wrapper to logo's size so  */}
        {/* the scale origin is the logo's true visual center, not a box edge. */}
        <div style={_logoOuterStyle}>
          <div style={_logoInnerStyle}>
            <AppLogo size="lg" iconOnly />
          </div>
        </div>

        {/* Slogan — reveals 1.05 s after mount, fades with wrapper on exit */}
        <div style={_sloganWrapStyle}>
          <p className="ls-slogan" style={_sloganTextStyle}>
            Your Guide to Success
          </p>
        </div>
      </div>
    </div>
  );
});
