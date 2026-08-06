/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Capacitor } from "@capacitor/core";

type ViteImportMeta = ImportMeta & {
  env?: {
    DEV?: boolean;
    VITE_API_BASE_URL?: string;
  };
};

/**
 * Automatically switches the API base URL from relative paths (on web)
 * to absolute paths (when running within Capacitor native environments).
 */
export const getApiBaseUrl = (): string => {
  const metaEnv = (import.meta as ViteImportMeta).env;
  let baseUrl = metaEnv?.VITE_API_BASE_URL?.trim();

  if (!baseUrl) {
    if (metaEnv?.DEV) {
      baseUrl = "";
    } else {
      baseUrl = "https://nine9s-guide.onrender.com";
    }
  }

  if (Capacitor.isNativePlatform()) {
    if (!baseUrl && metaEnv?.DEV && typeof window !== "undefined") {
      const origin = window.location.origin;
      if (origin.startsWith("http://") || origin.startsWith("https://")) {
        baseUrl = origin;
      }
    }
  }

  if (baseUrl === "" || baseUrl.startsWith("/")) {
    return "";
  }
  return baseUrl.replace(/\/+$/, "");
};

/**
 * Utility to format and resolve fully-qualified API URLs.
 * Handles duplicate slash reduction dynamically.
 *
 * @param path Relative API path, e.g., "/api/auth/me"
 */
export const getApiUrl = (path: string): string => {
  const base = getApiBaseUrl();
  if (!base) return path;

  const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;

  return `${cleanBase}${cleanPath}`;
};
