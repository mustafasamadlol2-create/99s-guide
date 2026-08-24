/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Capacitor } from "@capacitor/core";

type ViteImportMeta = ImportMeta & {
  env?: {
    DEV?: boolean;
    PROD?: boolean;
    VITE_API_BASE_URL?: string;
  };
};

/**
 * Canonical production backend.
 *
 * This acts as a safe fallback when VITE_API_BASE_URL is not injected
 * by the production hosting/build environment.
 */
const PRODUCTION_API_BASE_URL = "https://nine9s-guide.onrender.com";

/**
 * Resolve the API base URL without mixing native and web behavior.
 *
 * Local web development:
 *   relative /api/... URLs
 *
 * Production PWA:
 *   https://nine9s-guide.onrender.com/api/...
 *
 * Capacitor native production:
 *   https://nine9s-guide.onrender.com/api/...
 */
export const getApiBaseUrl = (): string => {
  const metaEnv = (import.meta as ViteImportMeta).env;

  const configuredProductionUrl =
    metaEnv?.VITE_API_BASE_URL?.trim() || PRODUCTION_API_BASE_URL;

  /*
   * NATIVE CAPACITOR
   *
   * Preserve the existing native behavior.
   * Production native continues using exactly the same Render backend.
   */
  if (Capacitor.isNativePlatform()) {
    if (metaEnv?.DEV) {
      /*
       * Native development fallback.
       *
       * Preserve the previous behavior if a normal HTTP(S) origin
       * is deliberately being used during development.
       */
      if (typeof window !== "undefined") {
        const origin = window.location.origin;

        if (
          origin.startsWith("http://") ||
          origin.startsWith("https://")
        ) {
          return origin.replace(/\/+$/, "");
        }
      }

      /*
       * capacitor://localhost must never be used as the API server.
       * Fall back to the configured production backend.
       */
      return configuredProductionUrl.replace(/\/+$/, "");
    }

    return configuredProductionUrl.replace(/\/+$/, "");
  }

  /*
   * WEB / PWA DEVELOPMENT
   *
   * Keep local development relative so the existing local
   * Express/Vite proxy/server continues working.
   */
  if (metaEnv?.DEV) {
    return "";
  }

  /*
   * PRODUCTION PWA
   *
   * Never send /api requests to the Cloudflare SPA origin.
   * Always target the real production backend.
   */
  return configuredProductionUrl.replace(/\/+$/, "");
};

/**
 * Convert a relative API path into the correct runtime URL.
 *
 * Examples:
 *
 * Development web:
 *   /api/auth/me
 *
 * Production PWA:
 *   https://nine9s-guide.onrender.com/api/auth/me
 *
 * Capacitor production:
 *   https://nine9s-guide.onrender.com/api/auth/me
 */
export const getApiUrl = (path: string): string => {
  const base = getApiBaseUrl();

  if (!base) {
    return path;
  }

  const cleanBase = base.endsWith("/")
    ? base.slice(0, -1)
    : base;

  const cleanPath = path.startsWith("/")
    ? path
    : `/${path}`;

  return `${cleanBase}${cleanPath}`;
};