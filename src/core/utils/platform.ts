/**
 * Platform detection helpers — single source of truth for iOS / PWA checks.
 *
 * iPhone/iPod always match the UA regex. Modern iPad Safari reports a
 * "Macintosh" UA (desktop mode) so it intentionally does NOT match — iPads
 * take the desktop popup OAuth path, which works correctly there.
 */

/** True on iPhone / iPod / legacy iPad (mobile-UA Safari). */
export function isIosDevice(): boolean {
  return typeof navigator !== "undefined" && /iP(ad|hone|od)/.test(navigator.userAgent);
}

/** True when running as an installed (home-screen / standalone) PWA. */
export function isStandalonePwa(): boolean {
  if (typeof navigator !== "undefined" && (navigator as any).standalone === true) return true;
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches
  );
}

/**
 * True when running as an installed PWA on an iOS device.
 *
 * This container has unreliable cookie behavior:
 *  - External navigations open an in-app browser sheet with a SEPARATE
 *    cookie jar — cookies set there never reach the installed app.
 *  - The httpOnly session cookie itself is not dependably persisted.
 *
 * Auth flows must therefore use Bearer-token delivery in this environment
 * (the server supports both cookie and Authorization-header sessions).
 */
export function isIosStandalonePwa(): boolean {
  return isIosDevice() && isStandalonePwa();
}
