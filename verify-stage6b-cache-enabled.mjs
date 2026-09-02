const WORKER_BASE = (
  process.env.CONTENT_WORKER_BASE_URL ||
  "https://99s-content-api.mustafasamadlol2.workers.dev"
).replace(/\/+$/, "");

const CONTENT_SYNC_SECRET = process.env.CONTENT_SYNC_SECRET || "";

function fail(message, details) {
  console.error(`\nFAIL: ${message}`);
  if (details !== undefined) {
    console.error(
      typeof details === "string" ? details : JSON.stringify(details, null, 2)
    );
  }
  process.exit(1);
}

function assert(condition, message, details) {
  if (!condition) fail(message, details);
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...headers,
    },
    cache: "no-store",
  });

  const text = await response.text();
  let body;

  try {
    body = JSON.parse(text);
  } catch {
    fail(`Non-JSON response from ${url}`, {
      status: response.status,
      body: text.slice(0, 300),
    });
  }

  return { response, body };
}

if (!CONTENT_SYNC_SECRET) {
  console.error("CONTENT_SYNC_SECRET is not set in this CMD session.");
  console.error("Use your existing Worker/Render secret locally.");
  console.error("Do NOT send it to ChatGPT.");
  process.exit(2);
}

console.log("99's Guide — Stage 6B Shared Cache Enable Verification");
console.log("------------------------------------------------------");
console.log("Expected cache state: ENABLED");
console.log("Mode: READ-ONLY");
console.log("");

// 1) Health must explicitly say cache enabled.
const health = await fetchJson(`${WORKER_BASE}/health`);

assert(health.response.ok, "/health failed.", health.body);
assert(
  health.body?.sharedContentCache?.enabled === true,
  "Shared cache is not enabled in the Worker.",
  health.body?.sharedContentCache
);

assert(
  health.body?.sharedContentCache?.mode === "cloudflare-cache-api",
  "Unexpected shared cache mode.",
  health.body?.sharedContentCache
);

console.log("Health sharedContentCache.enabled=true — PASS");

// Use a unique empty-result lecture filter so this test has its own cache key.
// This avoids relying on whatever production traffic may already have warmed.
const probe = `__stage6b_probe_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 10)}__`;

const probeUrl =
  `${WORKER_BASE}/internal/content-read/lectures` +
  `?mainSubject=${encodeURIComponent(probe)}`;

// 2) Unauthorized callers must still fail BEFORE cache access.
const unauthorized = await fetchJson(probeUrl);

assert(
  unauthorized.response.status === 401,
  "Unauthorized content read was not blocked.",
  { status: unauthorized.response.status, body: unauthorized.body }
);

assert(
  unauthorized.response.headers.get("x-content-cache") === null,
  "Unauthorized response unexpectedly exposed a shared cache state.",
  { value: unauthorized.response.headers.get("x-content-cache") }
);

console.log("Unauthorized gate: HTTP 401 before cache — PASS");

const authHeaders = {
  "X-Content-Sync-Secret": CONTENT_SYNC_SECRET,
};

// 3) First authorized request for this unique cache key must MISS.
const first = await fetchJson(probeUrl, authHeaders);

assert(first.response.ok, "First cache probe failed.", first.body);
assert(Array.isArray(first.body), "First lecture probe is not an array.");
assert(first.body.length === 0, "Unique probe unexpectedly matched lecture data.", first.body);

const firstState = first.response.headers.get("x-content-cache");
const firstTtl = first.response.headers.get("x-content-cache-ttl");

assert(
  firstState === "MISS",
  "First unique cache probe must be MISS.",
  { actual: firstState, ttl: firstTtl }
);

assert(
  firstTtl === "30",
  "Lecture-list cache TTL is not the expected 30 seconds.",
  { actual: firstTtl }
);

assert(
  first.response.headers.get("cache-control") === "no-store",
  "Render-facing response must remain Cache-Control: no-store.",
  { actual: first.response.headers.get("cache-control") }
);

console.log("First unique lecture probe: MISS — PASS");

// 4) Immediate second request for the exact same canonical key must HIT.
const second = await fetchJson(probeUrl, authHeaders);

assert(second.response.ok, "Second cache probe failed.", second.body);
assert(Array.isArray(second.body) && second.body.length === 0, "Second probe payload changed.");

const secondState = second.response.headers.get("x-content-cache");
const secondTtl = second.response.headers.get("x-content-cache-ttl");

assert(
  secondState === "HIT",
  "Second identical cache probe must be HIT.",
  { actual: secondState, ttl: secondTtl }
);

assert(
  secondTtl === "30",
  "Cache HIT did not preserve the expected lecture TTL marker.",
  { actual: secondTtl }
);

assert(
  second.response.headers.get("cache-control") === "no-store",
  "Cached response exposed a browser/proxy cache directive toward Render.",
  { actual: second.response.headers.get("cache-control") }
);

console.log("Second identical lecture probe: HIT — PASS");

// 5) Canonicalization should treat case-only changes as the same key.
const uppercaseUrl =
  `${WORKER_BASE}/internal/content-read/lectures` +
  `?mainSubject=${encodeURIComponent(probe.toUpperCase())}`;

const canonical = await fetchJson(uppercaseUrl, authHeaders);

assert(canonical.response.ok, "Canonical cache-key probe failed.", canonical.body);
assert(
  canonical.response.headers.get("x-content-cache") === "HIT",
  "Case-insensitive lecture filter did not reuse the canonical cache key.",
  { actual: canonical.response.headers.get("x-content-cache") }
);

console.log("Canonical case-insensitive cache key: HIT — PASS");

console.log("");
console.log("Authentication-before-cache: PRESERVED");
console.log("Render-facing Cache-Control: no-store");
console.log("Shared Cloudflare cache: ACTIVE");
console.log("");
console.log("STAGE 6B SHARED CACHE ENABLE PASS");
console.log("No database was modified.");
