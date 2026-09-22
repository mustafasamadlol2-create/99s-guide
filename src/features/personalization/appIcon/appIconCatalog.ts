import type { AppIconId } from "./appIconTypes";

export interface AppIconCatalogItem {
  readonly id: AppIconId;
  readonly name: Readonly<{ en: string; ar: string }>;
  readonly previewSrc: string;
}

export const APP_ICON_CATALOG: readonly AppIconCatalogItem[] = [
  {
    id: "primary",
    name: { en: "Light", ar: "فاتح" },
    previewSrc: "/app-icons/primary.png",
  },
  {
    id: "midnight",
    name: { en: "Dark", ar: "داكن" },
    previewSrc: "/app-icons/midnight.png",
  },
  {
    id: "rose",
    name: { en: "Rose", ar: "وردي" },
    previewSrc: "/app-icons/rose.png",
  },
  {
    id: "monochrome",
    name: { en: "Monochrome", ar: "أحادي اللون" },
    previewSrc: "/app-icons/monochrome.png",
  },
  {
    id: "navy-outline",
    name: { en: "Navy Outline", ar: "كحلي بخط واضح" },
    previewSrc: "/app-icons/navy-outline.png",
  },
  {
    id: "navy",
    name: { en: "Navy", ar: "كحلي" },
    previewSrc: "/app-icons/navy.png",
  },
  {
    id: "ocean",
    name: { en: "Ocean", ar: "محيطي" },
    previewSrc: "/app-icons/ocean.png",
  },
  {
    id: "red-outline",
    name: { en: "Red Outline", ar: "أحمر بخط واضح" },
    previewSrc: "/app-icons/red-outline.png",
  },
  {
    id: "red",
    name: { en: "Red", ar: "أحمر" },
    previewSrc: "/app-icons/red.png",
  },
  {
    id: "crimson",
    name: { en: "Crimson", ar: "قرمزي" },
    previewSrc: "/app-icons/crimson.png",
  },
  {
    id: "black-outline",
    name: { en: "Black Outline", ar: "أسود بخط واضح" },
    previewSrc: "/app-icons/black-outline.png",
  },
  {
    id: "black",
    name: { en: "Black", ar: "أسود" },
    previewSrc: "/app-icons/black.png",
  },
  {
    id: "gold",
    name: { en: "Gold", ar: "ذهبي" },
    previewSrc: "/app-icons/gold.png",
  },
  {
    id: "sky-outline",
    name: { en: "Sky Outline", ar: "سماوي بخط واضح" },
    previewSrc: "/app-icons/sky-outline.png",
  },
  {
    id: "sky",
    name: { en: "Sky", ar: "سماوي" },
    previewSrc: "/app-icons/sky.png",
  },
  {
    id: "azure",
    name: { en: "Azure", ar: "أزرق سماوي" },
    previewSrc: "/app-icons/azure.png",
  },
  {
    id: "lime",
    name: { en: "Lime", ar: "ليموني" },
    previewSrc: "/app-icons/lime.png",
  },
  {
    id: "pink",
    name: { en: "Pink", ar: "وردي زاهٍ" },
    previewSrc: "/app-icons/pink.png",
  },
  {
    id: "orange",
    name: { en: "Orange", ar: "برتقالي" },
    previewSrc: "/app-icons/orange.png",
  },
  {
    id: "lime-ink",
    name: { en: "Lime Ink", ar: "ليموني داكن" },
    previewSrc: "/app-icons/lime-ink.png",
  },
  {
    id: "lemon-ink",
    name: { en: "Lemon Ink", ar: "أصفر داكن" },
    previewSrc: "/app-icons/lemon-ink.png",
  },
  {
    id: "teal",
    name: { en: "Teal", ar: "تركوازي" },
    previewSrc: "/app-icons/teal.png",
  },
  {
    id: "charcoal-lemon",
    name: { en: "Charcoal Lemon", ar: "فحمي ليموني" },
    previewSrc: "/app-icons/charcoal-lemon.png",
  },
  {
    id: "charcoal-lime",
    name: { en: "Charcoal Lime", ar: "فحمي أخضر" },
    previewSrc: "/app-icons/charcoal-lime.png",
  },
  {
    id: "charcoal-cyan",
    name: { en: "Charcoal Cyan", ar: "فحمي سماوي" },
    previewSrc: "/app-icons/charcoal-cyan.png",
  },
  {
    id: "orange-ink",
    name: { en: "Orange Ink", ar: "برتقالي داكن" },
    previewSrc: "/app-icons/orange-ink.png",
  },
  {
    id: "silver",
    name: { en: "Silver", ar: "فضي" },
    previewSrc: "/app-icons/silver.png",
  },
  {
    id: "graphite",
    name: { en: "Graphite", ar: "جرافيت" },
    previewSrc: "/app-icons/graphite.png",
  },
  {
    id: "pearl",
    name: { en: "Pearl", ar: "لؤلؤي" },
    previewSrc: "/app-icons/pearl.png",
  },
  {
    id: "violet",
    name: { en: "Violet", ar: "بنفسجي" },
    previewSrc: "/app-icons/violet.png",
  },
  {
    id: "bronze",
    name: { en: "Bronze", ar: "برونزي" },
    previewSrc: "/app-icons/bronze.png",
  },
  {
    id: "lilac",
    name: { en: "Lilac", ar: "ليلكي" },
    previewSrc: "/app-icons/lilac.png",
  },
];
