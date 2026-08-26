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
  /** Inline 128×72 preview of the exact same artwork for zero-blank first paint. */
  placeholder: string;
  accent: string;
  accentRgb: string;
  surfaceClass: string;
}

export const MODULE_ORDER: SubjectId[] = ["PHC", "RM", "CA", "SSC", "ImD", "ID", "NT"];

export const MODULE_VISUALS: Record<SubjectId, ModuleVisualIdentity> = {
  ID: { credits: 11, hours: 187, image: infectiousDiseasesImage, placeholder: "data:image/webp;base64,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", accent: "#34D399", accentRgb: "52,211,153", surfaceClass: "bg-[#F0FBF7] dark:bg-[#11241F]" },
  NT: { credits: 4, hours: 62, image: nutritionImage, placeholder: "data:image/webp;base64,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", accent: "#A78BFA", accentRgb: "167,139,250", surfaceClass: "bg-[#F7F3FF] dark:bg-[#211D2B]" },
  RM: { credits: 5, hours: 76, image: researchMethodologyImage, placeholder: "data:image/webp;base64,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", accent: "#7DD3FC", accentRgb: "125,211,252", surfaceClass: "bg-[#F1FAFE] dark:bg-[#17252B]" },
  CA: { credits: 10, hours: 264, image: clinicalAttachmentImage, placeholder: "data:image/webp;base64,UklGRjgFAABXRUJQVlA4ICwFAABQGwCdASqAAEgAPuluqlCpJqOipnn8+SAdCWMAyfi9T5K+bI2vDw1mncQ9Qa1EsCJj21LZPPqOr4s4FTe+JijLGnPr6EXwrPIkV4hUVM3P1wNOVt6lVSgbkzZ0D87xQZ40gv/lGW9b7L3J094lB9x+vuviIYOkawlP59d2v/aHAwwR4+ULmbl+f7kQ/+fKgZtj+OjEnCia3YWkF9NX0cy6eR9RsAlr4Kl+9TgZSA3xrSjtm/MVSVo4m/0mvfPSSFl/tdqwPEadAFkHenXS/Jo59ZBkwRznIJDCGH0kZeuDQmrAIAD+69OZ0ne00+muUQsgB55BgkiPYQp+/wJLZKJlbPrpYI3fW3DLrdgntbPDKSh98f11aIcWTmXuYSd5DTjn1Rlc3n3nQuZpQFceijTgAwKxTJqTQDdGnsBpSOnd0ORtIq5jMcKa22PGaE4lWkWiuxm2218fneNkz/Hctbs6w1JfzzCmt/mduz1cWTxhsf2qJvhMRO36svT/FaXZtdD4hMcGPHa66dqeeXwlxpqqqZHD56KJzw7Bx6L0y4SFZfauAmLfDKmCIsanIJAKWc28UGOUjs2qI0p7mPe9e5GN50ajjTnqL6/+DjfIl0Mfnxv1SO6aTqn7uOgyr+5Bd2rT4JquaeyGi0iMdo1Q7VH2E/O1h+YX+l2SO5odBiGsRBDnX3+RNsIXD6iscCQNIb45ojnj82G6xxUn+mMHQGLd0wQj7D6sWNbMUOJEC+5cEzDm79RwXTeHBIsbC0JnRXJocPY9AMBTYCwreYNGRldSVR6l7tVjeJDFe0g6jLcl6aCASU0TxkNnPSueRysw0irk4lcTlY3PBzTmA24TzacWxSUJ1faQEfx+ZVr176XJeyFntTIaLxcRdyA8SiJe22ysps7ECVPcC5zlTQC56Yf2svCkgKcp+V+fPqEL3Rp0Q0pQCemS5kJMyp2sHXe5jSlVVY22dbYsYO0VEqoFu9BywnO1Nh5Sd8gRlkpXb4ugtE0gxxJUcADgWwcBuSKsea+eY38NMALl/k5hO7PdP/1288BoVTz1TtLhEijkJDMWDPXaTiony3o7VTMOpFInDwYBucWdUoRtZW6SEN9EWt6+Zn//NDYiwRAX5HNWQ9usqcHXacD8LZdlOH2Nis3PGNpnMoDCEynU6AsCXaq84rdKuL3sH3key6uWaZ3SMPAGK6w/5syMvITWA22rC9dkheX79QctpdjeMfonsfrEBCS8slI6ebIktBfF379D11wchzIaGW0ZevTH9XmPsc/EqA5SJ/9KgwS47SSj9rzeQHj7hwUMpoIDuzmUIroWKNggRHujt7HB28kAF3igmITyMRTpWrHKqzx2gAyHqv/gMiLXtaXvw1SKYogoQ0n0WzB26OGKjIMBV4nKVW+Iyt3EIUE2ShWKOW5TVhiM8xs94NNk9nDNj56WSDwiScBAnwICUiFpo8stHFU1FKRlbS5DzhiwhxGLT4h1UcR6ZhPBmI1smmItthEtnt+D28YaOK5VvlednNO5IaP2wvLKr7E6ZKeFInaSByKRksMC1q6EmtUTlza3y+A7aG9FqxJZuheTtVV0vYJaamYjo6O3jTDOi4zDhfd51AyTCMO7WVjicmq+kKHTe5t/nKu+bB6u3i2NEIblG1MAxwMT3virSFolrDjpklylG7rTPiEY9yvKSz7A0Z2wwpCv5HymEFx+pqV6HSCO7XfqJbsK1GP+gT+Mqab8Q5ApVly+iazitCaqAwmRDjQJVJrMyJtPl+AA", accent: "#FDA4AF", accentRgb: "253,164,175", surfaceClass: "bg-[#FFF4F5] dark:bg-[#2B1D21]" },
  PHC: { credits: 4, hours: 59, image: publicHealthCareImage, placeholder: "data:image/webp;base64,UklGRkQDAABXRUJQVlA4IDgDAADQEgCdASqAAEgAPulorFApJiQirZPJYSAdCUAZsOa2vHOSrbpySoN1LAcahFMfU0J2GuL5NJdPUNeX/KrxClIZ3MTBeEsMHZxu76/V+aeUspa+M1j+ZtpHQoPOejcIJSbvhlFBC6gfZavVEH6cbrcdCBfPhR8ipcFcCjbD96XK3FGf0ed/sfrkZAokYIw8k4aMqxH7wtrl0Cn/JfwLZoAA/vl37BabRt3mYLpqszUTajMafZ7YRVXgAXl44rnkZ8QXbqMUqhQNrXnP33ZCG1s2GHHgDBRLyPlPwYGHZUqMExL5nJ6h4rGGzwFqTuuRuffqRdS4SdNdoFtHH2cngVTZhZfEkFmLpuMXEqhLnScUqjGN9+9d32yqp3IzbgOTn7yOIkDcaRBR7fUDIciponRhtKtshmps4Log67en+NWzmnyGVV2ufiwAmEMTELF5b80EhxrS47S+sUrjIv44UBfEdayuVrJQrJuhEEaJ2eYtsxP5ZMiDDaY+vvCEzCZfaAi+G3NYAIL3a4lomykxHGTr714ak98moB5dfiYtlyQJh2oQXoLTm4IXVUxDkuejpofrHqOKvzutBCBZDF2yLD3RXXwUPAhrOh4m/JzH9Su5mLMitTsopnmx5Q32wmizvmG7NCfMl3+li3Gxdm689qA6ZJdgXsBadyO8/E8BkopGJ0bSsJpPkuUZ/va5iLKNFzeU2I2vToUwYRBE2xL/XMXQBvkIZQ9eNQiBHTJQeAKXAJxfXeVm9utRW0e5Tl612cFEcQyep278vRci3Wsdoe3pwL3yNEPGWWvDgiQJYAFulroIYH3guryzm0sOwxd8Zf6yIFlKJ+Tme0de6mZkpdDG1GHk91XB1Oy5pczeYRUT2wvY+Y3PKjkVN2u/mDvKEO9pYK3KuGe8vHJvNSzWmwGZ0KhgycnqcMbOQTgEh9iDHEQNdpIBk5oU1hgnZBbdYyMcmDqhr+yi8i7aSZ2P4Q9OQkBjLCmMk0Bz4ZNbi+iPPZIjQj6vJ0q5zz8iOVDHLX1jWLpn1otv8P/PWYTWsc+GyhOjaxPVzWmjPzDj1znTXe/oWGMWLg6WddkhmP1rkdp635nYDZAAAA==", accent: "#F6C76F", accentRgb: "246,199,111", surfaceClass: "bg-[#FFF9EB] dark:bg-[#282217]" },
  ImD: { credits: 2, hours: 34, image: immuneDisturbancesImage, placeholder: "data:image/webp;base64,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", accent: "#A5B4FC", accentRgb: "165,180,252", surfaceClass: "bg-[#F4F5FF] dark:bg-[#20212D]" },
  SSC: { credits: 1, hours: 30, image: studentSelectedComponentImage, placeholder: "data:image/webp;base64,UklGRn4DAABXRUJQVlA4IHIDAAAQFwCdASqAAEgAPulgp02pJaQiLNcN+SAdCWUA0aGcHI8/FdNrIfDWpNVx4K7bhktLc5R+7PLtHARb0glYOvRLZWor9ArSguA3GAJhQUzgcJi6NsAofVRrX2iIHoR03lHu51UspZ1Ms7xNWtRWcyVt720EXgvvufEINHPSstW6kuxphXz+dBcBQ2huZvHuboo9A6SBkw0DbxZTeThzAM+3WbjoYiciHs9vV6gj8r7EYmxymY7l/DV3nUTPeaFmTjwAAP7xzewNPVN1LmfWrYb4jvd+GZHKzNqtOX3jyEdnsmSPuuern0Nq+ZWfVZweqgpb+FbJ56BNsFtVt86zRaDfZuJMxhUaj+d4Xv6OdtCM6Xy+X5B16Zcr5ebOdsZ4OgwFz+a+FJ1sDXuWPk58dXqo7WQFSJxsMsv5agjwA6NZzhI6SrCOARGgpFaZaGOdeKtNyxZFNGy14HxiktqI7FVRSelQcf+nbE/817LNB0b3ZH6KT5Nq+mWE9xgfsOofCdZAGTRANdcHFV5h5pmdlsD0zG1lj90HHYRSYNDtiie4wLB1OY5V2PMaVcVday9eLRLxZ4J6cfPDhf6mtKrlZ7UPLFxmOwMbPXGuQGOVXJlrKb/J38Mma6Kf9WyaLoQGRJLXjcKb8IIIzGtVM03XlNqWiojcYaUdSpA916rGUUeHhwGzZsZoFwevvMwFTDHhHfUtUf/34ljHtH5OqB9bYmiABB8S6u3f3i8VLRl8aGjMS4LbZAynvvgoXYmUoJxqvLsf5R+4PNzH8tWX5mC7bfpQ+jhLeYl4ZRm7NZIHzo/jjeX91J8GevpNEm2MPT1vGf8h/KCDcpjj+K5CR1grHXF02XUfKkx0GgldOia7eIsOf16o0/PVk1nNaNA/R11HpHzcYiR5kPjCuxaL/d/lC9txtRz5lFAzPid0ESOqJH4pkcZEYCkjT3O8828wrudvNB29XmT/9Mz1Wu7AhV92KPS9kUKF5GV95hfhJaTf0KvUILo3APCcfumBMVAAzJLDFpsJ47fr9OczGGRt/aM9HVdLWRg3dzyobQXvHrC6YFNXMvPUzX9+Ocquuz2GDDNOQXerBYq+0ULFouUv/0MFc7599OKTtp5Tm6HWdTcfX0Bi+RpjScI6L6Fs/3SQVKWctRei+Ba+3banwCaNVsH3FhyCEAA=", accent: "#D1D5DB", accentRgb: "209,213,219", surfaceClass: "bg-[#F7F7F8] dark:bg-[#202124]" },
};

export const MODULE_ARTWORK_URLS = Object.values(MODULE_VISUALS).map((module) => module.image);

const warmedArtwork = new Set<string>();
const inflightArtwork = new Map<string, Promise<void>>();

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

async function decodeArtwork(src: string, attempt = 0): Promise<void> {
  if (warmedArtwork.has(src) || typeof window === "undefined") return;

  const existing = inflightArtwork.get(src);
  if (existing) return existing;

  const task = new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.setAttribute("fetchpriority", "high");

    let settled = false;
    const finish = async () => {
      if (settled) return;
      settled = true;
      try {
        if (typeof image.decode === "function") await image.decode();
      } catch {
        // Safari/WKWebView may reject decode() after a successful load.
      }
      warmedArtwork.add(src);
      resolve();
    };

    image.onload = () => void finish();
    image.onerror = () => {
      if (settled) return;
      settled = true;
      reject(new Error(`Failed to preload module artwork: ${src}`));
    };

    image.src = src;
    if (image.complete && image.naturalWidth > 0) void finish();
  })
    .catch(async () => {
      inflightArtwork.delete(src);
      if (attempt >= 3) return;
      await wait(120 * (attempt + 1));
      return decodeArtwork(src, attempt + 1);
    })
    .finally(() => {
      inflightArtwork.delete(src);
    });

  inflightArtwork.set(src, task);
  return task;
}

let allArtworkPromise: Promise<void> | null = null;

export function preloadModuleArtwork(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (allArtworkPromise) return allArtworkPromise;

  allArtworkPromise = Promise.allSettled(MODULE_ARTWORK_URLS.map((src) => decodeArtwork(src))).then(() => undefined);
  return allArtworkPromise;
}

// Start high-priority image requests immediately when this shared identity file is evaluated.
if (typeof document !== "undefined") {
  MODULE_ARTWORK_URLS.forEach((href) => {
    const absoluteHref = new URL(href, window.location.href).href;
    const alreadyPreloaded = Array.from(document.head.querySelectorAll('link[rel="preload"][as="image"]')).some(
      (node) => (node as HTMLLinkElement).href === absoluteHref,
    );
    if (alreadyPreloaded) return;

    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = href;
    link.setAttribute("fetchpriority", "high");
    document.head.appendChild(link);
  });

  void preloadModuleArtwork();
}
