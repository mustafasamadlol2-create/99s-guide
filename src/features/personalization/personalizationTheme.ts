import {
  IMPLEMENTED_THEME_IDS,
  type ImplementedThemeId,
} from "./classic99Tokens";
import type { ThemeId } from "../../../shared/personalization";

export const PERSONALIZATION_THEME_ATTRIBUTE = "data-app-theme";

export function isImplementedThemeId(
  requested: ThemeId,
): requested is ImplementedThemeId {
  return IMPLEMENTED_THEME_IDS.includes(requested as ImplementedThemeId);
}

export function resolveVisualThemeId(
  requested: ThemeId,
): ImplementedThemeId {
  return isImplementedThemeId(requested) ? requested : "classic-99";
}

export function getPersonalizationThemeAttribute(
  requested: ThemeId,
): "ocean" | null {
  const visualTheme = resolveVisualThemeId(requested);
  return visualTheme === "classic-99" ? null : visualTheme;
}

export interface ThemeAttributeTarget {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export function synchronizePersonalizationTheme(
  target: ThemeAttributeTarget,
  requested: ThemeId,
): void {
  const desiredAttribute = getPersonalizationThemeAttribute(requested);
  const currentAttribute = target.getAttribute(PERSONALIZATION_THEME_ATTRIBUTE);

  if (desiredAttribute === null) {
    if (currentAttribute !== null) {
      target.removeAttribute(PERSONALIZATION_THEME_ATTRIBUTE);
    }
    return;
  }

  if (currentAttribute !== desiredAttribute) {
    target.setAttribute(PERSONALIZATION_THEME_ATTRIBUTE, desiredAttribute);
  }
}