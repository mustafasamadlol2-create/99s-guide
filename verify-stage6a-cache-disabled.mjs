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

console.log("99's Guide — Stage 6A Guarded Shared Cache Verification");
console.log("-------------------------------------------------------");
console.log("Expected cache state: DISABLED / BYPASS");
console.log("Mode: READ-ONLY");
console.log("");

// Health should explicitly report disabled.
const health = await fetchJson(`${WORKER_BASE}/health`);
assert(health.response.ok, "/health failed.", health.body);
assert(
  health.body?.sharedContentCache?.enabled === false,
  "Shared cache is already enabled. Stage 6A requires it to remain disabled.",
  health.body?.sharedContentCache
);
console.log("Health sharedContentCache.enabled=false — PASS");

// Unauthorized callers must still be blocked before any cache lookup.
const unauthorized = await fetchJson(
  `${WORKER_BASE}/internal/content-read/lectures`
);
assert(
  unauthorized.response.status === 401,
  "Unauthorized content read was not blocked.",
  { status: unauthorized.response.status, body: unauthorized.body }
);
assert(
  unauthorized.response.headers.get("x-content-cache") === null,
  "Unauthorized response unexpectedly exposed a cache state."
);
console.log("Unauthorized gate: HTTP 401 before cache — PASS");

// Authorized shared read should bypass because the flag is still off.
const authorized = await fetchJson(
  `${WORKER_BASE}/internal/content-read/lectures`,
  {
    "X-Content-Sync-Secret": CONTENT_SYNC_SECRET,
  }
);

assert(authorized.response.ok, "Authorized lecture read failed.", authorized.body);
assert(Array.isArray(authorized.body), "Lecture payload is not an array.");

const cacheState = authorized.response.headers.get("x-content-cache");
assert(
  cacheState === "BYPASS",
  "Stage 6A expected X-Content-Cache: BYPASS.",
  { actual: cacheState }
);

assert(
  authorized.response.headers.get("cache-control") === "no-store",
  "Internal response must remain no-store toward Render.",
  { actual: authorized.response.headers.get("cache-control") }
);

console.log(`Authorized lectures: ${authorized.body.length} rows — BYPASS PASS`);
console.log("Render-facing Cache-Control: no-store — PASS");
console.log("");
console.log("STAGE 6A GUARDED SHARED CACHE PASS");
console.log("Cache is installed but NOT enabled.");
console.log("No database was modified.");
