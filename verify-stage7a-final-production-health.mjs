const RENDER_BASE = (
  process.env.RENDER_BASE_URL || "https://nine9s-guide.onrender.com"
).replace(/\/+$/, "");

const WORKER_BASE = (
  process.env.CONTENT_WORKER_BASE_URL ||
  "https://99s-content-api.mustafasamadlol2.workers.dev"
).replace(/\/+$/, "");

const AUTH_TOKEN = process.env.AUTH_TOKEN || "";
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

function containsCorrectAnswer(value) {
  if (Array.isArray(value)) return value.some(containsCorrectAnswer);
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "correctAnswer")) return true;
    return Object.values(value).some(containsCorrectAnswer);
  }
  return false;
}

async function fetchJson(base, pathname, headers = {}) {
  const response = await fetch(`${base}${pathname}`, {
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
    fail(`Non-JSON response from ${pathname}`, {
      status: response.status,
      body: text.slice(0, 300),
    });
  }

  return { response, body };
}

async function renderGet(pathname) {
  return fetchJson(RENDER_BASE, pathname, {
    Authorization: `Bearer ${AUTH_TOKEN}`,
    "X-Requested-With": "XMLHttpRequest",
    "Cache-Control": "no-cache",
  });
}

async function workerGet(pathname, authorized = true) {
  return fetchJson(
    WORKER_BASE,
    pathname,
    authorized ? { "X-Content-Sync-Secret": CONTENT_SYNC_SECRET } : {}
  );
}

function expectHeader(result, name, expected, label) {
  const actual = result.response.headers.get(name);
  assert(actual === expected, `${label} source header mismatch.`, {
    header: name,
    expected,
    actual,
  });
}

if (!AUTH_TOKEN) {
  console.error("AUTH_TOKEN is not set in this CMD session.");
  console.error("Use your current logged-in JWT access token locally.");
  console.error("Do NOT send it to ChatGPT.");
  process.exit(2);
}

if (!CONTENT_SYNC_SECRET) {
  console.error("CONTENT_SYNC_SECRET is not set in this CMD session.");
  console.error("Use your existing Content Worker secret locally.");
  console.error("Do NOT send it to ChatGPT.");
  process.exit(2);
}

console.log("99's Guide — Stage 7A Final Production Health Audit");
console.log("---------------------------------------------------");
console.log("Mode: READ-ONLY");
console.log("");

// Worker health: D1, R2, sync secret, cache.
const health = await workerGet("/health", false);
assert(health.response.ok, "Worker /health failed.", health.body);
assert(health.body?.ok === true, "Worker health ok=false.", health.body);
assert(health.body?.worker?.status === "ready", "Worker is not ready.", health.body?.worker);
assert(health.body?.d1?.connected === true, "D1 health failed.", health.body?.d1);
assert(health.body?.r2?.connected === true, "R2 health failed.", health.body?.r2);
assert(
  health.body?.r2?.objectCheckCompleted === true,
  "R2 object-list health check did not complete.",
  health.body?.r2
);
assert(
  health.body?.contentSync?.configured === true,
  "Content sync secret/configuration is not active.",
  health.body?.contentSync
);
assert(
  health.body?.sharedContentCache?.enabled === true,
  "Shared content cache is not enabled.",
  health.body?.sharedContentCache
);
assert(
  health.body?.sharedContentCache?.mode === "cloudflare-cache-api",
  "Unexpected shared cache mode.",
  health.body?.sharedContentCache
);
console.log("Worker + D1 + R2 + ContentSync + Cache health — PASS");

// Private Worker read gate.
const unauthorized = await workerGet("/internal/content-read/lectures", false);
assert(
  unauthorized.response.status === 401,
  "Private Worker content route did not reject unauthenticated request.",
  { status: unauthorized.response.status, body: unauthorized.body }
);
assert(
  unauthorized.response.headers.get("x-content-cache") === null,
  "Unauthorized request reached/exposed cache state."
);
console.log("Private Worker authentication gate — PASS");

// Lectures
const lectures = await renderGet("/api/lectures");
assert(lectures.response.ok, "Render /api/lectures failed.", lectures.body);
assert(Array.isArray(lectures.body) && lectures.body.length > 0, "Lecture list invalid.");
expectHeader(lectures, "x-content-read-source", "d1", "Lectures");
assert(!containsCorrectAnswer(lectures.body), "Lecture list leaked correctAnswer.");
console.log(`Lectures: ${lectures.body.length} rows, source=D1 — PASS`);

const lectureId = lectures.body[0]?.id;
assert(lectureId, "No lecture id found.");

const detail = await renderGet(`/api/lectures/${encodeURIComponent(lectureId)}`);
assert(detail.response.ok, "Render lecture detail failed.", detail.body);
expectHeader(detail, "x-content-read-source", "d1", "Lecture detail");
assert(!containsCorrectAnswer(detail.body), "Lecture detail leaked correctAnswer.");
console.log(`Lecture detail: ${lectureId}, source=D1 — PASS`);

// Materials
for (const scope of ["subjects", "offline", "full"]) {
  const result = await renderGet(`/api/materials?scope=${scope}&forceRefresh=1`);
  assert(result.response.ok, `Render materials ${scope} failed.`, result.body);
  expectHeader(
    result,
    "x-content-materials-read-source",
    "d1",
    `Materials ${scope}`
  );
  assert(
    !containsCorrectAnswer(result.body),
    `Materials ${scope} leaked correctAnswer.`
  );
}
console.log("Materials subjects/offline/full, source=D1 — PASS");

// Motto
const motto = await renderGet("/api/mottos/active");
assert(motto.response.ok, "Render active motto failed.", motto.body);
expectHeader(motto, "x-content-motto-read-source", "d1", "Active motto");
assert(Array.isArray(motto.body?.mottos), "Active motto contract invalid.");
console.log(`Active mottos: ${motto.body.mottos.length}, source=D1 — PASS`);

// Calendar hybrid
const calendar = await renderGet("/api/calendar/events");
assert(calendar.response.ok, "Render calendar failed.", calendar.body);
expectHeader(
  calendar,
  "x-content-calendar-read-source",
  "d1+supabase-personal",
  "Calendar"
);
assert(Array.isArray(calendar.body), "Calendar response invalid.");
console.log(
  `Calendar: ${calendar.body.length} visible rows, source=D1+Supabase-personal — PASS`
);

// Search
const searchTerm =
  String(
    lectures.body[0]?.name ||
    lectures.body[0]?.mainSubject ||
    "test"
  )
    .split(/\s+/)
    .find((token) => token.length >= 4) || "test";

const search = await renderGet(`/api/search?q=${encodeURIComponent(searchTerm)}`);
assert(search.response.ok, "Render search failed.", search.body);
expectHeader(search, "x-content-search-read-source", "d1", "Search");
assert(Array.isArray(search.body), "Search response invalid.");
assert(!containsCorrectAnswer(search.body), "Search leaked correctAnswer.");
console.log(`Search query="${searchTerm}", source=D1 — PASS`);

// Cache policy: deterministic route caches, search bypasses.
const workerList1 = await workerGet("/internal/content-read/lectures");
const workerList2 = await workerGet("/internal/content-read/lectures");
assert(workerList1.response.ok && workerList2.response.ok, "Worker lecture cache check failed.");
assert(
  ["MISS", "HIT"].includes(workerList1.response.headers.get("x-content-cache")),
  "Unexpected first lecture cache state.",
  { state: workerList1.response.headers.get("x-content-cache") }
);
assert(
  workerList2.response.headers.get("x-content-cache") === "HIT",
  "Second lecture request was not a cache HIT.",
  { state: workerList2.response.headers.get("x-content-cache") }
);
assert(
  workerList2.response.headers.get("cache-control") === "no-store",
  "Worker cached response is not no-store toward Render."
);

const probe = `__stage7a_${Date.now()}__`;
const workerSearch = await workerGet(
  `/internal/content-read/search?q=${encodeURIComponent(probe)}`
);
assert(workerSearch.response.ok, "Worker search cache-policy check failed.", workerSearch.body);
assert(
  workerSearch.response.headers.get("x-content-cache") === "BYPASS",
  "Search no longer bypasses Cache API.",
  { state: workerSearch.response.headers.get("x-content-cache") }
);
console.log("Cache policy: deterministic HIT + search BYPASS — PASS");

console.log("");
console.log("D1 connectivity: HEALTHY");
console.log("R2 connectivity: HEALTHY");
console.log("Shared read cutover: ACTIVE");
console.log("Personal calendar isolation: PRESERVED");
console.log("correctAnswer exposure: NONE");
console.log("Cache safety policy: PRESERVED");
console.log("");
console.log("STAGE 7A FINAL PRODUCTION HEALTH PASS");
console.log("No database was modified.");
