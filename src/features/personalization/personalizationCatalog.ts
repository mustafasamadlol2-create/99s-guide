import {
  IMPLEMENTED_THEME_IDS,
  type ImplementedThemeId,
} from "./classic99Tokens";
import {
  PERSONALIZATION_GLASS_STYLES,
  PERSONALIZATION_HERO_STYLES,
  type GlassStyle,
  type HeroStyle,
} from "../../../shared/personalization";

export type PersonalizationThemeCatalogItem = {
  id: ImplementedThemeId;
  nameKey: PersonalizationThemeNameKey;
  descriptionKey: PersonalizationThemeDescriptionKey;
};

export type PersonalizationThemeNameKey =
  | "my99ThemeClassicName"
  | "my99ThemeMidnightName"
  | "my99ThemeOceanName"
  | "my99ThemeEmeraldName"
  | "my99ThemeRoseName"
  | "my99ThemeAmberName"
  | "my99ThemeVioletName"
  | "my99ThemeMonochromeName";

export type PersonalizationThemeDescriptionKey =
  | "my99ThemeClassicDescription"
  | "my99ThemeMidnightDescription"
  | "my99ThemeOceanDescription"
  | "my99ThemeEmeraldDescription"
  | "my99ThemeRoseDescription"
  | "my99ThemeAmberDescription"
  | "my99ThemeVioletDescription"
  | "my99ThemeMonochromeDescription";

export const PERSONALIZATION_THEME_CATALOG: readonly PersonalizationThemeCatalogItem[] =
  [
    {
      id: "classic-99",
      nameKey: "my99ThemeClassicName",
      descriptionKey: "my99ThemeClassicDescription",
    },
    {
      id: "midnight",
      nameKey: "my99ThemeMidnightName",
      descriptionKey: "my99ThemeMidnightDescription",
    },
    {
      id: "ocean",
      nameKey: "my99ThemeOceanName",
      descriptionKey: "my99ThemeOceanDescription",
    },
    {
      id: "emerald",
      nameKey: "my99ThemeEmeraldName",
      descriptionKey: "my99ThemeEmeraldDescription",
    },
    {
      id: "rose",
      nameKey: "my99ThemeRoseName",
      descriptionKey: "my99ThemeRoseDescription",
    },
    {
      id: "amber",
      nameKey: "my99ThemeAmberName",
      descriptionKey: "my99ThemeAmberDescription",
    },
    {
      id: "violet",
      nameKey: "my99ThemeVioletName",
      descriptionKey: "my99ThemeVioletDescription",
    },
    {
      id: "monochrome",
      nameKey: "my99ThemeMonochromeName",
      descriptionKey: "my99ThemeMonochromeDescription",
    },
  ] as const;

export type PersonalizationHeroCatalogItem = {
  id: HeroStyle;
  nameKey: PersonalizationHeroNameKey;
  descriptionKey: PersonalizationHeroDescriptionKey;
};

export type PersonalizationHeroNameKey =
  | "my99HeroClassicName"
  | "my99HeroMinimalName"
  | "my99HeroNightName"
  | "my99HeroAuroraName";

export type PersonalizationHeroDescriptionKey =
  | "my99HeroClassicDescription"
  | "my99HeroMinimalDescription"
  | "my99HeroNightDescription"
  | "my99HeroAuroraDescription";

export const PERSONALIZATION_HERO_CATALOG: readonly PersonalizationHeroCatalogItem[] =
  [
    {
      id: "classic",
      nameKey: "my99HeroClassicName",
      descriptionKey: "my99HeroClassicDescription",
    },
    {
      id: "minimal",
      nameKey: "my99HeroMinimalName",
      descriptionKey: "my99HeroMinimalDescription",
    },
    {
      id: "night",
      nameKey: "my99HeroNightName",
      descriptionKey: "my99HeroNightDescription",
    },
    {
      id: "aurora",
      nameKey: "my99HeroAuroraName",
      descriptionKey: "my99HeroAuroraDescription",
    },
  ] as const;

export type PersonalizationGlassCatalogItem = {
  id: GlassStyle;
  nameKey: PersonalizationGlassNameKey;
  descriptionKey: PersonalizationGlassDescriptionKey;
};

export type PersonalizationGlassNameKey =
  | "my99GlassClearName"
  | "my99GlassBalancedName"
  | "my99GlassFrostedName";

export type PersonalizationGlassDescriptionKey =
  | "my99GlassClearDescription"
  | "my99GlassBalancedDescription"
  | "my99GlassFrostedDescription";

export const PERSONALIZATION_GLASS_CATALOG: readonly PersonalizationGlassCatalogItem[] =
  [
    {
      id: "clear",
      nameKey: "my99GlassClearName",
      descriptionKey: "my99GlassClearDescription",
    },
    {
      id: "balanced",
      nameKey: "my99GlassBalancedName",
      descriptionKey: "my99GlassBalancedDescription",
    },
    {
      id: "frosted",
      nameKey: "my99GlassFrostedName",
      descriptionKey: "my99GlassFrostedDescription",
    },
  ] as const;

if (
  PERSONALIZATION_HERO_CATALOG.map(({ id }) => id).join("|") !==
  PERSONALIZATION_HERO_STYLES.join("|")
) {
  throw new Error("Personalization hero catalog order must match the runtime hero order.");
}

if (
  PERSONALIZATION_GLASS_CATALOG.map(({ id }) => id).join("|") !==
  PERSONALIZATION_GLASS_STYLES.join("|")
) {
  throw new Error("Personalization glass catalog order must match the runtime glass order.");
}

if (
  PERSONALIZATION_THEME_CATALOG.map(({ id }) => id).join("|") !==
  IMPLEMENTED_THEME_IDS.join("|")
) {
  throw new Error("Personalization theme catalog order must match the runtime theme order.");
}