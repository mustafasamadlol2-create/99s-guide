import { SecureStorage } from "../utils/secureStorage";
import { isIosDevice } from "../utils/platform";
import { getApiUrl } from "./api";
import { NativeBridge } from "../../core/device/capacitor/nativeBridge";

/** Per-endpoint in-memory TTL (ms). Returns 0 = do not cache. */
function getEndpointTtl(url: string): number {
  if (url.includes("/api/materials"))         return 5 * 60_000;
  if (url.includes("/api/lectures"))           return 5 * 60_000;
  if (url.includes("/api/calendar"))           return 2 * 60_000;
  if (url.includes("/api/notifications"))      return 1 * 60_000;
  if (url.includes("/api/users"))              return 3 * 60_000;
  return 0; // everything else: no in-memory caching
}

interface ApiClientOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  silent?: boolean;
  bypassCache?: boolean;
  ttl?: number;
}

// Memory-efficient, auto-expiring Cache Engine for instantaneous API response prefetching
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
    const isExpired = Date.now() - entry.timestamp > entry.ttl;
    if (isExpired) {
      this.store.delete(key);
      return null;
    }
    // Recreate a standard Response object so it can be cloned/read multiple times safely
    return new Response(entry.data, {
      status: entry.status,
      statusText: entry.statusText,
      headers: new Headers(entry.headers),
    });
  }

  static set(key: string, response: Response, ttl: number = 30000): void {
    const cloned = response.clone();
    cloned
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
      .catch((err) => {
        
      });
  }

  static invalidate(pattern?: string): void {
    if (!pattern) {
      this.store.clear();
      
      return;
    }
    for (const key of this.store.keys()) {
      if (key.includes(pattern)) {
        this.store.delete(key);
        
      }
    }
  }

  static clear(): void {
    this.store.clear();
  }
}

const pendingRequests = new Map<string, Promise<Response>>();

// Centralized Interceptor to make all requests benefit from prefetching and smart memoization
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
  const method = (options?.method || "GET").toUpperCase();
  const isApiCall = url.includes("/api/") || url.startsWith("api/");
  const isGet = method === "GET";

  // Serve GET responses from in-memory ApiCache when not bypassing and within TTL
  if (isApiCall && isGet && !options.bypassCache) {
    const cached = ApiCache.get(url);
    if (cached) return cached;
  }
  
  // Deduplicate ALL identical requests in flight (Prevents double taps and duplicate POSTs instantly)
  const bodyStr = options.body ? (typeof options.body === "string" ? options.body : JSON.stringify(options.body)) : "";
  const cacheKey = `${method}|${url}|${JSON.stringify(options.headers || {})}|${bodyStr}|bypass:${options.bypassCache ?? false}`;
  if (cacheKey && pendingRequests.has(cacheKey)) {
    const req = pendingRequests.get(cacheKey);
    if (req) {
      const res = await req;
      return res.clone(); // Return a clone so multiple consumers can read the body
    }
    // fallback if somehow missing
    const resFall = await fetch(getApiUrl(url), options);
    return resFall.clone();
  }

  const doFetch = async () => {
    const isUpload = (options.body && typeof FormData !== 'undefined' && options.body instanceof FormData) || url.includes("upload");
    const defaultTimeout = isUpload ? 30000 : 15000;
    const {
      timeoutMs = defaultTimeout,
      retries = 3,
      retryDelayMs = 2000,
      silent = false,
      bypassCache,
      ttl,
      headers,
      ...fetchOptions
    } = options;
  
    const mergedHeaders = new Headers(headers);
    mergedHeaders.set("Accept", "application/json");
    // CSRF protection: this custom header triggers a CORS preflight for cross-origin
    // requests, which the server rejects for non-whitelisted origins in production.
    // It also lets the server reject credential-bearing state-changing requests that
    // arrive without JavaScript (e.g. HTML form submissions, cross-origin redirects).
    mergedHeaders.set("X-Requested-With", "XMLHttpRequest");
    // All iOS devices (both installed PWA and regular Safari): ask the server
    // to also return the session token in auth response bodies
    // (login / register / refresh).  The token is stored in SecureStorage and
    // sent via the Authorization header below — the server accepts either the
    // cookie or the Bearer token.  Using Bearer for all iPhone/iPad sessions
    // makes auth resilient to cookie loss (ITP, Replit cold-start, Safari tab
    // recycling) and prevents the "auto-logout every ~hour" issue on iPhone.
    if (isIosDevice()) {
      mergedHeaders.set("X-Session-Delivery", "bearer");
    }
    // Strictly prevent browser and proxy caching to guarantee latest data
    if (bypassCache) {
      mergedHeaders.set("Cache-Control", "no-cache");
      mergedHeaders.set("Pragma", "no-cache");
    }

    const token = await SecureStorage.get("auth_token");
    if (token) {
      mergedHeaders.set("Authorization", `Bearer ${token}`);
    }
  
    let lastError: Error | null = null;
    const isIdempotent =
      !fetchOptions.method || fetchOptions.method.toUpperCase() === "GET";
    const actualRetries = isIdempotent ? retries : 0; // Don't retry POST/PUT/DELETE automatically to avoid duplicates
  
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
  
        if (!response.ok) {
          let errorMsg = "An unexpected server error occurred.";
          let parsedBody: any = null;
          try {
            parsedBody = await response.json();
            errorMsg = parsedBody.error || parsedBody.message || errorMsg;
          } catch (e) {
            if (response.status === 404)
              errorMsg = "The requested resource was not found.";
            else if (response.status === 401)
              errorMsg = "Authentication required. Please log in again.";
            else if (response.status === 403)
              errorMsg = "Access denied. You do not have permission.";
            else if (response.status >= 500)
              errorMsg =
                "The server is currently unavailable. Please try again later.";
          }
  
          if (response.status === 401) {
            window.dispatchEvent(
              new CustomEvent("app-session-expired", { detail: errorMsg }),
            );
          }

          // Global ban enforcement: any 403+banned response notifies the app
          if (response.status === 403 && parsedBody?.banned) {
            window.dispatchEvent(
              new CustomEvent("user-account-banned", { detail: parsedBody }),
            );
          }
  
          const error = new Error(errorMsg);
          (error as any).status = response.status;
          (error as any).body = parsedBody; // Attach parsed body for callers to inspect
          throw error;
        }
  
        // Cache successful GET responses with per-endpoint TTLs
        if (isApiCall && isGet && !bypassCache) {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const cacheTtl = ttl || getEndpointTtl(url);
            if (cacheTtl > 0) {
              ApiCache.set(url, response, cacheTtl);
            }
          }
        }
  
        return response;
      } catch (error: any) {
        clearTimeout(timeoutId);
  
        // If the error was a legitimate API response error (like 400, 401, 403, 404), do not retry.
        if (error.status && error.status < 500) {
          lastError = error;
          break;
        }
  
        if (error.name === "AbortError") {
          lastError = new Error(
            "The request timed out. Retrying or please check your internet connection.",
          );
        } else if (
          error.message &&
          (error.message.includes("network") ||
            error.message.includes("Failed to fetch"))
        ) {
          lastError = new Error(
            "Unable to connect. Please check your network connection.",
          );
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
  
    if (!silent) {
      window.dispatchEvent(
        new CustomEvent("app-api-error", { detail: lastError?.message }),
      );
    }
  
    throw (
      lastError || new Error("An unexpected error occurred. Please try again.")
    );
  };

  if (cacheKey) {
    const promise = doFetch().finally(() => pendingRequests.delete(cacheKey));
    pendingRequests.set(cacheKey, promise);
    const res = await promise;
    return res.clone();
  }
  return doFetch();
}
