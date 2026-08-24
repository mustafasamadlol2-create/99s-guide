import React from "react";
import type { SubjectId } from "../../../core/types";

const idBg = new URL("../assets/subject-backgrounds/teal_microbial_world_in_motion.webp", import.meta.url).href;
const ntBg = new URL("../assets/subject-backgrounds/purple_molecular_superfood_still_life.webp", import.meta.url).href;
const rmBg = new URL("../assets/subject-backgrounds/cinematic_blue_data_analytics_workspace.webp", import.meta.url).href;
const caBg = new URL("../assets/subject-backgrounds/cinematic_red_tinted_hospital_care.webp", import.meta.url).href;
const phcBg = new URL("../assets/subject-backgrounds/global_health_network_in_golden_light.webp", import.meta.url).href;
const imdBg = new URL("../assets/subject-backgrounds/microscopic_purple_immune_cell_landscape.webp", import.meta.url).href;
const sscBg = new URL("../assets/subject-backgrounds/pathways_to_scientific_discovery.webp", import.meta.url).href;

const preloadArtworkUrls = [idBg, ntBg, rmBg, caBg, phcBg, imdBg, sscBg];

if (typeof document !== "undefined") {
  for (const href of preloadArtworkUrls) {
    if (!document.head.querySelector(`link[data-flashcard-artwork="${href}"]`)) {
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "image";
      link.href = href;
      link.setAttribute("data-flashcard-artwork", href);
      document.head.appendChild(link);
    }
  }
}

interface SubjectFlashcardArtworkProps {
  subjectId?: SubjectId | string;
  rgb: string;
  className?: string;
}

const artworkMap: Record<string, { src: string; objectPosition?: string; overlay?: string }> = {
  ID: {
    src: idBg,
    objectPosition: "75% center",
    overlay: "linear-gradient(90deg, rgba(19,20,22,0.82) 0%, rgba(19,20,22,0.55) 34%, rgba(19,20,22,0.18) 100%)",
  },
  NT: {
    src: ntBg,
    objectPosition: "70% center",
    overlay: "linear-gradient(90deg, rgba(19,20,22,0.84) 0%, rgba(19,20,22,0.58) 36%, rgba(19,20,22,0.20) 100%)",
  },
  RM: {
    src: rmBg,
    objectPosition: "72% center",
    overlay: "linear-gradient(90deg, rgba(19,20,22,0.84) 0%, rgba(19,20,22,0.58) 34%, rgba(19,20,22,0.22) 100%)",
  },
  CA: {
    src: caBg,
    objectPosition: "76% center",
    overlay: "linear-gradient(90deg, rgba(19,20,22,0.84) 0%, rgba(19,20,22,0.56) 36%, rgba(19,20,22,0.20) 100%)",
  },
  PHC: {
    src: phcBg,
    objectPosition: "75% center",
    overlay: "linear-gradient(90deg, rgba(19,20,22,0.82) 0%, rgba(19,20,22,0.54) 34%, rgba(19,20,22,0.18) 100%)",
  },
  ImD: {
    src: imdBg,
    objectPosition: "73% center",
    overlay: "linear-gradient(90deg, rgba(19,20,22,0.84) 0%, rgba(19,20,22,0.56) 34%, rgba(19,20,22,0.20) 100%)",
  },
  SSC: {
    src: sscBg,
    objectPosition: "70% center",
    overlay: "linear-gradient(90deg, rgba(19,20,22,0.84) 0%, rgba(19,20,22,0.58) 35%, rgba(19,20,22,0.22) 100%)",
  },
  DEFAULT: {
    src: rmBg,
    objectPosition: "center",
    overlay: "linear-gradient(90deg, rgba(19,20,22,0.84) 0%, rgba(19,20,22,0.58) 35%, rgba(19,20,22,0.22) 100%)",
  },
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
        <img
          src={artwork.src}
          alt=""
          className="w-full h-full object-cover select-none"
          style={{ objectPosition: artwork.objectPosition || "center" }}
          loading="eager"
          decoding="sync"
          fetchPriority="high"
          draggable={false}
        />

        <div
          className="absolute inset-0"
          style={{ background: artwork.overlay }}
        />

        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(circle at 78% 34%, rgba(${rgb}, 0.20) 0%, rgba(${rgb}, 0.10) 20%, transparent 56%), radial-gradient(circle at 70% 75%, rgba(${rgb}, 0.14) 0%, transparent 42%)`,
          }}
        />

        <div className="absolute inset-y-0 left-0 w-[58%] bg-gradient-to-r from-[#131416] via-[#131416]/90 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#131416]/82 via-[#131416]/28 to-transparent" />
      </div>
    </div>
  );
}
