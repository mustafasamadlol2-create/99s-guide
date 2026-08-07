/**
 * LaunchScreen — Launch transition for 99's Guide.
 *
 * ━━━ Architecture ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  All theme/motion values are captured at module load (before first React
 *  paint) and stored as frozen module-level constants.  The component body
 *  creates only refs — zero allocations per render.
 *
 *  Style objects are hoisted to module scope so the renderer receives the same
 *  object reference on every render — zero structural diffing cost, zero GC
 *  pressure from short-lived inline literals.
 *
 * ━━━ Entrance Choreography ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  T = 0.05 s  Logo entrance    scale 0.88→1.04→1.0, opacity 0→1   (600 ms)
 *  T = 0.65 s  Logo breathe     scale 1.0→1.03, ease-in-out         (2 250 ms)
 *  T = 1.10 s  Slogan reveal    translateY 14px→0, opacity 0→1      (520 ms)
 *  T = 1.10 s  Dark glow pulse  scale 1→1.45, opacity 0.4→1         (2 000 ms)
 *
 * ━━━ Exit Choreography (WAAPI, two-layer) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Two simultaneous animations on the wrapper:
 *    opacity  1 → 0  in 420 ms, cubic-bezier(0.4,0,1,1)   — decisive fade
 *    scale    1 → 1.06 in 540 ms, cubic-bezier(0.16,1,0.3,1) — spring bloom
 *  Together they create a cinematic "the world opens up" reveal as the app
 *  appears underneath.  prefers-reduced-motion → 160 ms opacity only.
 *
 * ━━━ GPU / Compositor Safety ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Entrance: pure CSS animations — compositor-driven from first paint.
 *  Exit:     WAAPI on the outer wrapper — opacity + transform only.
 *  No filter, no layout properties, no box-shadow in any animation path.
 *  will-change declared on the wrapper (exit) and each animated child.
 *  `contain: "style"` on the wrapper avoids layout interference; paint
 *  containment is intentionally NOT set so the scaled wrapper doesn't clip.
 *
 * ━━━ Zero-flash crossfade ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  App renders underneath z-[9999] the entire time.
 *  The exit animation fades AND scales the wrapper — at no point is there
 *  a hard-cut or a solid colour separating splash from app content.
 *  fill:"forwards" holds the final frame until React unmounts the node.
 */

import React, { useEffect, useRef, memo } from "react";
import AppLogo from "./AppLogo";

// ─── CSS injection (module level — before first React paint) ─────────────────
//
// Keyframes are injected at module load so the browser has animation definitions
// by the time it composites the very first frame.  The style tag is guarded by
// ID so HMR reloads never duplicate it.  Both standard and -webkit- variants
// are included for full iOS Safari / WKWebView compatibility.

if (typeof document !== "undefined") {
  const STYLE_ID = "ls-keyframes-v2";
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = `
      /* ── Logo entrance ───────────────────────────────────────────────── */
      @keyframes ls-logo-in {
        0%   { opacity:0; transform:scale(0.88) translateZ(0);
               animation-timing-function:cubic-bezier(0.0,0.0,0.2,1); }
        62%  { opacity:1; transform:scale(1.04) translateZ(0);
               animation-timing-function:cubic-bezier(0.34,1.56,0.64,1); }
        100% { opacity:1; transform:scale(1.00) translateZ(0); }
      }
      @-webkit-keyframes ls-logo-in {
        0%   { opacity:0; -webkit-transform:scale(0.88) translateZ(0); }
        62%  { opacity:1; -webkit-transform:scale(1.04) translateZ(0); }
        100% { opacity:1; -webkit-transform:scale(1.00) translateZ(0); }
      }

      /* ── Logo breathe (very subtle, continuous) ──────────────────────── */
      @keyframes ls-logo-breathe {
        from { transform:scale(1.000) translateZ(0); }
        to   { transform:scale(1.030) translateZ(0); }
      }
      @-webkit-keyframes ls-logo-breathe {
        from { -webkit-transform:scale(1.000) translateZ(0); }
        to   { -webkit-transform:scale(1.030) translateZ(0); }
      }

      /* ── Slogan reveal ───────────────────────────────────────────────── */
      @keyframes ls-slogan-in {
        0%   { opacity:0; transform:translateY(14px) translateZ(0); }
        100% { opacity:1; transform:translateY(0px)  translateZ(0); }
      }
      @-webkit-keyframes ls-slogan-in {
        0%   { opacity:0; -webkit-transform:translateY(14px) translateZ(0); }
        100% { opacity:1; -webkit-transform:translateY(0px)  translateZ(0); }
      }

      /* ── Ambient glow expand (dark mode only) ────────────────────────── */
      @keyframes ls-glow-expand {
        from { transform:scale(1.00) translateZ(0); opacity:0.4; }
        to   { transform:scale(1.45) translateZ(0); opacity:1.0; }
      }
      @-webkit-keyframes ls-glow-expand {
        from { -webkit-transform:scale(1.00) translateZ(0); opacity:0.4; }
        to   { -webkit-transform:scale(1.45) translateZ(0); opacity:1.0; }
      }

      /* ── Divider fade-in ─────────────────────────────────────────────── */
      @keyframes ls-divider-in {
        from { opacity:0; transform:scaleX(0) translateZ(0); }
        to   { opacity:1; transform:scaleX(1) translateZ(0); }
      }
      @-webkit-keyframes ls-divider-in {
        from { opacity:0; -webkit-transform:scaleX(0) translateZ(0); }
        to   { opacity:1; -webkit-transform:scaleX(1) translateZ(0); }
      }

      /* ── Slogan text ─────────────────────────────────────────────────── */
      .ls-slogan {
        font-family: -apple-system, BlinkMacSystemFont,
          "SF Pro Display", "SF Pro Text", "Inter", sans-serif;
        font-size: 12.5px;
        font-weight: 500;
        letter-spacing: 0.24em;
        text-transform: uppercase;
        user-select: none;
        -webkit-user-select: none;
        line-height: 1.2;
      }
      @media (min-width: 640px)  { .ls-slogan { font-size: 13px; } }
      @media (min-width: 768px)  { .ls-slogan { font-size: 13.5px; } }
      @media (min-width: 1024px) { .ls-slogan { font-size: 14px; letter-spacing: 0.22em; } }
    `;
    document.head.appendChild(s);
  }
}

// ─── Animation timing constants ───────────────────────────────────────────────

const MIN_SHOW_MS      = 2_900;                // minimum splash visibility
const SAFETY_TIMEOUT_MS = 8_000;               // force-exit if app-ready never fires

// Entrance
const EASE_SPRING      = "cubic-bezier(0.16,1,0.3,1)";  // spring ease-out

const LOGO_DELAY       = 50;
const LOGO_DUR         = 600;
const BREATHE_DELAY    = LOGO_DELAY + LOGO_DUR;          // 650 ms
const BREATHE_DUR      = 2_250;
const SLOGAN_DELAY     = LOGO_DELAY + 1_050;             // 1.10 s
const SLOGAN_DUR       = 520;
const DIVIDER_DELAY    = SLOGAN_DELAY - 60;              // 60 ms before slogan
const DIVIDER_DUR      = 380;
const GLOW_DUR         = 2_000;

// Exit (WAAPI, two simultaneous layers)
const EXIT_OPACITY_DUR  = 420;   // fast decisive fade
const EXIT_SCALE_DUR    = 540;   // slower bloom — lingers past opacity
const EXIT_OPACITY_EASE = "cubic-bezier(0.4,0,1,1)";    // strong ease-in
const EXIT_SCALE_EASE   = "cubic-bezier(0.16,1,0.3,1)"; // spring ease-out bloom

// ─── Theme palette ────────────────────────────────────────────────────────────

const THEME = {
  dark: {
    bg:           "#111116",
    glow:         "radial-gradient(circle at 50% 50%, rgba(212,175,55,0.22) 0%, rgba(192,168,130,0.11) 36%, rgba(150,140,120,0.04) 60%, transparent 76%)",
    divider:      "rgba(255,255,255,0.12)",
    logoFilter:   "drop-shadow(0 4px 24px rgba(0,0,0,0.60))" as string | undefined,
  },
  light: {
    bg:           "#F5F1EC",
    glow:         "radial-gradient(circle at 50% 50%, rgba(180,145,80,0.09) 0%, rgba(160,130,80,0.04) 40%, transparent 70%)",
    divider:      "rgba(0,0,0,0.10)",
    logoFilter:   "drop-shadow(0 6px 22px rgba(0,0,0,0.09))" as string | undefined,
  },
} as const;

// ─── Runtime values — captured once at module load ────────────────────────────

const _isDark = typeof document !== "undefined"
  ? document.documentElement.classList.contains("dark")
  : false;

const _rm = typeof window !== "undefined"
  ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
  : false;

const _theme = _isDark ? THEME.dark : THEME.light;

// ─── Animation strings — built once ──────────────────────────────────────────
//
// Logo: entrance + breathe chained in a single animation shorthand.
// Slogan: simple translateY + opacity reveal.
// Glow: expand in dark mode only.
// Divider: scaleX reveal before slogan.

const _logoAnim: string = _rm
  ? "ls-logo-in 260ms ease 0ms both"
  : [
      `ls-logo-in ${LOGO_DUR}ms ${EASE_SPRING} ${LOGO_DELAY}ms both`,
      `ls-logo-breathe ${BREATHE_DUR}ms ease-in-out ${BREATHE_DELAY}ms alternate infinite`,
    ].join(", ");

const _sloganAnim: string = _rm
  ? "ls-slogan-in 260ms ease 100ms both"
  : `ls-slogan-in ${SLOGAN_DUR}ms ${EASE_SPRING} ${SLOGAN_DELAY}ms both`;

const _dividerAnim: string = _rm
  ? "none"
  : `ls-divider-in ${DIVIDER_DUR}ms ${EASE_SPRING} ${DIVIDER_DELAY}ms both`;

const _glowAnim: string = _isDark && !_rm
  ? `ls-glow-expand ${GLOW_DUR}ms ease-in-out ${SLOGAN_DELAY}ms forwards`
  : "none";

// ─── Frozen style objects — allocated once, never recreated on render ─────────
//
// `contain: "style"` prevents the wrapper from creating a new stacking context
// for contained elements, but avoids `contain: "paint"` which would clip the
// scaled wrapper at its own bounds during the exit bloom animation.

const _wrapperStyle: React.CSSProperties = {
  backgroundColor: _theme.bg,
  contain:         "style",
  willChange:      "transform, opacity",  // pre-promote for the exit animation
  transformOrigin: "50% 50%",
};

const _contentStyle: React.CSSProperties = {
  // intentionally empty — layout via Tailwind flex classes
};

const _glowStyle: React.CSSProperties = {
  position:      "absolute",
  width:         "480px",
  height:        "480px",
  borderRadius:  "50%",
  background:    _theme.glow,
  transform:     "translateZ(0)",
  pointerEvents: "none",
  opacity:       _isDark ? 0.4 : 1,
  animation:     _glowAnim,
  WebkitAnimation: _glowAnim,
  willChange:    "transform, opacity",
  contain:       "layout paint style",
};

const _logoOuterStyle: React.CSSProperties = {
  position:        "relative",
  willChange:      "transform, opacity",
  animation:       _logoAnim,
  WebkitAnimation: _logoAnim,
  // transform-origin at the visual center of the logo
  transformOrigin: "50% 50%",
};

const _logoInnerStyle: React.CSSProperties = {
  transform:       "scale(1.15)",
  transformOrigin: "center",
  display:         "flex",
  ...(_theme.logoFilter ? { filter: _theme.logoFilter, WebkitFilter: _theme.logoFilter } : {}),
};

// Thin divider line between logo and slogan — visual bridge / breathing room
const _dividerStyle: React.CSSProperties = {
  width:           "32px",
  height:          "1px",
  marginTop:       "22px",
  marginBottom:    "0px",
  borderRadius:    "99px",
  background:      _theme.divider,
  transformOrigin: "center",
  willChange:      "transform, opacity",
  animation:       _dividerAnim,
  WebkitAnimation: _dividerAnim,
};

const _sloganWrapStyle: React.CSSProperties = {
  marginTop:       "14px",
  willChange:      "transform, opacity",
  animation:       _sloganAnim,
  WebkitAnimation: _sloganAnim,
};

// Dark: metallic silver→gold→silver gradient via background-clip.
// All clip properties on the SAME element — required for WKWebView/Safari.
// Light: plain muted color — no clip, no artefact possible.
const _sloganTextStyle: React.CSSProperties = _isDark
  ? {
      background:           "linear-gradient(90deg, #B0B0B4 0%, #D4AF37 45%, #C8C8CC 80%, #D4AF37 100%)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor:  "transparent",
      backgroundClip:       "text",
      color:                "transparent",
    }
  : {
      color:      "#6E6E73",
      background: "transparent",
    };

// ─── Types ────────────────────────────────────────────────────────────────────

interface LaunchScreenProps {
  onDone: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────
//
// memo: LaunchScreen has no internal state and its sole prop (onDone) is a
// stable callback from Root.  memo prevents any re-render from the parent.

export const LaunchScreen = memo(function LaunchScreen({ onDone }: LaunchScreenProps) {
  const wrapperRef    = useRef<HTMLDivElement>(null);
  const exitCalledRef = useRef(false);
  const isReadyRef    = useRef(false);
  const startRef      = useRef(Date.now());

  // Keep onDone in a ref so closures never go stale even if the parent
  // passes a new function reference after a re-render.
  const onDoneRef   = useRef(onDone);
  onDoneRef.current = onDone;

  // ── Exit logic ──────────────────────────────────────────────────────────────
  //
  // Two simultaneous WAAPI animations on the outer wrapper:
  //
  //   1. Opacity 1→0 (420 ms, strong ease-in) — decisive, feels "committed"
  //   2. Scale  1→1.06 (540 ms, spring ease-out) — slow bloom reveals the app
  //
  // The opacity finishes first; the scale continues subtly for 120 ms more,
  // creating the sensation that the app "opens through" the splash.  Together
  // they feel far more cinematic than a plain crossfade.
  //
  // prefers-reduced-motion → 160 ms opacity-only, no movement.
  //
  // WAAPI fallback: if animate() throws (very old WebKit), fall back to a CSS
  // transition so the splash always exits even on legacy engines.

  useEffect(() => {
    function doExit() {
      if (exitCalledRef.current) return;
      exitCalledRef.current = true;

      const wrapper = wrapperRef.current;
      if (!wrapper) { onDoneRef.current(); return; }

      if (_rm) {
        // Reduced-motion path: plain 160 ms opacity fade, no scale.
        try {
          const a = wrapper.animate(
            [{ opacity: "1" }, { opacity: "0" }],
            { duration: 160, easing: "ease-out", fill: "forwards" },
          );
          a.onfinish = () => { wrapper.style.opacity = "0"; };
        } catch {
          wrapper.style.transition = "opacity 160ms ease-out";
          wrapper.style.opacity = "0";
        }
        setTimeout(() => onDoneRef.current(), 160);
        return;
      }

      // Full motion path: two-layer exit ─────────────────────────────────────
      try {
        // Layer 1: opacity — fast decisive fade
        const fadeAnim = wrapper.animate(
          [{ opacity: "1" }, { opacity: "0" }],
          {
            duration: EXIT_OPACITY_DUR,
            easing:   EXIT_OPACITY_EASE,
            fill:     "forwards",
          },
        );
        // Lock opacity after animation finishes so fill:"forwards" is never
        // silently dropped by the browser's effect compositor.
        fadeAnim.onfinish = () => { wrapper.style.opacity = "0"; };

        // Layer 2: scale bloom — spring ease-out, outlasts opacity
        wrapper.animate(
          [
            { transform: "scale(1.000) translateZ(0)" },
            { transform: "scale(1.065) translateZ(0)" },
          ],
          {
            duration: EXIT_SCALE_DUR,
            easing:   EXIT_SCALE_EASE,
            fill:     "forwards",
          },
        );
      } catch {
        // Fallback: CSS transition for browsers with incomplete WAAPI support
        wrapper.style.transition =
          `opacity ${EXIT_OPACITY_DUR}ms ${EXIT_OPACITY_EASE}, ` +
          `transform ${EXIT_SCALE_DUR}ms ${EXIT_SCALE_EASE}`;
        wrapper.style.opacity   = "0";
        wrapper.style.transform = "scale(1.065) translateZ(0)";
      }

      // Unmount after the longer of the two animations completes.
      setTimeout(() => onDoneRef.current(), EXIT_SCALE_DUR);
    }

    function maybeExit() {
      if (!isReadyRef.current) return;
      const remaining = MIN_SHOW_MS - (Date.now() - startRef.current);
      if (remaining > 0) { setTimeout(maybeExit, remaining); return; }
      // Double rAF ensures the app content underneath has been painted before
      // we start the exit, preventing any single-frame white flash.
      requestAnimationFrame(() => requestAnimationFrame(doExit));
    }

    function handler() {
      isReadyRef.current = true;
      maybeExit();
    }

    document.addEventListener("app-ready", handler);

    // ── Safety timeout ────────────────────────────────────────────────────────
    // If app-ready never fires (network timeout, JS error, WKWebView stall),
    // force the splash out so the user is never permanently stuck.
    const safetyTimer = setTimeout(() => {
      isReadyRef.current = true;
      doExit();
    }, SAFETY_TIMEOUT_MS);

    // ── bfcache restore — iOS Safari / iPad PWA ───────────────────────────────
    // When iOS restores a page from the back-forward cache (app backgrounded
    // then resumed), JS timers may fire late.  If the splash is still visible
    // at that point it's stale — dismiss it immediately.
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted && !exitCalledRef.current) {
        doExit();
      }
    }
    window.addEventListener("pageshow", onPageShow);

    // ── visibilitychange guard — iOS app-switcher resume ─────────────────────
    // On some iOS PWA configurations, returning from the app switcher fires
    // visibilitychange without a pageshow.  Dismiss if min time has elapsed.
    function onVisibility() {
      if (document.visibilityState === "visible" && !exitCalledRef.current) {
        if (Date.now() - startRef.current >= MIN_SHOW_MS) {
          doExit();
        }
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("app-ready", handler);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(safetyTimer);
    };
  }, []); // stable — all mutable state lives in refs

  // ── Render ───────────────────────────────────────────────────────────────────
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
        {/* Ambient glow — self-contained GPU layer; expands on slogan reveal */}
        <div aria-hidden="true" style={_glowStyle} />

        {/* Logo ─────────────────────────────────────────────────────────────
            Outer div: CSS entrance + breathe animations + willChange.
            Inner div: scale(1.15) + drop-shadow on its own compositing layer
            so the shadow scales correctly and is independent of the entrance
            transform axis.  display:flex collapses the wrapper to the logo's
            true visual bounds so scale-origin is the logo's optical center. */}
        <div style={_logoOuterStyle}>
          <div style={_logoInnerStyle}>
            <AppLogo size="lg" iconOnly />
          </div>
        </div>

        {/* Divider — thin line between logo and slogan, fades in just before
            the slogan to create a visual "pause" before the text reveal.    */}
        <div aria-hidden="true" style={_dividerStyle} />

        {/* Slogan — reveals 1.10 s after mount */}
        <div style={_sloganWrapStyle}>
          <p className="ls-slogan" style={_sloganTextStyle}>
            Your Guide to Success
          </p>
        </div>
      </div>
    </div>
  );
});
