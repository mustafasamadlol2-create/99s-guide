import {
  PERSONALIZATION_GLASS_STYLES,
  PERSONALIZATION_HERO_STYLES,
  type GlassStyle,
  type HeroStyle,
} from "../../../shared/personalization";

export const PERSONALIZATION_HERO_ATTRIBUTE = "data-app-hero-style";
export const PERSONALIZATION_GLASS_ATTRIBUTE = "data-app-glass-style";

function isHeroStyle(value: unknown): value is HeroStyle {
  return (
    typeof value === "string" &&
    PERSONALIZATION_HERO_STYLES.includes(value as HeroStyle)
  );
}

function isGlassStyle(value: unknown): value is GlassStyle {
  return (
    typeof value === "string" &&
    PERSONALIZATION_GLASS_STYLES.includes(value as GlassStyle)
  );
}

function syncOptionalAttribute(
  element: HTMLElement,
  attribute: string,
  value: string | null,
): void {
  if (value === null) {
    if (element.hasAttribute(attribute)) element.removeAttribute(attribute);
    return;
  }
  if (element.getAttribute(attribute) !== value) {
    element.setAttribute(attribute, value);
  }
}

/**
 * Reflects committed presentation state into optional DOM attributes.
 *
 * Classic/Balanced intentionally remove their attributes so the existing
 * production CSS remains the default path. Invalid values are treated as
 * defaults and can never become runtime selectors.
 */
export function synchronizePersonalizationPresentation(
  element: HTMLElement,
  heroStyle: unknown,
  glassStyle: unknown,
): void {
  syncOptionalAttribute(
    element,
    PERSONALIZATION_HERO_ATTRIBUTE,
    isHeroStyle(heroStyle) && heroStyle !== "classic" ? heroStyle : null,
  );
  syncOptionalAttribute(
    element,
    PERSONALIZATION_GLASS_ATTRIBUTE,
    isGlassStyle(glassStyle) && glassStyle !== "balanced" ? glassStyle : null,
  );
}