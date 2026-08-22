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
 * API URL resolution rules:
 *
 * 1. Local web development:
 *    Use relative API paths so requests reach the local Express/Vite server.
 *
 * 2. Production PWA/Web:
 *    Use VITE_API_BASE_URL so requests go directly to the production backend
 *    instead of being sent to the static Cloudflare frontend origin.
 *
 * 3. Capacitor native:
 *    Preserve the existing native behavior and use the production API URL.
 */

const PRODUCTION_API_BASE_URL = "";

export const getApiBaseUrl = (): string => {
  const metaEnv = (import.meta as ViteImportMeta).env;

  const configuredProductionUrl =
    metaEnv?.VITE_API_BASE_URL?.trim() || PRODUCTION_API_BASE_URL;

  /*
   * CAPACITOR / NATIVE
   *
   * Keep the existing native behavior intact.
   */
  if (Capacitor.isNativePlatform()) {
    let nativeBaseUrl = metaEnv?.DEV ? "" : configuredProductionUrl;

    if (
      !nativeBaseUrl &&
      metaEnv?.DEV &&
      typeof window !== "undefined"
    ) {
      const origin = window.location.origin;

      if (
        origin.startsWith("http://") ||
        origin.startsWith("https://")
      ) {
        nativeBaseUrl = origin;
      }
    }

    if (
      nativeBaseUrl === "" ||
      nativeBaseUrl.startsWith("/")
    ) {
      return "";
    }

    return nativeBaseUrl.replace(/\/+$/, "");
  }

  /*
   * WEB / PWA
   *
   * Development continues using relative URLs so the local Vite/Express
   * environment works exactly as before.
   */
  if (metaEnv?.DEV) {
    return "";
  }

  /*
   * Production PWA must use the real backend URL.
   *
   * Without this, /api/... requests are sent to the Cloudflare frontend
   * origin instead of the Render backend.
   */
  if (
    configuredProductionUrl === "" ||
    configuredProductionUrl.startsWith("/")
  ) {
    return "";
  }

  return configuredProductionUrl.replace(/\/+$/, "");
};

/**
 * Utility to format and resolve fully-qualified API URLs.
 *
 * Example:
 *   getApiUrl("/api/auth/me")
 *
 * Development web:
 *   /api/auth/me
 *
 * Production PWA / Capacitor:
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