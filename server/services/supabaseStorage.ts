const DEFAULT_BUCKET = "academic-materials";

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const SIGNED_URL_CACHE_SAFETY_MS = 30_000;
const SIGNED_URL_SERVER_REUSE_MS = 30_000;

function getSignedUrlCacheKey(storagePath: string, expiresInSeconds: number): string {
  return `${expiresInSeconds}:${storagePath}`;
}


function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function getConfig() {
  return {
    url: requireEnv("SUPABASE_URL").replace(/\/$/, ""),
    serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    bucket: (process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET).trim(),
  };
}

function encodeStoragePath(storagePath: string): string {
  return storagePath.split("/").map(encodeURIComponent).join("/");
}

function assertSafeStoragePath(storagePath: string): void {
  if (!storagePath || storagePath.startsWith("/") || storagePath.includes("..")) {
    throw new Error("Invalid storage path.");
  }
}

async function storageFetch(url: string, init: RequestInit): Promise<Response> {
  const { serviceRoleKey } = getConfig();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${serviceRoleKey}`);
  headers.set("apikey", serviceRoleKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    return await fetch(url, { ...init, headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function buildMaterialStoragePath(lectureId: string, materialId: string): string {
  const safeLectureId = lectureId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeMaterialId = materialId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `materials/${safeLectureId}/${safeMaterialId}.pdf`;
}

export async function uploadPdfToSupabaseStorage(storagePath: string, fileData: Buffer): Promise<void> {
  assertSafeStoragePath(storagePath);
  const { url, bucket } = getConfig();
  const endpoint = `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeStoragePath(storagePath)}`;
  const response = await storageFetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf",
      "x-upsert": "false",
      "Cache-Control": "3600",
    },
    body: fileData,
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Supabase Storage upload failed (${response.status}): ${detail}`);
  }
}

export async function createSupabaseSignedUrl(storagePath: string, expiresInSeconds = 300): Promise<string> {
  assertSafeStoragePath(storagePath);

  // Signing a private Storage object requires an extra HTTPS round trip to
  // Supabase. Reuse a still-valid signed URL briefly so rapid/repeated PDF
  // opens stay on the hot path instead of paying that network cost every tap.
  const cacheKey = getSignedUrlCacheKey(storagePath, expiresInSeconds);
  const cached = signedUrlCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.url;
  signedUrlCache.delete(cacheKey);

  const { url, bucket } = getConfig();
  const endpoint = `${url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodeStoragePath(storagePath)}`;
  const response = await storageFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: expiresInSeconds }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Supabase Storage signed URL failed (${response.status}): ${detail}`);
  }

  const payload = await response.json() as { signedURL?: string; signedUrl?: string };
  const signedPath = payload.signedURL || payload.signedUrl;
  if (!signedPath) throw new Error("Supabase Storage did not return a signed URL.");

  const signedUrl = signedPath.startsWith("http") ? signedPath : `${url}/storage/v1${signedPath}`;
  const maxSafeReuseMs = Math.max(1_000, expiresInSeconds * 1_000 - SIGNED_URL_CACHE_SAFETY_MS);
  const reuseMs = Math.min(SIGNED_URL_SERVER_REUSE_MS, maxSafeReuseMs);
  signedUrlCache.set(cacheKey, { url: signedUrl, expiresAt: now + reuseMs });
  return signedUrl;
}

export async function deleteSupabaseStorageObject(storagePath: string): Promise<void> {
  assertSafeStoragePath(storagePath);
  const { url, bucket } = getConfig();
  const endpoint = `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeStoragePath(storagePath)}`;
  const response = await storageFetch(endpoint, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Supabase Storage delete failed (${response.status}): ${detail}`);
  }
}
