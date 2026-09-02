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

function deepFindKey(value, wantedKey, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return undefined;
  seen.add(value);

  if (Object.prototype.hasOwnProperty.call(value, wantedKey)) {
    return value[wantedKey];
  }

  for (const child of Object.values(value)) {
    const found = deepFindKey(child, wantedKey, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

function parseTargetGroups(value) {
  if (Array.isArray(value)) {
    return value.map(String).map((v) => v.trim().toUpperCase()).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);
}

function eventVisibleToGroup(targetGroups, studentGroup) {
  const groups = parseTargetGroups(targetGroups);
  const group =
    typeof studentGroup === "string" ? studentGroup.trim().toUpperCase() : "";
  return groups.includes("ALL") || (!!group && groups.includes(group));
}

function normalizeEvent(row) {
  return {
    id: row?.id ?? null,
    userId: row?.userId ?? null,
    title: row?.title ?? null,
    eventType: row?.eventType ?? null,
    startDateTime: row?.startDateTime ?? null,
    endDateTime: row?.endDateTime ?? null,
    targetGroups: parseTargetGroups(row?.targetGroups),
    description: row?.description ?? null,
    subjectId: row?.subjectId ?? null,
    lectureId: row?.lectureId ?? null,
    room: row?.room ?? null,
    doctor: row?.doctor ?? null,
    notes: row?.notes ?? null,
    isPinned: row?.isPinned === true || row?.isPinned === 1,
    isCompleted: row?.isCompleted === true || row?.isCompleted === 1,
  };
}

function canonicalEvents(rows) {
  return rows
    .map(normalizeEvent)
    .sort((a, b) => {
      const byStart = String(a.startDateTime).localeCompare(String(b.startDateTime));
      if (byStart !== 0) return byStart;
      return String(a.id).localeCompare(String(b.id));
    });
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

async function renderGet(pathname) {
  return fetchJson(
    `${RENDER_BASE}${pathname}`,
    {
      Accept: "application/json",
      Authorization: `Bearer ${AUTH_TOKEN}`,
      "X-Requested-With": "XMLHttpRequest",
      "Cache-Control": "no-cache",
    },
    `Render ${pathname}`
  );
}

async function workerGet(pathname) {
  return fetchJson(
    `${WORKER_BASE}${pathname}`,
    {
      Accept: "application/json",
      "X-Content-Sync-Secret": CONTENT_SYNC_SECRET,
    },
    `D1 ${pathname}`
  );
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

console.log("99's Guide — Stage 5E-3A Global Calendar Shadow Parity");
console.log("------------------------------------------------------");
console.log("Mode: READ-ONLY");
console.log("Production /api/calendar/events remains unchanged.");
console.log("Personal calendar rows remain Supabase-only.");
console.log("");

const [me, renderEventsRaw, d1Payload] = await Promise.all([
  renderGet("/api/auth/me"),
  renderGet("/api/calendar/events"),
  workerGet("/internal/content-read/calendar/global"),
]);

assert(Array.isArray(renderEventsRaw), "Render calendar response is not an array.");
assert(d1Payload && Array.isArray(d1Payload.events), "D1 payload does not contain events array.");

const roleValue = deepFindKey(me, "role");
const groupValue = deepFindKey(me, "studentGroup");

const role = typeof roleValue === "string" ? roleValue.trim().toLowerCase() : "";
const studentGroup =
  typeof groupValue === "string" ? groupValue.trim().toUpperCase() : "";
const isPrivileged = role === "admin" || role === "owner";

const renderGlobal = renderEventsRaw.filter((event) => event?.userId == null);
const renderPersonal = renderEventsRaw.filter((event) => event?.userId != null);

for (const event of d1Payload.events) {
  assert(event?.userId == null, `D1 returned a personal calendar row: ${event?.id}`);
}

const d1Visible = d1Payload.events.filter(
  (event) => isPrivileged || eventVisibleToGroup(event.targetGroups, studentGroup)
);

const renderCanonical = canonicalEvents(renderGlobal);
const d1Canonical = canonicalEvents(d1Visible);

const diff = firstDifference(renderCanonical, d1Canonical);
if (diff) {
  fail("Visible global calendar semantic parity mismatch.", diff);
}

console.log(`Authenticated role: ${role || "(unknown)"}`);
console.log(`Authenticated studentGroup: ${studentGroup || "(empty / none)"}`);
console.log(`Visible global events: ${renderGlobal.length} — PASS`);
console.log(`Personal events returned by Render: ${renderPersonal.length} — PRESERVED ON SUPABASE`);
console.log("D1 personal-event exposure: NONE");
console.log("Ordering/fields/visibility: PASS");
console.log("");
console.log("STAGE 5E-3A GLOBAL CALENDAR SHADOW PARITY PASS");
console.log("No database was modified.");
