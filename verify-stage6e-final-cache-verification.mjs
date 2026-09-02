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

async function workerGet(pathname, authorized = true) {
  return fetchJson(
    WORKER_BASE,
    pathname,
    authorized
      ? { "X-Content-Sync-Secret": CONTENT_SYNC_SECRET }
      : {}
  );
}

async function renderGet(pathname) {
  return fetchJson(RENDER_BASE, pathname, {
    Authorization: `Bearer ${AUTH_TOKEN}`,
    "X-Requested-With": "XMLHttpRequest",
    "Cache-Control": "no-cache",
  });
}

function cacheHeaders(result) {
  return {
    state: result.response.headers.get("x-content-cache"),
    ttl: result.response.headers.get("x-content-cache-ttl"),
    cacheControl: result.response.headers.get("cache-control"),
  };
}

async function ensureCached(pathname, expectedTtl, label, validateBody) {
  const first = await workerGet(pathname);
  assert(first.response.ok, `${label} first request failed.`, first.body);
  if (validateBody) validateBody(first.body);

  const firstHeaders = cacheHeaders(first);
  assert(
    firstHeaders.state === "MISS" || firstHeaders.state === "HIT",
    `${label} first request returned unexpected cache state.`,
    firstHeaders
  );
  assert(
    firstHeaders.ttl === String(expectedTtl),
    `${label} first request returned wrong TTL.`,
    { expected: String(expectedTtl), actual: firstHeaders.ttl }
  );
  assert(
    firstHeaders.cacheControl === "no-store",
    `${label} must remain no-store toward Render.`,
    firstHeaders
  );

  const second = await workerGet(pathname);
  assert(second.response.ok, `${label} second request failed.`, second.body);
  if (validateBody) validateBody(second.body);

  const secondHeaders = cacheHeaders(second);
  assert(
    secondHeaders.state === "HIT",
    `${label} second request must be HIT.`,
    { first: firstHeaders, second: secondHeaders }
  );
  assert(
    secondHeaders.ttl === String(expectedTtl),
    `${label} second request returned wrong TTL.`,
    { expected: String(expectedTtl), actual: secondHeaders.ttl }
  );
  assert(
    secondHeaders.cacheControl === "no-store",
    `${label} cached response must remain no-store toward Render.`,
    secondHeaders
  );

  console.log(`${label}: ${firstHeaders.state} -> HIT, TTL=${expectedTtl}s — PASS`);
  return second.body;
}

function expectRenderSource(result, header, expected, label) {
  assert(result.response.ok, `${label} failed.`, result.body);
  const actual = result.response.headers.get(header);
  assert(
    actual === expected,
    `${label} used unexpected production source.`,
    { header, expected, actual }
  );
}

if (!AUTH_TOKEN) {
  console.error("AUTH_TOKEN is not set in this CMD session.");
  console.error("Use your current logged-in JWT access token locally.");
  console.error("Do NOT send it to ChatGPT.");
  process.exit(2);
}

if (!CONTENT_SYNC_SECRET) {
  console.error("CONTENT_SYNC_SECRET is not set in this CMD session.");
  console.error("Use your existing Worker/Render content sync secret locally.");
  console.error("Do NOT send it to ChatGPT.");
  process.exit(2);
}

console.log("99's Guide — Stage 6E Final Cache Verification");
console.log("----------------------------------------------");
console.log("Mode: READ-ONLY");
console.log("");

// 1) Health and feature flag.
const health = await workerGet("/health", false);
assert(health.response.ok, "Worker /health failed.", health.body);
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
console.log("Shared content cache enabled — PASS");

// 2) Auth gate happens before any cache access.
const unauthorized = await workerGet(
  "/internal/content-read/mottos/active",
  false
);
assert(
  unauthorized.response.status === 401,
  "Unauthorized internal content read was not blocked.",
  { status: unauthorized.response.status, body: unauthorized.body }
);
assert(
  unauthorized.response.headers.get("x-content-cache") === null,
  "Unauthorized response unexpectedly exposed cache state."
);
console.log("Authentication-before-cache — PASS");

// 3) Deterministic Worker cache routes.
const lectures = await ensureCached(
  "/internal/content-read/lectures",
  30,
  "Worker lectures list",
  (body) => assert(Array.isArray(body) && body.length > 0, "Lecture list invalid.")
);

const lectureId = lectures[0]?.id;
assert(lectureId, "No lecture id available.");

await ensureCached(
  `/internal/content-read/lectures/${encodeURIComponent(lectureId)}`,
  60,
  "Worker lecture detail",
  (body) => {
    assert(body && typeof body === "object", "Lecture detail invalid.");
    assert(body.id === lectureId, "Lecture detail returned wrong id.");
    assert(!containsCorrectAnswer(body), "Lecture detail leaked correctAnswer.");
  }
);

for (const scope of ["subjects", "offline", "full"]) {
  await ensureCached(
    `/internal/content-read/materials-data?scope=${scope}`,
    30,
    `Worker materials ${scope}`,
    (body) => {
      assert(body && typeof body === "object", `Materials ${scope} invalid.`);
      assert(body.scope === scope, `Materials scope mismatch for ${scope}.`);
      assert(!containsCorrectAnswer(body), `Materials ${scope} leaked correctAnswer.`);
    }
  );
}

await ensureCached(
  "/internal/content-read/mottos/active",
  60,
  "Worker active mottos",
  (body) => assert(Array.isArray(body?.mottos), "Motto payload invalid.")
);

await ensureCached(
  "/internal/content-read/calendar/global",
  30,
  "Worker global calendar",
  (body) => {
    assert(Array.isArray(body?.events), "Global calendar payload invalid.");
    for (const event of body.events) {
      assert(event?.userId == null, `Personal event exposed in global cache: ${event?.id}`);
    }
  }
);

// 4) Unbounded key spaces deliberately bypass Cache API.
const searchProbe = `__stage6e_search_${Date.now()}__`;
for (let i = 0; i < 2; i++) {
  const result = await workerGet(
    `/internal/content-read/search?q=${encodeURIComponent(searchProbe)}`
  );
  assert(result.response.ok, "Worker search bypass probe failed.", result.body);
  assert(
    result.response.headers.get("x-content-cache") === "BYPASS",
    "Search must bypass shared cache.",
    cacheHeaders(result)
  );
}
console.log("Worker search cache policy: BYPASS — PASS");

const filterProbe = `__stage6e_filter_${Date.now()}__`;
for (let i = 0; i < 2; i++) {
  const result = await workerGet(
    `/internal/content-read/lectures?mainSubject=${encodeURIComponent(filterProbe)}`
  );
  assert(result.response.ok, "Filtered lecture bypass probe failed.", result.body);
  assert(
    result.response.headers.get("x-content-cache") === "BYPASS",
    "Filtered lectures must bypass shared cache.",
    cacheHeaders(result)
  );
}
console.log("Worker filtered lecture cache policy: BYPASS — PASS");

// 5) Production Render cutover must still be intact after cache changes.
const renderLectures = await renderGet("/api/lectures");
expectRenderSource(
  renderLectures,
  "x-content-read-source",
  "d1",
  "Render /api/lectures"
);
assert(Array.isArray(renderLectures.body), "Render lecture list invalid.");
assert(!containsCorrectAnswer(renderLectures.body), "Render lecture list leaked correctAnswer.");
console.log("Render lectures source=D1 — PASS");

const renderDetail = await renderGet(
  `/api/lectures/${encodeURIComponent(lectureId)}`
);
expectRenderSource(
  renderDetail,
  "x-content-read-source",
  "d1",
  "Render /api/lectures/:id"
);
assert(!containsCorrectAnswer(renderDetail.body), "Render lecture detail leaked correctAnswer.");
console.log("Render lecture detail source=D1 — PASS");

for (const scope of ["subjects", "offline", "full"]) {
  const result = await renderGet(
    `/api/materials?scope=${scope}&forceRefresh=1`
  );
  expectRenderSource(
    result,
    "x-content-materials-read-source",
    "d1",
    `Render /api/materials?scope=${scope}`
  );
  assert(!containsCorrectAnswer(result.body), `Render materials ${scope} leaked correctAnswer.`);
}
console.log("Render materials scopes source=D1 — PASS");

const renderMotto = await renderGet("/api/mottos/active");
expectRenderSource(
  renderMotto,
  "x-content-motto-read-source",
  "d1",
  "Render /api/mottos/active"
);
console.log("Render active motto source=D1 — PASS");

const renderCalendar = await renderGet("/api/calendar/events");
expectRenderSource(
  renderCalendar,
  "x-content-calendar-read-source",
  "d1+supabase-personal",
  "Render /api/calendar/events"
);
assert(Array.isArray(renderCalendar.body), "Render calendar payload invalid.");
console.log("Render calendar source=D1+Supabase-personal — PASS");

// Search still uses D1, but Worker-side Cache API deliberately bypasses it.
const searchTerm =
  String(lectures[0]?.name || lectures[0]?.mainSubject || "test")
    .split(/\s+/)
    .find((x) => x.length >= 4) || "test";

const renderSearch = await renderGet(
  `/api/search?q=${encodeURIComponent(searchTerm)}`
);
expectRenderSource(
  renderSearch,
  "x-content-search-read-source",
  "d1",
  "Render /api/search"
);
assert(Array.isArray(renderSearch.body), "Render search payload invalid.");
assert(!containsCorrectAnswer(renderSearch.body), "Render search leaked correctAnswer.");
console.log("Render search source=D1, Worker cache=BYPASS — PASS");

console.log("");
console.log("Deterministic shared cache: ACTIVE");
console.log("Write invalidation model: LOCAL POP PURGE + <=60s REMOTE TTL BOUND");
console.log("Search cache: BYPASS");
console.log("Filtered lecture cache: BYPASS");
console.log("Personal calendar data cached: NO");
console.log("correctAnswer exposure: NONE");
console.log("Production read cutover: PRESERVED");
console.log("");
console.log("STAGE 6E FINAL CACHE VERIFICATION PASS");
console.log("No database was modified.");
