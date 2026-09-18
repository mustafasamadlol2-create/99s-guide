import {
  IMPLEMENTED_THEME_IDS,
  type ImplementedThemeId,
} from "./classic99Tokens";

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

if (
  PERSONALIZATION_THEME_CATALOG.map(({ id }) => id).join("|") !==
  IMPLEMENTED_THEME_IDS.join("|")
) {
  throw new Error("Personalization theme catalog order must match the runtime theme order.");
}