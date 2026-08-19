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
// Production fallback: the SPA is served from a static host (Cloudflare), so
// relative API calls would hit that host and receive HTML instead of JSON.
// Unless VITE_API_BASE_URL is provided at build time, production builds always
// target the Render backend so REST, socket.io, and /uploads reach the real API.
const PRODUCTION_API_BASE_URL = "";

export const getApiBaseUrl = (): string => {
  const metaEnv = (import.meta as ViteImportMeta).env;
  // Development always uses the local Express/Vite server. A production URL
  // in .env must not redirect local sign-in requests to a remote backend.
  let baseUrl = metaEnv?.DEV
    ? ""
    : metaEnv?.VITE_API_BASE_URL?.trim() || PRODUCTION_API_BASE_URL;

  if (Capacitor.isNativePlatform()) {
    if (!baseUrl && metaEnv?.DEV && typeof window !== "undefined") {
      const origin = window.location.origin;
      if (origin.startsWith("http://") || origin.startsWith("https://")) {
        baseUrl = origin;
      }
    }
  }

  if (!Capacitor.isNativePlatform() && typeof window !== "undefined") {
    baseUrl = "";
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
