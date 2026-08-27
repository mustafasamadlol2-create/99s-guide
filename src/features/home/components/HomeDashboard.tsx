import { safeJsonParse } from "../../../core/utils/safeJson";
import { getUniqueSubjectLectures, countUniqueSubjectLectures } from "../../../core/utils/subjectLectureCounts";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  memo,
} from "react";
import {
  motion,
  AnimatePresence,
  useReducedMotion,
} from "motion/react";
import type { Variants } from "motion/react";
import {
  Subject,
  SubjectId,
  CalendarEvent,
  UserProgress,
  Lecture,
} from "../../../core/types";
import { useIsTouchDevice } from "../../../core/hooks/useIsTouchDevice";
import { HapticFeedback } from "../../../core/device/haptic";
import { useDeviceProfile } from "../../../core/hooks/useDeviceProfile";
import { getEventIconInfo } from "../../../features/calendar/components/EventIcon";
import {
  Award,
  BookOpen,
  Calendar as CalIcon,
  CheckCircle,
  Clock,
  HelpCircle,
  Play,
  MessageSquare,
  Flame,
  Presentation,
  ArrowRight,
  TrendingUp,
  AlertCircle,
  List,
  AlertTriangle,
  Timer,
  Sparkles,
  Apple,
  ClipboardList,
  Hospital,
  Users,
  Dna,
  ShieldPlus,
  Search,
  Landmark,
} from "lucide-react";

import { getSubjectIconInfo } from "../../../core/utils/subjectIcons";
import { SwipeableSubjectButton } from "../../../features/subjects/components/SwipeableSubjectButton";
import { Language, useTranslation } from "../../../core/i18n/translations";

import { CommandPalette, SearchResultItem } from "../../../components/ui/CommandPalette";

interface HomeDashboardProps {
  isActive?: boolean;
  user: {
    id?: string;
    name: string;
    email: string;
    totalPoints: number;
    level: string;
    levelBadge: string;
    streakDays: number;
  };
  subjects: Subject[];
  dbLectures?: any[];
  calendarEvents: CalendarEvent[];
  progress: UserProgress[];
  globalSearchData?: SearchResultItem[];
  onSelectSubject: (id: SubjectId) => void;
  onSelectLecture: (lecture: Lecture, tab?: "pdf" | "notes" | "mcqs" | "flashcards" | "videos" | "qa") => void;
  onNavigateTab: (tab: string) => void;
  onUpdateEvents: (updated: CalendarEvent[]) => void;
  onAddEvent: (newEvent: CalendarEvent) => void;
  onSearchSelect?: (result: SearchResultItem) => void;
  language?: Language;
}
const StarField = ({
  opacity = "opacity-[0.35]",
  isActive = true,
}: { opacity?: string; isActive?: boolean }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // HTML5 Canvas animation loop for starry particles
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId = 0;
    let width = (canvas.width = canvas.parentElement?.clientWidth || 600);
    let height = (canvas.height = canvas.parentElement?.clientHeight || 260);

    // Honour prefers-reduced-motion: draw a single static snapshot then stop
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Reduce star count on mobile for GPU efficiency (≤768px viewport width)
    const isMobile = window.innerWidth <= 768;
    const numStarsTarget = isMobile ? 60 : 120;

    // Fixed stars with percentage-based coordinates to scale & reposition naturally
    const numStars = numStarsTarget;
    const stars: {
      xPct: number;
      yPct: number;
      size: number;
      baseOpacity: number;
      speed: number;
      phase: number;
      twinkleSpeed: number;
      isBlurred: boolean;
    }[] = [];
    for (let i = 0; i < numStars; i++) {
      stars.push({
        xPct: Math.random(),
        yPct: Math.random(),
        // Sizes range from tiny 0.6px to 2.2px for multiple sizes
        size: 0.6 + Math.random() * 1.6,
        // Opacities range from very subtle (0.05) to bright (0.9)
        baseOpacity:
          Math.random() > 0.8
            ? 0.5 + Math.random() * 0.4
            : 0.05 + Math.random() * 0.35,
        // Slow drift
        speed: 0.0002 + Math.random() * 0.0006,
        phase: Math.random() * Math.PI * 2,
        twinkleSpeed: 0.015 + Math.random() * 0.02,
        // A few tiny blurred stars for atmospheric depth
        isBlurred: Math.random() > 0.75,
      });
    }

    // Subtle atmospheric dust particles
    const numDust = 60;
    const dustParticles: {
      xPct: number;
      yPct: number;
      size: number;
      opacity: number;
      vx: number;
      vy: number;
    }[] = [];
    for (let i = 0; i < numDust; i++) {
      dustParticles.push({
        xPct: Math.random(),
        yPct: Math.random(),
        size: 0.3 + Math.random() * 1.2,
        opacity: 0.01 + Math.random() * 0.04,
        vx: (Math.random() - 0.5) * 0.00005,
        vy: (Math.random() - 0.5) * 0.00005,
      });
    }

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length > 0) {
        const rect = entries[0].contentRect;
        width = canvas.width = rect.width;
        height = canvas.height = rect.height;
        // Re-draw static frame on resize when motion is reduced, or during the
        // sidebar collapse/expand window (keeps stars visible while the rAF
        // loop is paused so the canvas doesn't flash blank mid-toggle).
        if (prefersReducedMotion || document.querySelector(".sidebar-animating")) drawStaticFrame();
      }
    });
    if (canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement);
    }

    // Static single-frame draw for prefers-reduced-motion users
    const drawStaticFrame = () => {
      ctx.clearRect(0, 0, width, height);
      stars.forEach((star) => {
        ctx.fillStyle = `rgba(255,255,255,${star.baseOpacity * 0.7})`;
        ctx.shadowBlur = star.isBlurred ? 3 : 0;
        ctx.shadowColor = `rgba(255,255,255,${star.baseOpacity * 0.5})`;
        ctx.beginPath();
        ctx.arc(star.xPct * width, star.yPct * height, star.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.shadowBlur = 0;
    };

    if (prefersReducedMotion || !isActive) {
      // Draw once and skip the animation loop entirely
      drawStaticFrame();
      return () => {
        resizeObserver.disconnect();
      };
    }

    let isIntersecting = true;
    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const wasIntersecting = isIntersecting;
          isIntersecting = entry.isIntersecting;
          if (isIntersecting && !wasIntersecting) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = requestAnimationFrame(render);
          }
        });
      },
      { threshold: 0.01 },
    );
    intersectionObserver.observe(canvas);

    let time = 0;
    let lastTimestamp = 0;
    const render = (timestamp = performance.now()) => {
      if (!isIntersecting || !isActive || document.visibilityState !== "visible") {
        animationFrameId = 0;
        return;
      }

      // Sidebar collapse/expand window (App.tsx toggles `.sidebar-animating` on
      // the app root): skip the per-frame draw so the toggle's width re-layout
      // doesn't compete with this canvas on the welcome page. The loop keeps
      // running so it resumes automatically once the class is removed.
      if (document.querySelector(".sidebar-animating")) {
        lastTimestamp = 0; // reset clock so resuming doesn't fast-forward drift
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      const elapsed = lastTimestamp === 0 ? 16.67 : Math.min(timestamp - lastTimestamp, 100);
      const frameScale = elapsed / 16.67;
      lastTimestamp = timestamp;
      time += frameScale;
      ctx.clearRect(0, 0, width, height);

      // Draw all stars with premium floating, no disco twinkling
      stars.forEach((star) => {
        // Soft breathing (cycle every ~4-6 seconds)
        const breathing = Math.sin(time * star.twinkleSpeed + star.phase) * 0.2;

        // Random twinkle spike every few seconds
        const twinkleCycle = Math.sin(
          time * star.twinkleSpeed * 0.5 + star.phase * 2,
        );
        const twinkleBoost =
          twinkleCycle > 0.95 ? (twinkleCycle - 0.95) * 8 : 0;

        const opacity = Math.max(
          0.05,
          Math.min(1, star.baseOpacity + breathing + twinkleBoost),
        );

        ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;

        if (star.isBlurred) {
          ctx.shadowBlur = 4;
          ctx.shadowColor = `rgba(255, 255, 255, ${opacity * 0.8})`;
        } else {
          ctx.shadowBlur = 0;
        }

        ctx.beginPath();

        const drawX = (star.xPct * width) % width;
        const drawY = (star.yPct * height) % height;

        ctx.arc(drawX, drawY, star.size, 0, Math.PI * 2);
        ctx.fill();

        // Slow, elegant floating drift upwards and sideways
        star.xPct = (star.xPct + star.speed * 0.5 * frameScale) % 1.0;
        star.yPct = (star.yPct - star.speed * 0.3 * frameScale + 1.0) % 1.0;
      });

      // Draw subtle dust particles
      ctx.shadowBlur = 0;
      dustParticles.forEach((dust) => {
        dust.xPct += dust.vx * frameScale;
        dust.yPct += dust.vy * frameScale;

        // Wrap around
        if (dust.xPct < 0) dust.xPct += 1;
        if (dust.xPct > 1) dust.xPct -= 1;
        if (dust.yPct < 0) dust.yPct += 1;
        if (dust.yPct > 1) dust.yPct -= 1;

        const drawX = dust.xPct * width;
        const drawY = dust.yPct * height;

        ctx.fillStyle = `rgba(255, 255, 255, ${dust.opacity})`;
        ctx.beginPath();
        ctx.arc(drawX, drawY, dust.size, 0, Math.PI * 2);
        ctx.fill();
      });

      animationFrameId = requestAnimationFrame(render);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isActive && !animationFrameId) {
        lastTimestamp = 0;
        animationFrameId = requestAnimationFrame(render);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    render();

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isActive]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`absolute inset-0 w-full h-full pointer-events-none z-0 ${opacity}`}
      style={{ willChange: "transform" }}
    />
  );
};

const RadialGradient = ({
  className = "",
  position,
  from,
  via,
  to,
  blendMode = "",
  opacity = "opacity-100",
}: {
  className?: string;
  position: string;
  from: string;
  via: string;
  to: string;
  blendMode?: string;
  opacity?: string;
}) => (
  <div
    className={`absolute inset-0 bg-[radial-gradient(${position},_var(--tw-gradient-stops))] ${from} ${via} ${to} pointer-events-none z-0 ${blendMode} ${opacity} ${className}`}
  />
);

const AmbientGlow = ({ isRtl }: { isRtl: boolean }) => (
  <>
    {/* Subtle midnight blue radial gradient behind the title */}
    <div
      className={`absolute top-1/2 ${isRtl ? "right-[0%]" : "left-[0%]"} -translate-y-1/2 w-[85%] h-[160%] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#0C1731]/35 via-[#070D1C]/12 to-transparent pointer-events-none z-0`}
    />
    {/* Very faint deep navy nebula texture spanning the hero */}
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-[#09112A]/25 via-[#050914]/8 to-transparent pointer-events-none z-0" />
    {/* Gold ember nebula — bottom-left warmth */}
    <div className="absolute bottom-0 left-0 w-[55%] h-[65%] bg-[radial-gradient(ellipse_at_bottom_left,_rgba(212,175,55,0.14)_0%,_transparent_68%)] pointer-events-none z-0 animate-gold-nebula" />
    {/* Faint blue-violet accent — top-right depth */}
    <div className="absolute top-0 right-0 w-[45%] h-[55%] bg-[radial-gradient(ellipse_at_top_right,_rgba(56,100,210,0.12)_0%,_transparent_65%)] pointer-events-none z-0 animate-blue-nebula" />
  </>
);

// ── HeroBanner Type Definitions ───────────────────────────────────────────────
interface HeroBannerLayout {
  heightClass: string;
  paddingClass: string;
  gapClass: string;
  stackGapClass: string;
  titleClass: string;
  subtitleClass: string;
  pillsClass: string;
  brandClass: string;
  indicatorGap?: string;
}

interface HeroBannerProps {
  isActive: boolean;
  isRtl: boolean;
  smartGreeting: { greeting: string; name: string };
  user: { id?: string; name: string; email: string; totalPoints: number; level: string; levelBadge: string; streakDays: number; signature?: string | null };
  smartSubtitle: { text: string } | null;
  activeMottos: Array<{ id: string; message: string }>;
  mottoIndex: number | null;
  layout: HeroBannerLayout;
  t: (key: string) => string;
  nextEvent: CalendarEvent | null;
  onNavigateTab: (tab: string) => void;
  isWide: boolean;
  isPhone: boolean;
}

const UniversityBadge = ({
  isRtl,
  layout,
  t,
  isPhone,
}: {
  isRtl: boolean;
  layout: HeroBannerLayout;
  t: (key: string) => string;
  isPhone: boolean;
}) => (
  <div
    className="home-hero-university-badge relative flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-[#0D1826]/60 to-[#09111D]/40 border border-[#D4AF37]/28 shadow-[0_1px_8px_rgba(0,0,0,0.4)] w-fit transition-all duration-300 hover:bg-[#0D1826]/70 hover:border-[#D4AF37]/50 hover:shadow-[0_0_14px_rgba(212,175,55,0.15)] overflow-hidden group"
    style={{ transform: isPhone ? "translate3d(0, -20px, 0)" : undefined }}
  >
    <div className="badge-shimmer-sweep" aria-hidden="true" />
    <picture>
      <source srcSet="/baghdad-medical-college-logo.webp" type="image/webp" />
      <img
        src="/baghdad-medical-college-logo.png"
        alt="Baghdad Medical College"
        loading="lazy"
        decoding="async"
        className="w-6 h-6 object-contain relative z-10 drop-shadow-[0_0_7px_rgba(212,175,55,0.7)] transition-transform duration-300 group-hover:scale-110"
      />
    </picture>
    <span
      className={`${layout.brandClass} text-white/85 font-semibold uppercase !tracking-[0.2em] sm:!tracking-[0.3em] font-mono leading-none mt-0 relative z-10`}
    >
      {t("uniBaghdad")}
    </span>
  </div>
);

// ── Exam Countdown ─────────────────────────────────────────────────────────────
const ExamCountdown = memo(function ExamCountdown({
  nextEvent,
}: {
  nextEvent: CalendarEvent;
}) {
  const [diff, setDiff] = useState<{ days: number; hours: number } | null>(null);

  useEffect(() => {
    const calc = () => {
      const dateStr = `${nextEvent.date}T${nextEvent.time || "00:00"}`;
      const ms = new Date(dateStr).getTime() - Date.now();
      if (ms <= 0) return setDiff(null);
      setDiff({
        days: Math.floor(ms / 86400000),
        hours: Math.floor((ms % 86400000) / 3600000),
      });
    };
    calc();
    const id = setInterval(calc, 60_000);
    return () => clearInterval(id);
  }, [nextEvent.date, nextEvent.time]);

  if (!diff) return null;

  const label =
    diff.days > 0
      ? `${diff.days}d ${diff.hours}h`
      : `${diff.hours}h`;

  return (
    <motion.div
      initial={{ opacity: 1, y: 0 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0, duration: 0, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-amber-500/[0.10] to-amber-500/[0.05] border border-amber-500/[0.22] text-amber-300/80 font-mono shadow-[0_0_10px_rgba(245,158,11,0.08)] hover:shadow-[0_0_14px_rgba(245,158,11,0.14)] transition-shadow duration-300"
      style={{ fontSize: "0.67rem", letterSpacing: "0.04em" }}
      aria-label={`${diff.days > 0 ? `${diff.days} days` : `${diff.hours} hours`} until ${nextEvent.title}`}
      title={nextEvent.title}
    >
      <Timer className="shrink-0 text-amber-400" style={{ width: 11, height: 11 }} aria-hidden="true" />
      <span className="truncate max-w-[160px]">
        {label} · {nextEvent.title}
      </span>
    </motion.div>
  );
});


const UpcomingEventAlert = memo(({ nextEvent, isRtl, onNavigateTab, t }: { nextEvent: CalendarEvent; isRtl: boolean; onNavigateTab: (tab: string) => void; t: any }) => {
  const { Icon, colorClass, bgClass } = getEventIconInfo(nextEvent);
  return (
    <div
      className={`home-event-alert p-3.5 rounded-lg ${bgClass} border border-black/5 dark:border-white/[0.12] flex items-center justify-between gap-2.5 ${colorClass} shadow-elevation-1 dark:shadow-elevation-0 transition duration-300`}
      style={{ direction: isRtl ? "rtl" : "ltr" }}
    >
      <div className="flex items-start gap-2.5">
        <Icon className="w-4 h-4 shrink-0 mt-1" />
        <div className="text-sm">
          <span className="font-semibold flex items-center gap-1 antialiased">
            {t("upcomingEventAlert")}
          </span>
          <p className="mt-0.5 font-medium leading-[1.4] font-mono opacity-90 antialiased max-w-3xl">
            <strong>{nextEvent.title}</strong>{" "}
            {t("isScheduledOn")}{" "}
            <strong>{nextEvent.date}</strong>{" "}
            {t("atTime")} {nextEvent.time}.{" "}
            {nextEvent.description}
          </p>
        </div>
      </div>
      <button
        onClick={() => onNavigateTab("calendar")}
        className="button-hover-effect text-xs text-[#804D00] bg-white hover:bg-[#FFF5E5] rounded-lg border border-[#FFD699] dark:bg-[#1C1C1E] dark:text-[var(--text-primary)]/90 dark:border-white/[0.12] dark:hover:bg-white/[0.12] shadow-elevation-1 shrink-0 px-4 py-2 font-semibold cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-med-blue focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950 antialiased"
      >
        {t("openSchedule")}
      </button>
    </div>
  );
});


// Stagger variants shared by HeroBanner children
// NOTE: no `filter` here. A permanent no-op `filter: blur(0px)` used to force a
// compositing filter layer on every hero item; on iOS Safari the layers are torn
// down + rebuilt on each display:none→block tab switch, intermittently painting
// the hero's gradients/text with a corrupted first frame. Pure opacity/y only.
const heroContainerVariants: Variants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1 },
};
const heroItemVariant: Variants = {
  hidden: { opacity: 1, y: 0 },
  visible: { opacity: 1, y: 0 },
};
const heroPillVariant = (i: number): Variants => ({
  hidden: { opacity: 1, y: 0 },
  visible: { opacity: 1, y: 0 },
});

const HeroBanner = memo(({
  isActive, isRtl, smartGreeting, user, smartSubtitle, activeMottos,
  mottoIndex, layout, t,
  nextEvent, onNavigateTab, isWide, isPhone,
}: HeroBannerProps) => {

  // ── Time-aware nebula colour — updates every hour so long sessions stay accurate
  const [currentHour, setCurrentHour] = useState(() => new Date().getHours());
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setCurrentHour(new Date().getHours()), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [isActive]);

  const timeNebulaColor = useMemo(() => {
    if (currentHour >= 5  && currentHour < 9)  return "#1A0B00"; // dawn  — warm amber
    if (currentHour >= 9  && currentHour < 16) return "#0A1633"; // day   — cool blue
    if (currentHour >= 16 && currentHour < 20) return "#150A22"; // dusk  — muted violet
    return "#060A1C";                                              // night — deep indigo
  }, [currentHour]);

  // Aurora start angle shifts with time of day — morning warm, evening cool
  const auroraStartDeg = useMemo(() => {
    if (currentHour >= 5  && currentHour < 9)  return 45;  // dawn  — warm golden offset
    if (currentHour >= 9  && currentHour < 16) return 0;   // day   — cool blue default
    if (currentHour >= 16 && currentHour < 20) return 120; // dusk  — violet shift
    return 200;                                              // night — deep indigo
  }, [currentHour]);

  return (
    <div
      className={[
        "relative rounded-xl md:rounded-xl bg-[#05070B] text-white isolate home-hero-banner overflow-hidden",
        layout.heightClass, layout.paddingClass,
        "shadow-[0_4px_32px_rgba(0,0,0,0.55),0_1px_0_rgba(212,175,55,0.06)_inset] border flex flex-col justify-center group transition-[border-color,box-shadow] duration-500",
        "border-white/[0.07]",
      ].join(" ")}
    >
      {/* ── Background Layers ─────────────────────────────────────────────── */}
      <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none z-0">

        {/* L1: time-aware base gradient + stars */}
        <div className="absolute inset-0 z-0">
          <div
            className="absolute inset-[-10%] opacity-90"
            style={{ background: `radial-gradient(ellipse at center, ${timeNebulaColor} 0%, #05070B 100%)` }}
          />
          <RadialGradient position="ellipse_at_top_right" from="from-[#0E1624]/80" via="via-[#09111D]/80" to="to-[#05070B]/80" />
          <RadialGradient position="circle_at_bottom_left" from="from-[#09111D]" via="via-[#09111D]" to="to-[#05070B]" />
          <StarField opacity="opacity-[0.48]" isActive={isActive} />
        </div>

        {/* L2: ambient glow + slow aurora sweep */}
        <div className="absolute inset-0 z-[1]">
          <AmbientGlow isRtl={isRtl} />
          {/* Aurora — slow rotating conic gradient, start angle shifts with time of day.
               CRITICAL: transform: translate(-50%,-50%) MUST be in the base inline style,
               NOT only in the keyframe. On iOS Safari, when display:none→block restores the
               compositing layer there is a brief pre-keyframe frame where no transform is
               applied; without the base translate the element's top-left corner snaps to the
               hero's center-point, covering only the bottom-right quadrant and causing the
               visible brightness/colour-shift bug. The keyframe now only animates `rotate`
               (CSS individual transform property) which composes with the base translate. */}
          <div
            aria-hidden="true"
            className="hero-aurora-layer absolute top-1/2 left-1/2 w-[220%] h-[220%] pointer-events-none"
            style={{
              transform: "translate(-50%, -50%)",
              background: `conic-gradient(from ${auroraStartDeg}deg, transparent 0deg, rgba(30,58,110,0.52) 60deg, transparent 120deg, rgba(180,120,30,0.26) 200deg, transparent 280deg)`,
              animation: "hero-aurora 28s linear infinite",
            }}
          />
        </div>

        {/* L3: contrast vignette — smooth multi-stop gradient, no abrupt jump */}
        <div className="absolute inset-0 z-[2]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_transparent_28%,_#05070B_160%)]" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#05070B]/55 via-[#05070B]/12 to-transparent opacity-90" />
        </div>

        {/* L4: film grain */}
        <div
          className="absolute inset-0 opacity-[0.032]"
          style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.8\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")' }}
        />

        {/* L5: top gold accent line */}
        <div className="absolute top-0 left-[8%] right-[8%] h-px bg-gradient-to-r from-transparent via-[#D4AF37]/35 to-transparent z-[3]" />
        {/* Bottom subtle line */}
        <div className="absolute bottom-0 left-[15%] right-[15%] h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent z-[3]" />
      </div>

      {/* ── Foreground ────────────────────────────────────────────────────── */}
      <motion.div
        className={[
          "relative z-[3] h-full",
          isWide ? "flex flex-row items-center justify-between gap-6" : `flex flex-col justify-center ${layout.gapClass}`,
        ].join(" ")}
        variants={heroContainerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Left column — text */}
        <div className={`flex flex-col min-w-0 overflow-hidden ${isWide ? "flex-1" : ""} ${layout.gapClass}`}>

          <div className="flex flex-col relative z-10">
            {/* Badge row */}
            <motion.div variants={heroItemVariant} className="flex flex-wrap items-center justify-between gap-2 select-none">
              <UniversityBadge layout={layout} isRtl={isRtl} t={t} isPhone={isPhone} />
              {/* Countdown inline with badge on wide screens */}
              {isWide && nextEvent && <ExamCountdown nextEvent={nextEvent} />}
            </motion.div>

            {/* Greeting + name */}
            <motion.div
              variants={heroItemVariant}
              className={`home-hero-greeting ${layout.stackGapClass} ${isWide ? "max-w-[85%]" : "max-w-[80%] md:max-w-[72%]"} min-w-[260px] relative mt-1 md:mt-2`}
              style={{ marginTop: isPhone ? "0.45rem" : undefined }}
            >
              <div
                className={`absolute top-[-10%] ${isRtl ? "right-[-5%]" : "left-[-5%]"} w-[115%] h-[80%]
                  bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))]
                  from-[#0A1633]/30 via-[#050B1A]/10 to-transparent
                  pointer-events-none rounded-[100%] z-0`}
              />
              <h2 className={`${layout.titleClass} font-display text-white select-none leading-[1.1] antialiased relative z-10 drop-shadow-[0_2px_12px_rgba(0,0,0,0.7)] pb-0 flex flex-col`}>
                <span className="font-normal text-white/75 mb-0 md:mb-0.5" style={{ fontSize: "0.65em" }}>
                  {smartGreeting.greeting}
                </span>
                <span className="font-semibold text-white">
                  {user?.name ? smartGreeting.name : ""}
                  <span
                    className="inline-block ml-1 md:ml-2 w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 xl:w-9 xl:h-9 text-2xl sm:text-3xl md:text-4xl xl:text-[2.25rem] leading-none select-none drop-shadow-sm"
                    aria-hidden="true"
                    role="img"
                  >
                    {/* Morning/Afternoon 05-15 → full sun SVG, Evening 16-19 → city dusk emoji, Night 20-04 → crescent moon emoji */}
                    {currentHour >= 5 && currentHour < 16 ? (
                      /* Full sun — same icon for morning and afternoon */
                      <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                          <radialGradient id="sun-g" cx="50%" cy="50%" r="50%">
                            <stop offset="0%"   stopColor="#FEF9C3" />
                            <stop offset="55%"  stopColor="#FCD34D" />
                            <stop offset="100%" stopColor="#D97706" />
                          </radialGradient>
                        </defs>
                        {/* 8 rays — drawn behind the body, evenly spaced at 45° intervals */}
                        <line x1="12" y1="2"    x2="12"    y2="5"    stroke="#FCD34D" strokeWidth="1.5" strokeLinecap="round" />
                        <line x1="12" y1="19"   x2="12"    y2="22"   stroke="#FCD34D" strokeWidth="1.5" strokeLinecap="round" />
                        <line x1="2"  y1="12"   x2="5"     y2="12"   stroke="#FCD34D" strokeWidth="1.5" strokeLinecap="round" />
                        <line x1="19" y1="12"   x2="22"    y2="12"   stroke="#FCD34D" strokeWidth="1.5" strokeLinecap="round" />
                        <line x1="4.93" y1="4.93" x2="7.05" y2="7.05" stroke="#FCD34D" strokeWidth="1.5" strokeLinecap="round" />
                        <line x1="16.95" y1="16.95" x2="19.07" y2="19.07" stroke="#FCD34D" strokeWidth="1.5" strokeLinecap="round" />
                        <line x1="16.95" y1="7.05" x2="19.07" y2="4.93" stroke="#FCD34D" strokeWidth="1.5" strokeLinecap="round" />
                        <line x1="4.93" y1="19.07" x2="7.05" y2="16.95" stroke="#FCD34D" strokeWidth="1.5" strokeLinecap="round" />
                        {/* Sun body — filled circle with warm gradient */}
                        <circle cx="12" cy="12" r="5" fill="url(#sun-g)" />
                      </svg>
                    ) : currentHour >= 16 && currentHour < 20 ? (
                      "🌆"
                    ) : (
                      "🌙"
                    )}
                  </span>
                </span>
              </h2>

              {/* Motto block — only rendered when a motto is available (no wasted space when empty) */}
              {smartSubtitle && (
              <div
                role="region"
                aria-label={t("dailyMotto")}
                aria-live="polite"
                aria-atomic="true"
                className={[
                  "relative z-10 mt-2 mb-1",
                  isRtl
                    ? "border-r-[1.5px] border-[#D4AF37]/52 pr-4 md:pr-5"
                    : "border-l-[1.5px] border-[#D4AF37]/52 pl-4 md:pl-5",
                ].join(" ")}
              >
                <div className="text-[0.65rem] md:text-[0.7rem] uppercase tracking-[0.15em] text-[#D4AF37]/65 font-semibold mb-1 antialiased flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-[#D4AF37]/55 inline-block" />
                  {t("dailyMotto")}
                </div>
                {/* Dynamic min-height so long mottos are never clipped */}
                <div className="relative flex items-start" style={{ minHeight: "2.8rem" }}>
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.p
                      key={activeMottos.length > 0 && mottoIndex !== null ? (activeMottos[mottoIndex]?.id ?? "default-subtitle") : "default-subtitle"}
                      initial={{ opacity: 1, y: 0 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                      className={`${layout.subtitleClass} text-white/85 font-medium leading-snug md:leading-normal break-words antialiased max-w-[560px] absolute top-0 w-full`}
                    >
                      {smartSubtitle.text}
                    </motion.p>
                  </AnimatePresence>
                </div>
              </div>
              )}

              {/* Countdown below motto on narrow layouts */}
              {!isWide && nextEvent && (
                <div className="mt-1">
                  <ExamCountdown nextEvent={nextEvent} />
                </div>
              )}
            </motion.div>
          </div>

          {/* Pills — decorative identity badges */}
          <ul role="list" aria-label="Student identity" className="flex items-center gap-1.5 relative z-10 list-none p-0 m-0">
            {/* MED SCHOOL — gold accent with live dot */}
            <motion.li
              role="listitem"
              aria-label="Medical school student"
              variants={heroPillVariant(0)}
              className={`${layout.pillsClass} flex items-center gap-2 uppercase font-semibold bg-gradient-to-r from-[#D4AF37]/[0.16] to-[#D4AF37]/[0.08] hover:from-[#D4AF37]/[0.26] hover:to-[#D4AF37]/[0.14] text-amber-300 border border-amber-500/35 hover:border-amber-400/65 hover:shadow-[0_0_18px_3px_rgba(212,175,55,0.22)] font-mono transition-all duration-300 ease-out cursor-default antialiased`}
            >
              {/* Live pulse dot */}
              <span className="relative flex h-[7px] w-[7px] shrink-0" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400/70" />
                <span className="relative inline-flex h-[7px] w-[7px] rounded-full bg-amber-400" />
              </span>
              <Hospital className="w-4 h-4 opacity-90" aria-hidden="true" />
              {t("medSchool")}
            </motion.li>

            {/* STAGE 3 — neutral white */}
            <motion.li
              role="listitem"
              aria-label="Stage 3"
              variants={heroPillVariant(1)}
              className={`${layout.pillsClass} flex items-center gap-2 uppercase font-semibold bg-white/[0.07] hover:bg-white/[0.14] text-white/90 border border-white/[0.14] hover:border-white/[0.32] hover:shadow-[0_0_16px_2px_rgba(255,255,255,0.09)] font-mono transition-all duration-300 ease-out cursor-default antialiased`}
            >
              <BookOpen className="w-4 h-4 opacity-85" aria-hidden="true" />
              {t("stage3")}
            </motion.li>

            {/* BATCH 99 — subtle */}
            <motion.li
              role="listitem"
              aria-label="Batch 99"
              variants={heroPillVariant(2)}
              className={`${layout.pillsClass} flex items-center gap-2 uppercase font-semibold bg-white/[0.055] hover:bg-white/[0.12] text-white/65 hover:text-white/88 border border-white/[0.11] hover:border-white/[0.26] hover:shadow-[0_0_14px_2px_rgba(255,255,255,0.07)] font-mono transition-all duration-300 ease-out cursor-default antialiased`}
            >
              <Users className="w-4 h-4 opacity-75" aria-hidden="true" />
              {t("batch99")}
            </motion.li>
          </ul>
        </div>
        
        {user?.signature && (
          <motion.div
            variants={heroItemVariant}
            className="absolute pointer-events-none z-10
              top-[34%] right-4
              sm:top-[32%] sm:right-5
              md:top-10 md:right-8
              lg:top-12 lg:right-10
              xl:top-14 xl:right-12"
          >
            <img 
              src={user.signature} 
              alt="Signature" 
              className="h-auto object-contain transform -rotate-2 mix-blend-screen opacity-90 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]
                w-24
                sm:w-28
                md:w-36
                lg:w-44
                xl:w-52"
              style={{ filter: "brightness(0) invert(1) drop-shadow(0px 2px 4px rgba(0,0,0,0.5))" }}
            />
          </motion.div>
        )}

      </motion.div>
    </div>
  );
});

const HomeDashboard = memo(function HomeDashboard({
  isActive = true,
  user,
  subjects,
  dbLectures = [],
  calendarEvents,
  progress,
  globalSearchData,
  onSearchSelect,
  onSelectSubject,
  onSelectLecture,
  onNavigateTab,
  onUpdateEvents,
  onAddEvent,
  language = "en",
}: HomeDashboardProps) {
  const isRtl = language === "ar";
  const { t } = useTranslation(language || "en");
  const isTouchDevice = useIsTouchDevice();
  const device = useDeviceProfile();

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);


  // ── Typed Motto item — matches the API shape ──────────────────────────────
  interface MottoItem { id: string; message: string; }

  // --- Daily Motto ---
  const [activeMottos, setActiveMottos] = useState<MottoItem[]>(() => {
    try {
      const cached = localStorage.getItem("cached_active_mottos");
      return cached ? safeJsonParse(cached, []) : [];
    } catch {
      return [];
    }
  });

  const [mottoIndex, setMottoIndex] = useState<number | null>(() => {
    try {
      const cached = localStorage.getItem("cached_active_mottos");
      const parsed = cached ? safeJsonParse(cached, []) : [];
      return parsed.length > 0 ? Math.floor(Math.random() * parsed.length) : null;
    } catch {
      return null;
    }
  });

  const fetchMottos = useCallback(async (signal?: AbortSignal) => {
    try {
      const { apiClient } = await import("../../../core/api/apiClient");
      const res = await apiClient("/api/mottos/active", { signal });
      if (res.ok) {
        const data = await res.json();
        if (data?.mottos && Array.isArray(data.mottos) && isMountedRef.current) {
          const newMottos: MottoItem[] = data.mottos;
          setActiveMottos(newMottos);
          localStorage.setItem("cached_active_mottos", JSON.stringify(newMottos));
          setMottoIndex((prev) => {
            if (prev === null || prev >= newMottos.length) {
              return newMottos.length > 0 ? Math.floor(Math.random() * newMottos.length) : null;
            }
            return prev;
          });
        }
      }
    } catch (err: unknown) {
      // AbortError is intentional — not a real failure; ignore silently
      if (err instanceof Error && err.name === "AbortError") return;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (isActive) fetchMottos(controller.signal);
    // Cancel in-flight request if component unmounts or effect re-runs
    return () => controller.abort();
  }, [fetchMottos, isActive]);

  // Re-fetch mottos when admin creates/updates/deletes one
  useEffect(() => {
    const handler = () => { if (isActive) fetchMottos(); };
    window.addEventListener("socket-motto-updated", handler);
    return () => window.removeEventListener("socket-motto-updated", handler);
  }, [fetchMottos, isActive]);

  // Rotate through mottos every 8 seconds (only when there are multiple)
  useEffect(() => {
    if (!isActive || activeMottos.length <= 1) return;
    const id = setInterval(() => {
      setMottoIndex((prev) => {
        const next = prev === null ? 0 : (prev + 1) % activeMottos.length;
        return next;
      });
    }, 8000);
    return () => clearInterval(id);
  }, [activeMottos.length, isActive]);

  // Pull-to-refresh & Native Toast
  const [nativeToast, setNativeToast] = useState<{
    title: string;
    description: string;
  } | null>(null);

  const showHapticToast = (title: string, description: string) => {
    if (!isMountedRef.current) return;
    setNativeToast({ title, description });
    HapticFeedback.notification("success");
    setTimeout(() => {
      if (isMountedRef.current) {
        setNativeToast(null);
      }
    }, 2800);
  };

    const progressMap = useMemo(() => {
    const map = new Map<string, UserProgress>();
    progress.forEach((p) => map.set(p.lectureId, p));
    return map;
  }, [progress]);

    const subjectProgressMetrics = useMemo(() => {
    const metrics = new Map<string, { totalTasks: number, completedTasks: number, progressPercentage: number }>();

    // Unique lectures (merged modules + matching DB rows) — the backend already
    // merges DB lectures into subject.modules, so counting both would double-count.
    subjects.forEach((subject) => {
      const subjectLectures = getUniqueSubjectLectures(subject, dbLectures);
      const totalTasks = subjectLectures.length * 5;

      let completedTasks = 0;

      const countTasks = (l: { id: string }) => {
        const p = progressMap.get(l.id);
        if (p) {
          if (p.pdfCompleted) completedTasks++;
          if (p.notesCompleted) completedTasks++;
          if (p.videoCompleted) completedTasks++;
          if (p.flashcardsCompleted) completedTasks++;
          if (p.quizCompleted) completedTasks++;
        }
      };

      subjectLectures.forEach(countTasks);

      const progressPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      metrics.set(subject.id, { totalTasks, completedTasks, progressPercentage });
    });
    return metrics;
  }, [subjects, dbLectures, progressMap]);

  // Performance Optimization: Precompute and memoize subject lecture counts.
  // Uses the shared id-based dedupe helper (single source of truth with App.tsx).
  const subjectLectureCounts = useMemo(() => {
    return subjects.reduce(
      (acc, subject) => {
        acc[subject.id] = countUniqueSubjectLectures(subject, dbLectures);
        return acc;
      },
      {} as Record<string, number>,
    );
  }, [subjects, dbLectures]);

  // ── Live hour — keeps greeting accurate even in long sessions ────────────
  const [liveHour, setLiveHour] = useState(() => new Date().getHours());
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setLiveHour(new Date().getHours()), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [isActive]);

  // Dynamic Time-Based Greeting (uses liveHour so it never freezes at mount)
  const smartGreeting = useMemo(() => {
    const hours = liveHour;

    let greetingEn = "Good evening,";
    let greetingAr = "مساء الخير،";

    if (hours >= 5 && hours < 12) {
      greetingEn = "Good morning,";
      greetingAr = "صباح الخير،";
    } else if (hours >= 12 && hours < 17) {
      greetingEn = "Good afternoon,";
      greetingAr = "نهار الخير،";
    }

    const firstName = user?.name ? user.name.split(" ")[0] : null;
    const userNameEn = firstName || "Academic";
    const userNameAr = firstName || "زميلنا الأكاديمي";

    return {
      greeting: isRtl ? greetingAr : greetingEn,
      name: isRtl ? userNameAr : userNameEn,
    };
  }, [user?.name, isRtl, liveHour]);

  // Prioritized subtitle logic
  const smartSubtitle = useMemo(() => {
    if (activeMottos.length > 0 && mottoIndex !== null && mottoIndex < activeMottos.length) {
      return {
        text: activeMottos[mottoIndex].message,
        priority: 1,
      };
    }
    
    return null;
  }, [activeMottos, mottoIndex]);



  

  // Next upcoming public event (Performance: O(N) instead of O(N log N))
  const nextEvent = useMemo(() => {
    const nowStr = new Date().toISOString().split("T")[0];
    let upcoming: any = null;
    let minDateTime = "";
    
    for (let i = 0; i < calendarEvents.length; i++) {
      const e = calendarEvents[i];
      if (e.date >= nowStr) {
        const dateTime = `${e.date} ${e.time}`;
        if (!upcoming || dateTime.localeCompare(minDateTime) < 0) {
          minDateTime = dateTime;
          upcoming = e;
        }
      }
    }
    return upcoming;
  }, [calendarEvents]);

  // Premium Apple responsive parameters for Hero Greeting Banner
  const layout = useMemo(() => {
    const { horizontalSizeClass: h, verticalSizeClass: v, width } = device;

    if (h === "compact" && v === "compact") {
      // iPhone Landscape
      return {
        heightClass: "min-h-[240px] h-auto",
        paddingClass: "px-4 py-6",
        brandClass: "text-caption-2 tracking-[0.25em]",
        titleClass: "text-title font-semibold ",
        subtitleClass: "text-caption opacity-75 font-medium",
        pillsClass: "px-3 py-1 text-xs rounded-full",
        gapClass: "space-y-3",
        stackGapClass: "space-y-2",
        indicatorGap: "gap-3",
      };
    } else if (h === "compact" && v === "regular") {
      // iPhone Portrait — lock only the hero outer frame to the compact
      // dimensions used by the earlier phone design. Child spacing/content is
      // intentionally left untouched so the current badge/greeting/pills
      // tuning remains exactly as-is.
      return {
        heightClass: "h-[252px] min-h-[252px] max-h-[252px]",
        paddingClass: "px-4 py-6",
        brandClass: "text-xs tracking-[0.3em]",
        titleClass: "text-2xl font-semibold ",
        subtitleClass: "text-subheadline opacity-80 font-medium",
        pillsClass: "px-4 py-1 text-xs rounded-full",
        gapClass: "space-y-4",
        stackGapClass: "space-y-3",
        indicatorGap: "gap-3",
      };
    } else if (h === "regular" && v === "compact") {
      // Short / iPhone Plus Landscape
      return {
        heightClass: "min-h-[250px] h-auto",
        paddingClass: "px-4 py-6",
        brandClass: "text-xs tracking-[0.3em]",
        titleClass: "text-2xl font-semibold ",
        subtitleClass: "text-subheadline opacity-80 font-medium",
        pillsClass: "px-4 py-1 text-xs rounded-full",
        gapClass: "space-y-3",
        stackGapClass: "space-y-2.5",
        indicatorGap: "gap-3",
      };
    } else {
      // Regular Width, Regular Height (iPad, MacBook, Desktop)
      if (width < 800) {
        return {
          heightClass: "h-[280px]",
          paddingClass: "px-5 py-8 md:px-6 md:py-10",
          brandClass: "text-xs tracking-[0.32em]",
          titleClass: "text-2xl font-semibold ",
          subtitleClass: "text-body opacity-80 font-medium",
          pillsClass: "px-4.5 py-2 text-xs rounded-full",
          gapClass: "space-y-5",
          stackGapClass: "space-y-4",
          indicatorGap: "gap-3",
        };
      } else if (width < 1200) {
        return {
          heightClass: "h-[300px]",
          paddingClass: "px-6 py-8 md:px-8 md:py-10",
          brandClass: "text-xs tracking-[0.34em]",
          titleClass: "text-3xl font-semibold ",
          subtitleClass: "text-headline opacity-80 font-medium",
          pillsClass: "px-5 py-2 text-sm rounded-full",
          gapClass: "space-y-5",
          stackGapClass: "space-y-4",
          indicatorGap: "gap-3",
        };
      } else if (width < 1600) {
        return {
          heightClass: "h-[320px]",
          paddingClass: "px-8 py-10",
          brandClass: "text-sm tracking-[0.36em]",
          titleClass: "text-[2rem] font-semibold ",
          subtitleClass: "text-title3 opacity-80 font-medium",
          pillsClass: "px-5 py-2 text-sm rounded-full",
          gapClass: "space-y-6",
          stackGapClass: "space-y-4",
          indicatorGap: "gap-3.5",
        };
      } else {
        return {
          heightClass: "h-[340px]",
          paddingClass: "px-10 py-12",
          brandClass: "text-sm tracking-[0.36em]",
          titleClass:
            "text-[2.5rem] font-semibold leading-[1.05] origin-left scale-100",
          subtitleClass: "text-title2 opacity-80 font-medium",
          pillsClass: "px-6 py-3 text-sm rounded-full",
          gapClass: "space-y-6",
          stackGapClass: "space-y-4",
          indicatorGap: "gap-4",
        };
      }
    }
  }, [device]);

  return (
    <div className="home-root relative">
      <motion.div
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="home-body-wrap pb-12"
      >
        {/* Responsive layout structure */}
        <div className={`w-full flex flex-col ${device.spacing} items-start`}>
          {/* Main Dashboard Panel */}
          <div className={`w-full flex flex-col ${device.spacing}`}>
            {/* 1. Welcome Section & Banner */}
            <HeroBanner
              isActive={isActive}
              isRtl={isRtl}
              smartGreeting={smartGreeting}
              user={user}
              smartSubtitle={smartSubtitle}
              activeMottos={activeMottos}
              mottoIndex={mottoIndex}
              layout={layout}
              t={t}
              nextEvent={nextEvent}
              onNavigateTab={onNavigateTab}
              isWide={device.horizontalSizeClass === "regular" && device.width >= 800}
              isPhone={device.isPhone}
            />

            {/* 2. Banner Notification alert */}
            {nextEvent && <UpcomingEventAlert nextEvent={nextEvent} isRtl={isRtl} onNavigateTab={onNavigateTab} t={t} />}

            {/* 3. Global Inline Search & Quick Actions */}
            <div className={`grid grid-cols-1 ${device.isPhone ? "" : "sm:grid-cols-2"} gap-3 items-start`}>
              {!device.isPhone && (
                <div
                  className="w-full relative z-30"
                  style={{
                    animation:
                      "iosSmoothDepthFadeIn 0.8s cubic-bezier(0.23, 1, 0.32, 1) 0.05s backwards",
                    WebkitBackfaceVisibility: "hidden",
                    backfaceVisibility: "hidden",
                  }}
                >
                  <CommandPalette
                    isOpen={true}
                    onClose={() => {}}
                    inline={true}
                    data={globalSearchData}
                    onSelectResult={onSearchSelect}
                  />
                </div>
              )}

              {/* Card 2: Today / Daily Schedule & Tasks */}
              <button
                className={`
 ios-staggered-card relative group flex items-center gap-3 p-4
 bg-white dark:bg-[#1C1C1E] edge-light ambient-glow-emerald
 rounded-xl text-left select-none overflow-hidden
 transition duration-normal ease-[cubic-bezier(0.22,1,0.36,1)]
 ${!isTouchDevice ? "cursor-pointer" : ""}
 `}
                style={
                  {
                    WebkitBackfaceVisibility: "hidden",
                    backfaceVisibility: "hidden",
                    WebkitTransform: "translate3d(0,0,0)",
                    transform: "translate3d(0,0,0)",
                    willChange: "transform, opacity",
                    WebkitTapHighlightColor: "transparent",
                    touchAction: "manipulation",
                  } as any
                }
                 onClick={() => onNavigateTab("calendar")}
              >
                

                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-[#E3F2FD] dark:bg-[rgba(165,243,252,0.15)] text-[#0284C7] dark:text-[rgba(165,243,252,1)] relative z-10 shadow-elevation-1 ring-1 ring-black/[0.04] dark:ring-white/10">
                  <CalIcon className="w-icon-md h-icon-md" />
                </div>
                <span className="text-secondary-label font-display font-semibold text-neutral-600 dark:text-[var(--text-secondary)] relative z-10">
                  {t("dailyScheduleAndTasks")}
                </span>
              </button>
            </div>

            {/* 4. Medical Specialties / Subjects List */}
            <div className="space-y-3">
              <div
                className="home-subject-grid grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3"
                style={{ direction: isRtl ? "rtl" : "ltr" }}
              >
                {subjects.map((subject, index) => {
                  const lecturesCount = subjectLectureCounts[subject.id] || 0;
                  const iconInfo = getSubjectIconInfo(subject.id);
                  const IconComponent = iconInfo.icon;
                  const metrics = subjectProgressMetrics.get(subject.id) || { progressPercentage: 0 };
                  const progressPct = metrics.progressPercentage;

                  return (
                    <SwipeableSubjectButton
                      key={subject.id}
                      subject={subject}
                      lecturesCount={lecturesCount}
                      iconInfo={iconInfo}
                      IconComponent={IconComponent}
                      onSelectSubject={onSelectSubject}
                      isRtl={isRtl}
                      isTouchDevice={isTouchDevice}
                      index={index}
                      progressPct={progressPct}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {nativeToast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
            className="fixed left-1/2 -translate-x-1/2 z-[150] w-[calc(100%-32px)] max-w-sm"
            style={{ top: "calc(16px + env(safe-area-inset-top, 0px))" }}
          >
            <div className="bg-[#1C1C1E]/95 dark:bg-[#2C2C2E]/95 text-white p-4 rounded-md shadow-elevation-3 border border-white/10 flex items-center gap-3">
              <div className="w-avatar-sm h-avatar-sm rounded-full bg-med-blue/10 text-blue-400 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="flex-1 text-left">
                <h5 className="text-caption font-semibold leading-none text-white">
                  {nativeToast.title}
                </h5>
                <p className="text-caption text-neutral-500 dark:text-[#EBEBF599] mt-1 font-medium">
                  {nativeToast.description}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

export default HomeDashboard;
