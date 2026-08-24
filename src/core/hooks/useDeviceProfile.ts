import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect, Suspense, memo, lazy } from "react";

type DeviceProfileType =
  | "iPhoneSE" // < 360px
  | "iPhoneCompact" // 360px - 400px (iPhone Mini, iPhone 12/13/14/15)
  | "iPhonePlus" // 401px - 480px (iPhone Plus, Pro Max)
  | "iPadMini" // 481px - 768px
  | "iPadStandard" // 769px - 1024px (iPad Air, Pro 11")
  | "iPadPro13" // 1025px - 1200px (iPad Pro 12.9" / 13")
  | "MacBook" // 1201px - 1440px (MacBook Air/Pro)
  | "SafariDesktop" // 1441px - 1920px (General Safari viewports)
  | "RetinaDisplay"; // > 1921px (Retina 4K/5K displays)

type AppleLayoutType =
  | "iphone-portrait"
  | "iphone-landscape"
  | "ipad-portrait"
  | "ipad-landscape"
  | "macbook"
  | "desktop";

type SizeClass = "compact" | "regular";

interface DeviceProfile {
  width: number;
  height: number;
  profile: DeviceProfileType;
  deviceType: "phone" | "tablet" | "desktop";
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isSmallPhone: boolean; // iPhone SE
  hasDynamicIsland: boolean; // iPhone 14 Pro, 15 series, etc.
  margins: string; // padding-x classes for margin
  spacing: string; // general gap spacing classes
  paddings: string; // block paddings for pages
  horizontalSizeClass: SizeClass;
  verticalSizeClass: SizeClass;
  gridCols: {
    dashboard: string;
    library: string;
    bento: string;
    sidebar: string;
  };
  hasSidebarAlways: boolean; // tablets and desk have sidebar always open, phones collapsible or tabbar
  isLandscape: boolean;
  activeLayout: AppleLayoutType;
  /** Slim icon-only navigation rail — used for small tablets (portrait iPad Mini / small Android tablets) */
  railNav: boolean;
  /** Sidebar width when expanded for this device tier */
  sidebarExpandedWidth: string;
  /** Sidebar width when collapsed for this device tier */
  sidebarCollapsedWidth: string;
}

export function useDeviceProfile(): DeviceProfile {
  const [windowSize, setWindowSize] = useState(() => {
    if (typeof window !== "undefined") {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    return { width: 1024, height: 768 };
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    let timeoutId: NodeJS.Timeout;

    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        // Force synchronous layout reflow before reading dimensions.
        // After background→foreground, iOS WKWebView may report stale
        // innerWidth/innerHeight.  Reading offsetHeight forces the browser
        // to apply the current viewport frame first.
        void document.documentElement.offsetHeight;
        setWindowSize({ width: window.innerWidth, height: window.innerHeight });
      }, 50); // Debounce by 50ms to prevent thrashing
    };

    // visualViewport.resize fires more reliably than window.resize on iOS
    // WKWebView when returning from background or when keyboard changes.
    const handleVisualViewportResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        void document.documentElement.offsetHeight;
        setWindowSize({ width: window.innerWidth, height: window.innerHeight });
      }, 50);
    };

    // orientationchange fires on device rotation — window.resize may be delayed
    const handleOrientationChange = () => {
      clearTimeout(timeoutId);
      // Longer delay to let WKWebView settle after rotation
      timeoutId = setTimeout(() => {
        setWindowSize({ width: window.innerWidth, height: window.innerHeight });
      }, 150);
    };

    // pageshow with persisted=true fires on bfcache restore (iOS Safari/PWA)
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          setWindowSize({ width: window.innerWidth, height: window.innerHeight });
        }, 100);
      }
    };

    window.addEventListener("resize", handleResize, { passive: true });
    window.addEventListener("orientationchange", handleOrientationChange, { passive: true });
    window.addEventListener("pageshow", handlePageShow, { passive: true } as any);

    const vvp = window.visualViewport;
    if (vvp) {
      vvp.addEventListener("resize", handleVisualViewportResize, { passive: true });
    }

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleOrientationChange);
      window.removeEventListener("pageshow", handlePageShow);
      if (vvp) {
        vvp.removeEventListener("resize", handleVisualViewportResize);
      }
    };
  }, []);

  const { width, height } = windowSize;

  return useMemo(() => {
    const isLandscape = width > height;

    // Classify devices strictly into Apple layouts
    let activeLayout: AppleLayoutType = "macbook";
    let deviceType: "phone" | "tablet" | "desktop" = "desktop";
    let profile: DeviceProfileType = "MacBook";
    let isSmallPhone = false;

    // Real iPadOS detection: modern iPad Safari reports a "Macintosh" UA, so
    // touch-capable MacIntel devices count as iPadOS. Needed to classify iPad
    // Pro 11 / 13 landscape (1194 / 1366 px) as tablets instead of desktops.
    const isIpadOS =
      typeof navigator !== "undefined" &&
      (/iPad/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

    // 1. Phone Detection: either very narrow, or landscape phone with shallow height
    const isPhoneWidth = width < 480;
    const isLandscapePhoneHeight = height < 480 && width < 960;

    if (isPhoneWidth || isLandscapePhoneHeight) {
      deviceType = "phone";
      if (isLandscapePhoneHeight) {
        activeLayout = "iphone-landscape";
      } else {
        activeLayout = "iphone-portrait";
      }

      const phoneShortSide = Math.min(width, height);
      if (phoneShortSide <= 350) {
        profile = "iPhoneSE";
        isSmallPhone = true;
      } else if (phoneShortSide <= 400) {
        profile = "iPhoneCompact";
      } else {
        profile = "iPhonePlus";
      }
    }
    // 2. Tablet Detection: narrow widths are tablets outright; for wider
    //    landscape iPads (11"/12.9"/13" Pro up to 1376 px) the iPadOS-touch
    //    check owns the upper boundary so real desktops stay desktop.
    else if (width <= 1180 || (isIpadOS && width <= 1400)) {
      deviceType = "tablet";
      if (isLandscape) {
        activeLayout = "ipad-landscape";
      } else {
        activeLayout = "ipad-portrait";
      }

      if (width <= 768) {
        profile = "iPadMini";
      } else if (width <= 1024) {
        profile = "iPadStandard";
      } else {
        profile = "iPadPro13";
      }
    }
    // 3. Desktop / MacBook Detection
    else {
      deviceType = "desktop";
      if (width <= 1440) {
        activeLayout = "macbook";
        profile = "MacBook";
      } else if (width <= 1920) {
        activeLayout = "desktop";
        profile = "SafariDesktop";
      } else {
        activeLayout = "desktop";
        profile = "RetinaDisplay";
      }
    }

    // Detect notch safety or dynamic island on iOS / modern phones
    const isIOS =
      typeof navigator !== "undefined" &&
      /iPhone|iPad|iPod/.test(navigator.userAgent);
    const hasDynamicIsland = deviceType === "phone" && (height >= 840 || isIOS);

    const isPhone = deviceType === "phone";
    const isTablet = deviceType === "tablet";
    const isDesktop = deviceType === "desktop";

    // Size Classes calculation according to Apple Human Interface Guidelines
    let horizontalSizeClass: SizeClass = "regular";
    let verticalSizeClass: SizeClass = "regular";

    if (deviceType === "phone") {
      if (isLandscape) {
        // iPhone Landscape
        // Plus/Max models have Regular Width, Compact Height in Landscape
        horizontalSizeClass = profile === "iPhonePlus" ? "regular" : "compact";
        verticalSizeClass = "compact";
      } else {
        // iPhone Portrait
        horizontalSizeClass = "compact";
        verticalSizeClass = "regular";
      }
    } else {
      // iPad and Desktop are Regular Width and Regular Height
      horizontalSizeClass = "regular";
      verticalSizeClass = "regular";

      // Slide Over / Split View simulation mappings based on width and height
      if (width < 600) {
        horizontalSizeClass = "compact";
      }
      if (height < 600) {
        verticalSizeClass = "compact";
      }
    }

    // Margins adapt proportionally to size classes
    let margins = "px-4";
    let paddings = "py-6";

    if (horizontalSizeClass === "compact") {
      margins = verticalSizeClass === "compact" ? "px-6" : "px-4";
      paddings = verticalSizeClass === "compact" ? "py-3" : "py-4";
    } else {
      if (width < 800) {
        margins = "px-6";
        paddings = "py-6";
      } else if (width < 1200) {
        margins = "px-8";
        paddings = "py-8";
      } else if (width < 1600) {
        margins = "px-10";
        paddings = "py-10";
      } else {
        margins = "px-12";
        paddings = "py-12";
      }
    }

    // Fluid spacing adaptations based on size class
    let spacing = "gap-4";
    if (horizontalSizeClass === "compact") {
      spacing = verticalSizeClass === "compact" ? "gap-3" : "gap-4";
    } else {
      if (width < 800) {
        spacing = "gap-5";
      } else if (width < 1200) {
        spacing = "gap-6";
      } else if (width < 1600) {
        spacing = "gap-8";
      } else {
        spacing = "gap-8";
      }
    }

    // Apple Layout Column adaptations (CSS grid cols adaptive configuration) based on size classes
    let dashboard = "grid-cols-1";
    let library = "grid-cols-1";
    let bento = "grid-cols-1";
    let sidebar = "w-64";

    if (horizontalSizeClass === "compact") {
      dashboard = "grid-cols-1";
      library = "grid-cols-1";
      bento = "grid-cols-1";
      sidebar = "w-0";
    } else {
      if (width < 800) {
        dashboard = "grid-cols-2";
        library = "grid-cols-2";
        bento = "grid-cols-2";
        sidebar = "w-20";
      } else if (width < 1200) {
        dashboard = "grid-cols-3";
        library = "grid-cols-3";
        bento = "grid-cols-3";
        sidebar = "w-60";
      } else if (width < 1600) {
        dashboard = "grid-cols-4";
        library = "grid-cols-4";
        bento = "grid-cols-4";
        sidebar = "w-64";
      } else {
        const cols = width > 1920 ? 6 : 5;
        dashboard = `grid-cols-4 xl:grid-cols-${cols}`;
        library = `grid-cols-${cols}`;
        bento = `grid-cols-${cols}`;
        sidebar = "w-72";
      }
    }

    // Sidebar visibility rule matching iOS SplitView system
    const hasSidebarAlways = horizontalSizeClass === "regular" && width >= 1024;

    // Rail nav: slim icon-only sidebar for small tablets (portrait iPad Mini, small Android tablets).
    // Tablets 480–899 px get a fixed 68 px icon rail; 900–1179 px get a collapsible sidebar.
    const railNav = isTablet && width < 900;

    // Per-tier sidebar widths so the sidebar can size itself without extra conditionals in the view.
    let sidebarExpandedWidth = "240px";
    let sidebarCollapsedWidth = "68px";
    if (isTablet) {
      sidebarExpandedWidth = "240px";
      sidebarCollapsedWidth = "68px";
    }
    if (railNav) {
      // Rail is always 68 px — there is no "expanded" state.
      sidebarExpandedWidth = "68px";
      sidebarCollapsedWidth = "68px";
    }

    return {
      width,
      height,
      profile,
      deviceType,
      isPhone,
      isTablet,
      isDesktop,
      isSmallPhone,
      hasDynamicIsland,
      margins,
      spacing,
      paddings,
      horizontalSizeClass,
      verticalSizeClass,
      gridCols: {
        dashboard,
        library,
        bento,
        sidebar,
      },
      hasSidebarAlways,
      isLandscape,
      activeLayout,
      railNav,
      sidebarExpandedWidth,
      sidebarCollapsedWidth,
    };
  }, [width, height]);
}
