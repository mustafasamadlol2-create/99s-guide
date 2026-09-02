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

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortObjectKeys(value[key])])
    );
  }
  return value;
}

function canonicalize(payload) {
  const copy = JSON.parse(JSON.stringify(payload));
  if (Array.isArray(copy?.mottos)) {
    copy.mottos.sort((a, b) => {
      const byCreated = String(b.createdAt).localeCompare(String(a.createdAt));
      if (byCreated !== 0) return byCreated;
      return String(a.id).localeCompare(String(b.id));
    });
  }
  return sortObjectKeys(copy);
}

function firstDifference(a, b, path = "$") {
  if (Object.is(a, b)) return null;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { path, render: `array(${a.length})`, d1: `array(${b.length})` };
    }
    for (let i = 0; i < a.length; i++) {
      const diff = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }

  if (
    a &&
    b &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const key of keys) {
      if (!(key in a)) {
        return { path: `${path}.${key}`, render: "<missing>", d1: b[key] };
      }
      if (!(key in b)) {
        return { path: `${path}.${key}`, render: a[key], d1: "<missing>" };
      }
      const diff = firstDifference(a[key], b[key], `${path}.${key}`);
      if (diff) return diff;
    }
    return null;
  }

  return { path, render: a, d1: b };
}

async function fetchJson(url, headers, label) {
  const response = await fetch(url, {
    method: "GET",
    headers,
    cache: "no-store",
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    fail(`${label} returned non-JSON HTTP ${response.status}`, text.slice(0, 300));
  }

  if (!response.ok) {
    fail(`${label} returned HTTP ${response.status}`, body);
  }

  return body;
}

if (!AUTH_TOKEN) {
  console.error("AUTH_TOKEN is not set in this CMD session.");
  console.error("Use your current logged-in JWT access token locally.");
  console.error("Do NOT send the token to ChatGPT.");
  process.exit(2);
}

if (!CONTENT_SYNC_SECRET) {
  console.error("CONTENT_SYNC_SECRET is not set in this CMD session.");
  console.error("Use your existing Content Worker secret locally.");
  console.error("Do NOT send the secret to ChatGPT.");
  process.exit(2);
}

console.log("99's Guide — Stage 5E-1 Active Motto Shadow Parity");
console.log("--------------------------------------------------");
console.log("Mode: READ-ONLY");
console.log("Production /api/mottos/active remains unchanged.");
console.log("");

const [renderPayload, d1Payload] = await Promise.all([
  fetchJson(
    `${RENDER_BASE}/api/mottos/active`,
    {
      Accept: "application/json",
      Authorization: `Bearer ${AUTH_TOKEN}`,
      "X-Requested-With": "XMLHttpRequest",
      "Cache-Control": "no-cache",
    },
    "Render /api/mottos/active"
  ),
  fetchJson(
    `${WORKER_BASE}/internal/content-read/mottos/active`,
    {
      Accept: "application/json",
      "X-Content-Sync-Secret": CONTENT_SYNC_SECRET,
    },
    "D1 /internal/content-read/mottos/active"
  ),
]);

assert(
  renderPayload && Array.isArray(renderPayload.mottos),
  "Render payload does not contain mottos array."
);

assert(
  d1Payload && Array.isArray(d1Payload.mottos),
  "D1 payload does not contain mottos array."
);

const renderCanonical = canonicalize(renderPayload);
const d1Canonical = canonicalize(d1Payload);

const diff = firstDifference(renderCanonical, d1Canonical);
if (diff) {
  fail("Active motto semantic parity mismatch.", diff);
}

for (const motto of d1Payload.mottos) {
  assert(
    motto.isActive === true,
    `D1 returned an inactive motto: ${motto.id}`
  );
}

console.log(`Active mottos: ${renderPayload.mottos.length} — PASS`);
console.log("Ordering/fields/values: PASS");
console.log("");
console.log("STAGE 5E-1 ACTIVE MOTTO SHADOW PARITY PASS");
console.log("No database was modified.");
