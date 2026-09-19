const MAX_CONFIG_BYTES = 16 * 1024;
const MAX_RECORD_BYTES = 32 * 1024;
const USER_ID = /^(?:usr_[A-Za-z0-9-]{1,120}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const INTENT_ID = /^[A-Za-z0-9._:-]{8,160}$/;
const SUBJECTS = ["ID", "NT", "RM", "CA", "PHC", "ImD", "SSC"];
const THEMES = ["classic-99", "midnight", "ocean", "emerald", "rose", "amber", "violet", "monochrome"];
const HEROES = ["classic", "minimal", "night", "aurora"];
const GLASS = ["clear", "balanced", "frosted"];
const MOTION = ["full", "subtle", "reduced"];
const READING = ["small", "default", "large"];

interface Env {
  PERSONALIZATION_KV: {
    get(key: string, options?: { type: "json"; cacheTtl?: number }): Promise<unknown>;
    put(key: string, value: string): Promise<void>;
  };
  PERSONALIZATION_SYNC_SECRET: string;
}

interface Config {
  version: 1;
  themeId: string;
  heroStyle: string;
  glassStyle: string;
  motionStyle: string;
  readingSize: string;
  home: { subjectOrder: string[] };
}

interface RecordValue {
  recordVersion: 1;
  config: Config;
  revision: string;
  updatedAt: string;
  lastIntentId: string;
}

function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function validConfig(value: unknown): value is Config {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  const home = data.home as Record<string, unknown> | undefined;
  return data.version === 1 &&
    typeof data.themeId === "string" && THEMES.includes(data.themeId) &&
    typeof data.heroStyle === "string" && HEROES.includes(data.heroStyle) &&
    typeof data.glassStyle === "string" && GLASS.includes(data.glassStyle) &&
    typeof data.motionStyle === "string" && MOTION.includes(data.motionStyle) &&
    typeof data.readingSize === "string" && READING.includes(data.readingSize) &&
    !!home && Array.isArray(home.subjectOrder) &&
    home.subjectOrder.length === SUBJECTS.length &&
    new Set(home.subjectOrder).size === SUBJECTS.length &&
    home.subjectOrder.every((item) => typeof item === "string" && SUBJECTS.includes(item)) &&
    bytes(value) <= MAX_CONFIG_BYTES &&
    Object.keys(data).every((key) => ["version", "themeId", "heroStyle", "glassStyle", "motionStyle", "readingSize", "home"].includes(key)) &&
    Object.keys(home).every((key) => key === "subjectOrder");
}

function validRecord(value: unknown): value is RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return data.recordVersion === 1 &&
    Object.keys(data).every((key) => ["recordVersion", "config", "revision", "updatedAt", "lastIntentId"].includes(key)) &&
    validConfig(data.config) &&
    typeof data.revision === "string" && data.revision.length > 0 && data.revision.length <= 256 &&
    typeof data.updatedAt === "string" && Number.isFinite(Date.parse(data.updatedAt)) &&
    typeof data.lastIntentId === "string" && INTENT_ID.test(data.lastIntentId) &&
    bytes(value) <= MAX_RECORD_BYTES;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

function authorized(request: Request, env: Env): boolean {
  const supplied = request.headers.get("x-personalization-sync-secret") ?? "";
  return Boolean(env.PERSONALIZATION_SYNC_SECRET) && constantTimeEqual(supplied, env.PERSONALIZATION_SYNC_SECRET);
}

function canonicalId(path: string): string | null {
  const encoded = path.split("/").filter(Boolean).pop() ?? "";
  let id = "";
  try { id = decodeURIComponent(encoded); } catch { return null; }
  return USER_ID.test(id) ? id : null;
}

function kvKey(id: string): string {
  return `personalization:v1:${encodeURIComponent(id)}`;
}

function newRevision(): string {
  return crypto.randomUUID();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!authorized(request, env)) return json({ error: "Unauthorized." }, 401);
    if (request.method !== "GET" && request.method !== "PUT") return json({ error: "Method not allowed." }, 405);
    const userId = canonicalId(new URL(request.url).pathname);
    if (!userId) return json({ error: "Invalid canonical user ID." }, 400);
    const key = kvKey(userId);

    if (request.method === "GET") {
      const value = await env.PERSONALIZATION_KV.get(key, { type: "json", cacheTtl: 30 }) as unknown;
      if (value === null) return json({ status: "empty", record: null });
      if (!validRecord(value)) return json({ error: "Stored personalization record is invalid." }, 502);
      return json({ status: "ok", record: value });
    }

    if (Number(request.headers.get("content-length") ?? "0") > MAX_RECORD_BYTES) {
      return json({ error: "Personalization record is too large." }, 413);
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid body." }, 400);
    const data = body as Record<string, unknown>;
    if (bytes(body) > MAX_RECORD_BYTES ||
        Object.keys(data).some((key) => !["config", "intentId", "knownRevision"].includes(key))) {
      return json({ error: "Invalid personalization payload." }, 400);
    }
    if (!validConfig(data.config) ||
        typeof data.intentId !== "string" ||
        !INTENT_ID.test(data.intentId) ||
        (data.knownRevision !== null && typeof data.knownRevision !== "string")) {
      return json({ error: "Invalid personalization payload." }, 400);
    }
    const current = await env.PERSONALIZATION_KV.get(key, { type: "json", cacheTtl: 30 }) as unknown;
    if (current !== null && !validRecord(current)) return json({ error: "Stored personalization record is invalid." }, 502);
    if (current && (current as RecordValue).lastIntentId === data.intentId) {
      return json({ status: "ok", record: current });
    }
    const record: RecordValue = {
      recordVersion: 1,
      config: data.config as Config,
      revision: newRevision(),
      updatedAt: new Date().toISOString(),
      lastIntentId: data.intentId as string,
    };
    if (bytes(record) > MAX_RECORD_BYTES) return json({ error: "Personalization record is too large." }, 413);
    try {
      await env.PERSONALIZATION_KV.put(key, JSON.stringify(record));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/429|throttl|rate/i.test(message)) {
        return json({ error: "Personalization sync is temporarily throttled.", retryable: true }, 429, { "retry-after": "5" });
      }
      return json({ error: "Personalization storage is unavailable.", retryable: true }, 503);
    }
    return json({ status: "ok", record });
  },
};