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

async function requestJson(pathname, init = {}) {
  const response = await fetch(`${WORKER_BASE}${pathname}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.headers || {}),
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

const authHeaders = {
  "X-Content-Sync-Secret": CONTENT_SYNC_SECRET,
};

async function get(pathname) {
  return requestJson(pathname, { method: "GET", headers: authHeaders });
}

async function sync(payload) {
  return requestJson("/internal/content-sync", {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

function cacheState(result) {
  return result.response.headers.get("x-content-cache");
}

function coreLecture(row) {
  return {
    id: row.id,
    name: row.name,
    mainSubject: row.mainSubject,
    subSubject: row.subSubject ?? null,
    trackMode: row.trackMode,
    department: row.department ?? null,
    createdAt: row.createdAt,
  };
}

function stable(value) {
  return JSON.stringify(value);
}

if (!CONTENT_SYNC_SECRET) {
  console.error("CONTENT_SYNC_SECRET is not set in this CMD session.");
  console.error("Use your existing Worker/Render secret locally.");
  console.error("Do NOT send it to ChatGPT.");
  process.exit(2);
}

console.log("99's Guide — Stage 6D Safe Cache Invalidation Verification");
console.log("----------------------------------------------------------");
console.log("Cache model: local POP purge + short TTL safety bound");
console.log("Mode: one idempotent/no-op D1 lecture upsert; Supabase untouched");
console.log("");

// Health / cache enabled.
const health = await requestJson("/health");
assert(health.response.ok, "/health failed.", health.body);
assert(
  health.body?.sharedContentCache?.enabled === true,
  "Shared cache is not enabled.",
  health.body?.sharedContentCache
);
console.log("Shared cache enabled — PASS");

// Search must now bypass because arbitrary query keys cannot be exhaustively invalidated.
const uniqueSearch = `__stage6d_${Date.now()}__`;
const search1 = await get(`/internal/content-read/search?q=${encodeURIComponent(uniqueSearch)}`);
const search2 = await get(`/internal/content-read/search?q=${encodeURIComponent(uniqueSearch)}`);

assert(cacheState(search1) === "BYPASS", "Search first request must BYPASS.", {
  actual: cacheState(search1),
});
assert(cacheState(search2) === "BYPASS", "Search second request must BYPASS.", {
  actual: cacheState(search2),
});
console.log("Search cache policy: BYPASS — PASS");

// Filtered lecture list must also bypass.
const filteredProbe = `__stage6d_filter_${Date.now()}__`;
const filtered1 = await get(
  `/internal/content-read/lectures?mainSubject=${encodeURIComponent(filteredProbe)}`
);
const filtered2 = await get(
  `/internal/content-read/lectures?mainSubject=${encodeURIComponent(filteredProbe)}`
);

assert(cacheState(filtered1) === "BYPASS", "Filtered lecture first request must BYPASS.", {
  actual: cacheState(filtered1),
});
assert(cacheState(filtered2) === "BYPASS", "Filtered lecture second request must BYPASS.", {
  actual: cacheState(filtered2),
});
console.log("Filtered lecture cache policy: BYPASS — PASS");

// Warm deterministic cache entries.
await get("/internal/content-read/lectures");
const warmList = await get("/internal/content-read/lectures");
assert(cacheState(warmList) === "HIT", "Lecture list did not warm to HIT.", {
  actual: cacheState(warmList),
});

assert(Array.isArray(warmList.body) && warmList.body.length > 0, "No lecture available.");
const sample = warmList.body[0];
const beforeCore = coreLecture(sample);

await get(`/internal/content-read/lectures/${encodeURIComponent(sample.id)}`);
const warmDetail = await get(
  `/internal/content-read/lectures/${encodeURIComponent(sample.id)}`
);
assert(cacheState(warmDetail) === "HIT", "Lecture detail did not warm to HIT.", {
  actual: cacheState(warmDetail),
});

for (const scope of ["subjects", "offline", "full"]) {
  await get(`/internal/content-read/materials-data?scope=${scope}`);
  const warm = await get(`/internal/content-read/materials-data?scope=${scope}`);
  assert(cacheState(warm) === "HIT", `Materials ${scope} did not warm to HIT.`, {
    actual: cacheState(warm),
  });
}

console.log("Deterministic lecture/material cache entries warmed — PASS");

// Perform an idempotent upsert of the exact same lecture values.
// This does not change the content and never touches Supabase.
const mutation = {
  version: 1,
  entity: "Lecture",
  operation: "upsert",
  id: sample.id,
  data: beforeCore,
  occurredAt: new Date().toISOString(),
};

const syncResult = await sync(mutation);
assert(syncResult.response.ok, "No-op lecture sync failed.", syncResult.body);
assert(syncResult.body?.ok === true, "No-op lecture sync did not report ok.", syncResult.body);

const invalidation = syncResult.body?.cacheInvalidation;
assert(invalidation?.enabled === true, "Cache invalidation was not enabled.", invalidation);
assert(invalidation?.mode === "local-pop", "Unexpected invalidation mode.", invalidation);
assert(
  Number(invalidation?.attempted) >= 5,
  "Lecture invalidation attempted too few deterministic keys.",
  invalidation
);
assert(
  invalidation?.maxRemotePopStalenessSeconds === 60,
  "Unexpected remote POP staleness safety bound.",
  invalidation
);

console.log(
  `No-op sync local invalidation: attempted=${invalidation.attempted}, deleted=${invalidation.deleted} — PASS`
);

// The same POP should now miss deterministic entries.
const listAfter = await get("/internal/content-read/lectures");
assert(cacheState(listAfter) === "MISS", "Lecture list was not locally invalidated.", {
  actual: cacheState(listAfter),
});

const detailAfter = await get(
  `/internal/content-read/lectures/${encodeURIComponent(sample.id)}`
);
assert(cacheState(detailAfter) === "MISS", "Lecture detail was not locally invalidated.", {
  actual: cacheState(detailAfter),
});

for (const scope of ["subjects", "offline", "full"]) {
  const after = await get(`/internal/content-read/materials-data?scope=${scope}`);
  assert(cacheState(after) === "MISS", `Materials ${scope} was not locally invalidated.`, {
    actual: cacheState(after),
  });
}

console.log("Lecture list/detail/material scopes invalidated to MISS — PASS");

// Ensure the no-op upsert preserved exact lecture values.
const detailVerify = await get(
  `/internal/content-read/lectures/${encodeURIComponent(sample.id)}`
);
assert(
  stable(coreLecture(detailVerify.body)) === stable(beforeCore),
  "No-op sync unexpectedly changed lecture values.",
  {
    before: beforeCore,
    after: coreLecture(detailVerify.body),
  }
);

console.log("Lecture content values unchanged — PASS");

// Authentication still happens before cache access.
const unauthorized = await requestJson("/internal/content-read/lectures");
assert(unauthorized.response.status === 401, "Unauthorized caller was not blocked.", {
  status: unauthorized.response.status,
});
assert(
  unauthorized.response.headers.get("x-content-cache") === null,
  "Unauthorized response exposed cache state."
);
console.log("Authentication-before-cache: PRESERVED");

console.log("");
console.log("Local POP write invalidation: VERIFIED");
console.log("Remote POP stale-data bound: <= 60 seconds");
console.log("Search cache: BYPASS");
console.log("Filtered lecture cache: BYPASS");
console.log("Supabase modified: NO");
console.log("D1 content values changed: NO");
console.log("");
console.log("STAGE 6D SAFE CACHE INVALIDATION PASS");
