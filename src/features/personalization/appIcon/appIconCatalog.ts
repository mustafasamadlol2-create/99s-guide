import type { AppIconId } from "./appIconTypes";

export interface AppIconCatalogItem {
  readonly id: AppIconId;
  readonly nameKey:
    | "my99AppIconOriginalName"
    | "my99AppIconMidnightName"
    | "my99AppIconRoseName"
    | "my99AppIconMonochromeName";
  readonly descriptionKey:
    | "my99AppIconOriginalDescription"
    | "my99AppIconMidnightDescription"
    | "my99AppIconRoseDescription"
    | "my99AppIconMonochromeDescription";
  readonly previewSrc: string;
}

export const APP_ICON_CATALOG: readonly AppIconCatalogItem[] = [
  {
    id: "primary",
    nameKey: "my99AppIconOriginalName",
    descriptionKey: "my99AppIconOriginalDescription",
    previewSrc: "/app-icons/primary.png",
  },
  {
    id: "midnight",
    nameKey: "my99AppIconMidnightName",
    descriptionKey: "my99AppIconMidnightDescription",
    previewSrc: "/app-icons/midnight.png",
  },
  {
    id: "rose",
    nameKey: "my99AppIconRoseName",
    descriptionKey: "my99AppIconRoseDescription",
    previewSrc: "/app-icons/rose.png",
  },
  {
    id: "monochrome",
    nameKey: "my99AppIconMonochromeName",
    descriptionKey: "my99AppIconMonochromeDescription",
    previewSrc: "/app-icons/monochrome.png",
  },
];