/**
 * Classic 99 semantic token contract.
 *
 * Prompt 5 deliberately defines one production baseline only. The alternate
 * theme IDs remain part of the V1 personalization contract, but they do not
 * receive visual token values here.
 */

export type Classic99Appearance = "light" | "dark";

export interface Classic99SemanticTokens {
  backgroundPage: string;
  backgroundGrouped: string;
  surfacePrimary: string;
  surfaceElevated: string;
  surfaceMuted: string;
  contentPrimary: string;
  contentSecondary: string;
  contentSubtle: string;
  borderDefault: string;
  borderStrong: string;
  actionAccent: string;
  actionAccentSoft: string;
  focusRing: string;
  navigationActiveBackground: string;
  navigationActiveForeground: string;
  glassSurface: string;
  glassBorder: string;
  genericShadow: string;
  heroBackground: string;
  heroGlowPrimary: string;
  heroGlowSecondary: string;
}

/**
 * These values are intentionally explicit rather than derived from a future
 * theme palette. They document the current Classic 99 light/dark appearance
 * that the CSS semantic variables expose.
 */
export const CLASSIC_99_SEMANTIC_TOKENS: Readonly<
  Record<Classic99Appearance, Classic99SemanticTokens>
> = Object.freeze({
  light: Object.freeze({
    backgroundPage: "#fafafa",
    backgroundGrouped: "#eef0f5",
    surfacePrimary: "#fbfbfd",
    surfaceElevated: "#ffffff",
    surfaceMuted: "#e5e5ea",
    contentPrimary: "#1c1c1e",
    contentSecondary: "#8e8e93",
    contentSubtle: "rgba(60, 60, 67, 0.6)",
    borderDefault: "rgba(0, 0, 0, 0.04)",
    borderStrong: "rgba(0, 0, 0, 0.08)",
    actionAccent: "#007aff",
    actionAccentSoft: "rgba(0, 122, 255, 0.1)",
    focusRing: "#007aff",
    navigationActiveBackground: "rgba(229, 229, 234, 0.8)",
    navigationActiveForeground: "#1c1c1e",
    glassSurface: "rgba(255, 255, 255, 0.6)",
    glassBorder: "rgba(0, 0, 0, 0.05)",
    genericShadow:
      "0 2px 8px rgba(0, 0, 0, 0.04), 0 4px 16px rgba(0, 0, 0, 0.02)",
    heroBackground: "#05070b",
    heroGlowPrimary: "rgba(30, 58, 110, 0.52)",
    heroGlowSecondary: "rgba(180, 120, 30, 0.26)",
  }),
  dark: Object.freeze({
    backgroundPage: "#000000",
    backgroundGrouped: "#000000",
    surfacePrimary: "#000000",
    surfaceElevated: "#1c1c1e",
    surfaceMuted: "#2c2c2e",
    contentPrimary: "#ffffff",
    contentSecondary: "rgba(235, 235, 245, 0.72)",
    contentSubtle: "rgba(235, 235, 245, 0.46)",
    borderDefault: "rgba(255, 255, 255, 0.06)",
    borderStrong: "rgba(255, 255, 255, 0.12)",
    actionAccent: "#007aff",
    actionAccentSoft: "rgba(0, 122, 255, 0.1)",
    focusRing: "#007aff",
    navigationActiveBackground: "rgba(255, 255, 255, 0.12)",
    navigationActiveForeground: "#ffffff",
    glassSurface: "rgba(34, 34, 36, 0.55)",
    glassBorder: "rgba(255, 255, 255, 0.05)",
    genericShadow: "0 1px 4px rgba(0, 0, 0, 0.3)",
    heroBackground: "#05070b",
    heroGlowPrimary: "rgba(30, 58, 110, 0.52)",
    heroGlowSecondary: "rgba(180, 120, 30, 0.26)",
  }),
});

/**
 * Fixed semantic colors are intentionally outside the appearance map. Future
 * theme implementations must not override these status or domain meanings.
 */
export const CLASSIC_99_FIXED_SEMANTIC_TOKENS = Object.freeze({
  statusError: "#ff3b30",
  statusSuccess: "#34c759",
  statusWarning: "#ff9500",
  statusOffline: "#8e8e93",
  statusOnline: "#34c759",
  actionDestructive: "#ff3b30",
  validationError: "#ff3b30",
  domainAcademicGold: "#d4af37",
});

export function getClassic99SemanticTokens(
  appearance: Classic99Appearance,
): Classic99SemanticTokens {
  return CLASSIC_99_SEMANTIC_TOKENS[appearance];
}