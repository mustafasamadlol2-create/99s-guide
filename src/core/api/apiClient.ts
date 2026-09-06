import { SecureStorage } from "../utils/secureStorage";
import { getApiUrl } from "./api";
import { NativeBridge } from "../../core/device/capacitor/nativeBridge";

/** Per-endpoint in-memory TTL (ms). Returns 0 = do not cache. */
function getEndpointTtl(url: string): number {
  if (url.includes("/api/lectures")) return 5 * 60_000;
  if (url.includes("/api/materials")) return 3 * 60_000;
  if (url.includes("/api/calendar/events")) return 2 * 60_000;
  if (url.includes("/api/notifications")) return 1 * 60_000;
  if (url.includes("/api/users")) return 3 * 60_000;
  if (url.includes("/api/user/mute-status")) return 5 * 60_000;
  return 0;
}

interface ApiClientOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  silent?: boolean;
  bypassCache?: boolean;
  ttl?: number;
  /** Optional caller-owned namespace for in-flight request deduplication. */
  requestKey?: string;
}

interface ApiErrorBody {
  error?: string;
  message?: string;
  banned?: boolean;
  [key: string]: unknown;
}

class ApiCache {
  private static store = new Map<
    string,
    {
      data: string;
      status: number;
      statusText: string;
      headers: [string, string][];
      timestamp: number;
      ttl: number;
    }
  >();

  static get(key: string): Response | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.store.delete(key);
      return null;
    }
    return new Response(entry.data, {
      status: entry.status,
      statusText: entry.statusText,
      headers: new Headers(entry.headers),
    });
  }

  static set(key: string, response: Response, ttl = 30_000): void {
    response
      .clone()
      .text()
      .then((text) => {
        this.store.set(key, {
          data: text,
          status: response.status,
          statusText: response.statusText,
          headers: Array.from(response.headers.entries()),
          timestamp: Date.now(),
          ttl,
        });
      })
      .catch(() => {});
  }

  static invalidate(pattern?: string): void {
    if (!pattern) {
      this.store.clear();
      return;
    }
    for (const key of this.store.keys()) {
      if (key.includes(pattern)) this.store.delete(key);
    }
  }
}

export function clearApiCache(pattern?: string): void {
  ApiCache.invalidate(pattern);
}

function invalidateRelatedCache(method: string, url: string): void {
  if (url.includes("/api/lectures")) {
    ApiCache.invalidate("/api/lectures");
    ApiCache.invalidate("/api/subjects");
  } else if (url.includes("/api/materials")) {
    ApiCache.invalidate("/api/materials");
    ApiCache.invalidate("/api/subjects");
    ApiCache.invalidate("/api/lectures");
  } else if (url.includes("/api/flashcards")) {
    ApiCache.invalidate("/api/materials");
  } else if (url.includes("/api/calendar")) {
    ApiCache.invalidate("/api/calendar");
  } else if (url.includes("/api/qa")) {
    ApiCache.invalidate("/api/qa");
  } else if (url.includes("/api/auth")) {
    ApiCache.invalidate("/api/users");
    ApiCache.invalidate("/api/auth");
  } else if (url.includes("/api/notifications")) {
    ApiCache.invalidate("/api/notifications");
  } else if (url.includes("/api/mottos")) {
    ApiCache.invalidate("/api/mottos");
  } else if (url.includes("/api/reports")) {
    ApiCache.invalidate("/api/reports");
  } else if (url.includes("/api/moderation")) {
    ApiCache.invalidate("/api/moderation");
  } else if (url.includes("/api/users")) {
    ApiCache.invalidate("/api/users");
  } else {
    // Fallback: clear everything if mutation is unrecognized
    ApiCache.invalidate();
  }
}

const pendingRequests = new Map<string, Promise<Response>>();

export async function apiClient(
  input: RequestInfo | URL,
  options: ApiClientOptions = {},
): Promise<Response> {
  const resolvedInput = typeof input === "string" ? getApiUrl(input) : input;
  const url =
    typeof resolvedInput === "string"
      ? resolvedInput
      : resolvedInput instanceof URL
        ? resolvedInput.toString()
        : resolvedInput.url;
  const method = (options.method || "GET").toUpperCase();
  const isApiCall = url.includes("/api/") || url.startsWith("api/");
  const isGet = method === "GET";
  const isSensitivePdfViewerUrl =
    /\/api\/materials\/pdf\/[^/?#]+\/external-url(?:[?#]|$)/.test(url);

  // Signed viewer URLs are user-authorized capabilities. Never store them in
  // the generic URL-only cache, which could survive an in-app account switch.
  if (isApiCall && isGet && !options.bypassCache && !isSensitivePdfViewerUrl) {
    const cached = ApiCache.get(url);
    if (cached) return cached;
  }

  const bodyStr = options.body
    ? typeof options.body === "string"
      ? options.body
      : JSON.stringify(options.body)
    : "";
  const cacheKey = `${method}|${url}|${JSON.stringify(options.headers || {})}|${bodyStr}|bypass:${options.bypassCache ?? false}|request:${options.requestKey || ""}`;

  if (isGet && pendingRequests.has(cacheKey)) {
    const pending = pendingRequests.get(cacheKey)!;
    return (await pending).clone();
  }

  const doFetch = async (): Promise<Response> => {
    const isUpload =
      (options.body &&
        typeof FormData !== "undefined" &&
        options.body instanceof FormData) ||
      url.includes("upload");

    const defaultTimeout = isUpload ? 120_000 : 15_000;
    const {
      timeoutMs = defaultTimeout,
      retries = 3,
      retryDelayMs = 2_000,
      silent = false,
      bypassCache,
      ttl,
      requestKey,
      headers,
      ...fetchOptions
    } = options;

    const mergedHeaders = new Headers(headers);
    mergedHeaders.set("Accept", "application/json");
    mergedHeaders.set("X-Requested-With", "XMLHttpRequest");

    const isCrossOriginRequest = (() => {
      if (typeof window === "undefined") return false;
      try {
        return new URL(url, window.location.href).origin !== window.location.origin;
      } catch {
        return false;
      }
    })();

    mergedHeaders.set("X-Session-Delivery", "bearer");
    
    if (bypassCache) {
      mergedHeaders.set("Cache-Control", "no-cache");
      mergedHeaders.set("Pragma", "no-cache");
    }

    let token: string | null = null;
    try {
      token = await SecureStorage.get("auth_token");
      if (!token && typeof localStorage !== "undefined") {
        token = localStorage.getItem("auth_token");
      }
    } catch (error) {
      console.error("[API AUTH] SecureStorage auth_token read failed", error);
    }

    if (token) {
      mergedHeaders.set("Authorization", `Bearer ${token}`);
    }

    const isPdfExternalUrlRequest = /\/api\/materials\/pdf\/[^/?#]+\/external-url(?:[?#]|$)/.test(url);
    if (isPdfExternalUrlRequest) {
      console.log("[PDF-SECURE AUTH] external-url request", {
        url,
        hasAuthorizationHeader: mergedHeaders.has("Authorization"),
        hasStoredToken: Boolean(token),
        isNative: NativeBridge.isNativePlatform(),
        credentials: "include",
      });
    }

    const isAuthFormEndpoint =
      /\/api\/auth\/(login|register|forgot-password|reset-password)$/.test(url);
    const hadAuthToken = Boolean(token);

    let lastError: Error | null = null;
    const isIdempotent = !fetchOptions.method || fetchOptions.method.toUpperCase() === "GET";
    const actualRetries = isIdempotent ? retries : 0;

    for (let attempt = 0; attempt <= actualRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(resolvedInput, {
          credentials: "include",
          ...fetchOptions,
          cache: bypassCache ? "no-store" : "default",
          headers: mergedHeaders,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (isPdfExternalUrlRequest) {
          console.log("[PDF-SECURE AUTH] external-url response", {
            status: response.status,
            ok: response.ok,
            contentType: response.headers.get("content-type"),
          });
        }

        if (!response.ok) {
          let errorMsg = "An unexpected server error occurred.";
          let parsedBody: ApiErrorBody | null = null;
          try {
            parsedBody = await response.clone().json();
            errorMsg = parsedBody?.error || parsedBody?.message || errorMsg;
          } catch {
            if (response.status === 404) errorMsg = "The requested resource was not found.";
            else if (response.status === 413) errorMsg = "The file uploaded is too large. Please select a smaller file.";
            else if (response.status === 401) errorMsg = "Authentication required. Please log in again.";
            else if (response.status === 403) errorMsg = "Access denied. You do not have permission.";
            else if (response.status >= 500) errorMsg = "The server is currently unavailable. Please try again later.";
          }

          if (response.status === 401 && hadAuthToken && !isAuthFormEndpoint) {
            window.dispatchEvent(new CustomEvent("app-session-expired", { detail: errorMsg }));
          }

          if (response.status === 403 && parsedBody?.banned) {
            window.dispatchEvent(new CustomEvent("user-account-banned", { detail: parsedBody }));
          }

          throw Object.assign(new Error(errorMsg), {
            status: response.status,
            body: parsedBody,
          });
        }

        if (isApiCall && isGet && !bypassCache && !isSensitivePdfViewerUrl) {
          const contentType = response.headers.get("content-type");
          if (contentType?.includes("application/json")) {
            const cacheTtl = ttl || getEndpointTtl(url);
            if (cacheTtl > 0) ApiCache.set(url, response, cacheTtl);
          }
        } else if (isApiCall && !isGet) {
          invalidateRelatedCache(method, url);
        }

        return response;
      } catch (error: any) {
        clearTimeout(timeoutId);

        if (error.status && error.status < 500) {
          lastError = error;
          break;
        }

        if (error.name === "AbortError") {
          lastError = new Error("The server took too long to respond. Retrying shortly.");
        } else if (
          error.message &&
          (error.message.includes("network") || error.message.includes("Failed to fetch"))
        ) {
          lastError = new Error("Unable to connect. Please check your network connection.");
        } else {
          lastError = error;
        }

        if (attempt < actualRetries) {
          await new Promise((resolve) =>
            setTimeout(resolve, retryDelayMs * Math.pow(2, attempt)),
          );
        }
      }
    }

    const lastErrorDetails = lastError as
      | (Error & { status?: number; body?: ApiErrorBody | null })
      | null;
    const isTransientConnectionFailure = Boolean(
      lastError &&
        (lastError.name === "AbortError" ||
          /Unable to connect|Failed to fetch|network connection|too long to respond/i.test(lastError.message)),
    );
    const isRetryableServerFailure =
      lastErrorDetails?.status === 503 && lastErrorDetails.body?.retryable === true;
    const browserIsOffline = typeof navigator !== "undefined" && navigator.onLine === false;
    const isUnauthenticatedResponse =
      lastErrorDetails?.status === 401 && !hadAuthToken && !isAuthFormEndpoint;

    if (
      !silent &&
      !isUnauthenticatedResponse &&
      ((!isTransientConnectionFailure && !isRetryableServerFailure) || browserIsOffline)
    ) {
      window.dispatchEvent(
        new CustomEvent("app-api-error", { detail: lastError?.message }),
      );
    }

    throw lastError || new Error("An unexpected error occurred. Please try again.");
  };

  const promise = doFetch().finally(() => {
    if (isGet) pendingRequests.delete(cacheKey);
  });
  if (isGet) pendingRequests.set(cacheKey, promise);
  return (await promise).clone();
}
