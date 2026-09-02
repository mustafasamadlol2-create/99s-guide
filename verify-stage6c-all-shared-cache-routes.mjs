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

async function fetchJson(pathname, headers = {}) {
  const response = await fetch(`${WORKER_BASE}${pathname}`, {
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

function readCacheHeaders(response) {
  return {
    state: response.headers.get("x-content-cache"),
    ttl: response.headers.get("x-content-cache-ttl"),
    cacheControl: response.headers.get("cache-control"),
  };
}

function assertSafeInternalHeaders(result, expectedTtl, label) {
  const headers = readCacheHeaders(result.response);

  assert(
    headers.state === "MISS" || headers.state === "HIT",
    `${label} returned an unexpected cache state.`,
    headers
  );

  assert(
    headers.ttl === String(expectedTtl),
    `${label} returned the wrong TTL.`,
    { expected: String(expectedTtl), actual: headers.ttl }
  );

  assert(
    headers.cacheControl === "no-store",
    `${label} must remain Cache-Control: no-store toward Render.`,
    { actual: headers.cacheControl }
  );

  return headers.state;
}

async function verifyRoute(pathname, expectedTtl, label, validateBody) {
  const authHeaders = {
    "X-Content-Sync-Secret": CONTENT_SYNC_SECRET,
  };

  const first = await fetchJson(pathname, authHeaders);
  assert(first.response.ok, `${label} first request failed.`, first.body);
  if (validateBody) validateBody(first.body);

  const firstState = assertSafeInternalHeaders(first, expectedTtl, `${label} first request`);

  const second = await fetchJson(pathname, authHeaders);
  assert(second.response.ok, `${label} second request failed.`, second.body);
  if (validateBody) validateBody(second.body);

  const secondState = assertSafeInternalHeaders(second, expectedTtl, `${label} second request`);

  assert(
    secondState === "HIT",
    `${label} second request must be a cache HIT.`,
    { firstState, secondState }
  );

  console.log(`${label}: ${firstState} -> HIT, TTL=${expectedTtl}s — PASS`);
  return second.body;
}

if (!CONTENT_SYNC_SECRET) {
  console.error("CONTENT_SYNC_SECRET is not set in this CMD session.");
  console.error("Use your existing Worker/Render secret locally.");
  console.error("Do NOT send it to ChatGPT.");
  process.exit(2);
}

console.log("99's Guide — Stage 6C All Shared Cache Routes Verification");
console.log("----------------------------------------------------------");
console.log("Mode: READ-ONLY");
console.log("");

// Health
const health = await fetchJson("/health");
assert(health.response.ok, "/health failed.", health.body);
assert(
  health.body?.sharedContentCache?.enabled === true,
  "Shared content cache is not enabled.",
  health.body?.sharedContentCache
);
console.log("Shared cache enabled — PASS");

// Lecture list
const lectures = await verifyRoute(
  "/internal/content-read/lectures",
  30,
  "Lectures list",
  (body) => assert(Array.isArray(body), "Lectures list payload is not an array.")
);

assert(lectures.length > 0, "No lecture available for detail cache test.");
const lectureId = lectures[0]?.id;
assert(lectureId, "First lecture does not contain an id.");

// Lecture detail
await verifyRoute(
  `/internal/content-read/lectures/${encodeURIComponent(lectureId)}`,
  60,
  "Lecture detail",
  (body) => {
    assert(body && typeof body === "object", "Lecture detail payload is invalid.");
    assert(body.id === lectureId, "Lecture detail returned the wrong lecture.");
  }
);

// Materials scopes
for (const scope of ["subjects", "offline", "full"]) {
  await verifyRoute(
    `/internal/content-read/materials-data?scope=${scope}`,
    30,
    `Materials scope=${scope}`,
    (body) => {
      assert(body && typeof body === "object", `Materials ${scope} payload is invalid.`);
      assert(body.scope === scope, `Materials scope mismatch for ${scope}.`);
    }
  );
}

// Motto
await verifyRoute(
  "/internal/content-read/mottos/active",
  60,
  "Active mottos",
  (body) => assert(Array.isArray(body?.mottos), "Motto payload does not contain mottos array.")
);

// Global calendar
await verifyRoute(
  "/internal/content-read/calendar/global",
  30,
  "Global calendar",
  (body) => {
    assert(Array.isArray(body?.events), "Calendar payload does not contain events array.");
    for (const event of body.events) {
      assert(event?.userId == null, `D1 cache exposed personal calendar event ${event?.id}.`);
    }
  }
);

// Search: unique key guarantees a cold MISS, then HIT.
const searchProbe = `__stage6c_search_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 9)}__`;

const searchPath = `/internal/content-read/search?q=${encodeURIComponent(searchProbe)}`;
const authHeaders = { "X-Content-Sync-Secret": CONTENT_SYNC_SECRET };

const searchFirst = await fetchJson(searchPath, authHeaders);
assert(searchFirst.response.ok, "Search first request failed.", searchFirst.body);
assert(Array.isArray(searchFirst.body), "Search payload is not an array.");
assert(searchFirst.body.length === 0, "Unique search probe unexpectedly matched data.");

const searchFirstHeaders = readCacheHeaders(searchFirst.response);
assert(
  searchFirstHeaders.state === "MISS",
  "Unique search probe first request must be MISS.",
  searchFirstHeaders
);
assert(searchFirstHeaders.ttl === "30", "Search TTL must be 30 seconds.", searchFirstHeaders);
assert(
  searchFirstHeaders.cacheControl === "no-store",
  "Search response must remain no-store toward Render.",
  searchFirstHeaders
);

const searchSecond = await fetchJson(searchPath, authHeaders);
assert(searchSecond.response.ok, "Search second request failed.", searchSecond.body);

const searchSecondHeaders = readCacheHeaders(searchSecond.response);
assert(
  searchSecondHeaders.state === "HIT",
  "Unique search probe second request must be HIT.",
  searchSecondHeaders
);
assert(searchSecondHeaders.ttl === "30", "Search HIT TTL marker must be 30 seconds.", searchSecondHeaders);
assert(
  searchSecondHeaders.cacheControl === "no-store",
  "Cached search response must remain no-store toward Render.",
  searchSecondHeaders
);

console.log("Search: MISS -> HIT, TTL=30s — PASS");

// Unauthorized safety on a route likely to be warm now.
const unauthorized = await fetchJson("/internal/content-read/mottos/active");
assert(
  unauthorized.response.status === 401,
  "Unauthorized caller was not blocked before cache access.",
  { status: unauthorized.response.status, body: unauthorized.body }
);
assert(
  unauthorized.response.headers.get("x-content-cache") === null,
  "Unauthorized response unexpectedly exposed a cache state."
);
console.log("Authentication-before-cache on warm route — PASS");

console.log("");
console.log("Lectures cache: VERIFIED");
console.log("Lecture detail cache: VERIFIED");
console.log("Materials cache: VERIFIED");
console.log("Motto cache: VERIFIED");
console.log("Global calendar cache: VERIFIED");
console.log("Search cache: VERIFIED");
console.log("Personal data cached: NO");
console.log("Render-facing Cache-Control: no-store");
console.log("");
console.log("STAGE 6C ALL SHARED CACHE ROUTES PASS");
console.log("No database was modified.");
