import React from "react";
import type { SubjectId } from "../../../core/types";

const idDark = new URL("../assets/subject-backgrounds/infectious-diseases-dark.webp", import.meta.url).href;
const idLight = new URL("../assets/subject-backgrounds/infectious-diseases-light.webp", import.meta.url).href;
const ntDark = new URL("../assets/subject-backgrounds/nutrition-dark.webp", import.meta.url).href;
const ntLight = new URL("../assets/subject-backgrounds/nutrition-light.webp", import.meta.url).href;
const rmDark = new URL("../assets/subject-backgrounds/research-methodology-dark.webp", import.meta.url).href;
const rmLight = new URL("../assets/subject-backgrounds/research-methodology-light.webp", import.meta.url).href;
const caDark = new URL("../assets/subject-backgrounds/clinical-attachment-dark.webp", import.meta.url).href;
const caLight = new URL("../assets/subject-backgrounds/clinical-attachment-light.webp", import.meta.url).href;
const phcDark = new URL("../assets/subject-backgrounds/public-health-care-dark.webp", import.meta.url).href;
const phcLight = new URL("../assets/subject-backgrounds/public-health-care-light.webp", import.meta.url).href;
const imdDark = new URL("../assets/subject-backgrounds/immune-disturbances-dark.webp", import.meta.url).href;
const imdLight = new URL("../assets/subject-backgrounds/immune-disturbances-light.webp", import.meta.url).href;
const sscDark = new URL("../assets/subject-backgrounds/student-selected-component-dark.webp", import.meta.url).href;
const sscLight = new URL("../assets/subject-backgrounds/student-selected-component-light.webp", import.meta.url).href;

const preloadArtworkUrls = [
  idDark,
  idLight,
  ntDark,
  ntLight,
  rmDark,
  rmLight,
  caDark,
  caLight,
  phcDark,
  phcLight,
  imdDark,
  imdLight,
  sscDark,
  sscLight,
];

// These 14 optimized WebP assets total well under 1 MB. Preloading them when the
// lecture-detail chunk is opened prevents the visible 1–2 second artwork pop-in
// when the user switches to Anki or MCQ for the first time.
if (typeof document !== "undefined") {
  for (const href of preloadArtworkUrls) {
    if (!document.head.querySelector(`link[data-subject-artwork="${href}"]`)) {
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "image";
      link.href = href;
      link.setAttribute("data-subject-artwork", href);
      document.head.appendChild(link);
    }
  }
}

interface SubjectFlashcardArtworkProps {
  subjectId?: SubjectId | string;
  rgb: string;
  className?: string;
}

type ArtworkPair = {
  dark: string;
  light: string;
  objectPosition?: string;
};

const artworkMap: Record<string, ArtworkPair> = {
  ID: { dark: idDark, light: idLight, objectPosition: "center" },
  NT: { dark: ntDark, light: ntLight, objectPosition: "center" },
  RM: { dark: rmDark, light: rmLight, objectPosition: "center" },
  CA: { dark: caDark, light: caLight, objectPosition: "center" },
  PHC: { dark: phcDark, light: phcLight, objectPosition: "center" },
  ImD: { dark: imdDark, light: imdLight, objectPosition: "center" },
  SSC: { dark: sscDark, light: sscLight, objectPosition: "center" },
  DEFAULT: { dark: rmDark, light: rmLight, objectPosition: "center" },
};

export function SubjectFlashcardArtwork({
  subjectId,
  rgb,
  className = "",
}: SubjectFlashcardArtworkProps) {
  const artwork = artworkMap[String(subjectId || "DEFAULT")] || artworkMap.DEFAULT;

  return (
    <div
      className={`pointer-events-none overflow-hidden ${className}`}
      aria-hidden="true"
    >
      <div className="absolute inset-0 rounded-[inherit] overflow-hidden">
        {/* Light-mode artwork */}
        <img
          src={artwork.light}
          alt=""
          className="absolute inset-0 block h-full w-full select-none object-cover dark:hidden"
          style={{ objectPosition: artwork.objectPosition || "center" }}
          loading="eager"
          decoding="async"
          fetchPriority="high"
          draggable={false}
        />

        {/* Dark-mode artwork */}
        <img
          src={artwork.dark}
          alt=""
          className="absolute inset-0 hidden h-full w-full select-none object-cover dark:block"
          style={{ objectPosition: artwork.objectPosition || "center" }}
          loading="eager"
          decoding="async"
          fetchPriority="high"
          draggable={false}
        />

        {/* A uniform veil keeps text readable without creating a left/right panel split. */}
        <div className="absolute inset-0 bg-white/[0.08] dark:bg-black/[0.10]" />

        {/* Subject tint is deliberately subtle and continuous over the whole artwork. */}
        <div
          className="absolute inset-0 opacity-45 dark:opacity-55"
          style={{
            background: `radial-gradient(circle at 72% 46%, rgba(${rgb}, 0.10) 0%, rgba(${rgb}, 0.035) 34%, transparent 72%)`,
          }}
        />
      </div>
    </div>
  );
}
