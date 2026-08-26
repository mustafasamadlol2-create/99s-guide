import type { SubjectId } from "../../core/types";

import clinicalAttachmentImage from "./assets/clinical-attachment.webp";
import immuneDisturbancesImage from "./assets/immune-disturbances.webp";
import infectiousDiseasesImage from "./assets/infectious-diseases.webp";
import nutritionImage from "./assets/nutrition.webp";
import publicHealthCareImage from "./assets/public-health-care.webp";
import researchMethodologyImage from "./assets/research-methodology.webp";
import studentSelectedComponentImage from "./assets/student-selected-component.webp";

export interface ModuleVisualIdentity {
  credits: number;
  hours: number;
  image: string;
  accent: string;
  accentRgb: string;
  surfaceClass: string;
}

export const MODULE_ORDER: SubjectId[] = ["PHC", "RM", "CA", "SSC", "ImD", "ID", "NT"];

/**
 * Single source of truth for the seven module visual identities.
 * Both the Modules grid and the module detail page consume this map so the
 * artwork and subject accent can never drift apart between the two screens.
 */
export const MODULE_VISUALS: Record<SubjectId, ModuleVisualIdentity> = {
  ID: {
    credits: 11,
    hours: 187,
    image: infectiousDiseasesImage,
    accent: "#34D399",
    accentRgb: "52,211,153",
    surfaceClass: "bg-[#F0FBF7] dark:bg-[#11241F]",
  },
  NT: {
    credits: 4,
    hours: 62,
    image: nutritionImage,
    accent: "#A78BFA",
    accentRgb: "167,139,250",
    surfaceClass: "bg-[#F7F3FF] dark:bg-[#211D2B]",
  },
  RM: {
    credits: 5,
    hours: 76,
    image: researchMethodologyImage,
    accent: "#7DD3FC",
    accentRgb: "125,211,252",
    surfaceClass: "bg-[#F1FAFE] dark:bg-[#17252B]",
  },
  CA: {
    credits: 10,
    hours: 264,
    image: clinicalAttachmentImage,
    accent: "#FDA4AF",
    accentRgb: "253,164,175",
    surfaceClass: "bg-[#FFF4F5] dark:bg-[#2B1D21]",
  },
  PHC: {
    credits: 4,
    hours: 59,
    image: publicHealthCareImage,
    accent: "#F6C76F",
    accentRgb: "246,199,111",
    surfaceClass: "bg-[#FFF9EB] dark:bg-[#282217]",
  },
  ImD: {
    credits: 2,
    hours: 34,
    image: immuneDisturbancesImage,
    accent: "#A5B4FC",
    accentRgb: "165,180,252",
    surfaceClass: "bg-[#F4F5FF] dark:bg-[#20212D]",
  },
  SSC: {
    credits: 1,
    hours: 30,
    image: studentSelectedComponentImage,
    accent: "#D1D5DB",
    accentRgb: "209,213,219",
    surfaceClass: "bg-[#F7F7F8] dark:bg-[#202124]",
  },
};

export const MODULE_ARTWORK_URLS = Object.values(MODULE_VISUALS).map((module) => module.image);
