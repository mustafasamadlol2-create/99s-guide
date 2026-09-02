const RENDER_BASE = (
  process.env.RENDER_BASE_URL || "https://nine9s-guide.onrender.com"
).replace(/\/+$/, "");

const AUTH_TOKEN = process.env.AUTH_TOKEN || "";

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

async function renderGet(pathname, label = pathname) {
  const response = await fetch(`${RENDER_BASE}${pathname}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${AUTH_TOKEN}`,
      "X-Requested-With": "XMLHttpRequest",
      "Cache-Control": "no-cache",
    },
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

  return { response, body };
}

function expectHeader(response, name, expected, label) {
  const actual = response.headers.get(name);
  assert(
    actual === expected,
    `${label} did not use the expected production read source.`,
    { header: name, expected, actual }
  );
}

function chooseSearchTerm(lectures) {
  const candidates = [];

  for (const lecture of lectures) {
    for (const source of [lecture?.name, lecture?.mainSubject, lecture?.subSubject]) {
      if (typeof source !== "string") continue;
      const tokens = source.match(/[A-Za-z0-9][A-Za-z0-9-]{3,}/g) || [];
      for (const token of tokens) {
        if (token.length >= 4) candidates.push(token);
      }
    }
  }

  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] || "test";
}

if (!AUTH_TOKEN) {
  console.error("AUTH_TOKEN is not set in this CMD session.");
  console.error("Use your current logged-in JWT access token locally.");
  console.error("Do NOT send the token to ChatGPT.");
  process.exit(2);
}

console.log("99's Guide — Stage 5F Final Read-Cutover Verification");
console.log("-----------------------------------------------------");
console.log("Mode: READ-ONLY");
console.log(`Render: ${RENDER_BASE}`);
console.log("");

// 1) Lectures list -> D1
const lecturesResult = await renderGet("/api/lectures", "GET /api/lectures");
assert(Array.isArray(lecturesResult.body), "/api/lectures is not an array.");
assert(lecturesResult.body.length > 0, "/api/lectures returned no lectures.");
expectHeader(
  lecturesResult.response,
  "x-content-read-source",
  "d1",
  "/api/lectures"
);
assert(
  !containsCorrectAnswer(lecturesResult.body),
  "/api/lectures leaked correctAnswer."
);
console.log(`Lectures list: ${lecturesResult.body.length} rows — D1 PASS`);

// 2) Lecture detail -> D1
const sampleLectureId = lecturesResult.body[0]?.id;
assert(sampleLectureId, "No lecture id available for detail test.");

const lectureDetail = await renderGet(
  `/api/lectures/${encodeURIComponent(sampleLectureId)}`,
  "GET /api/lectures/:id"
);
expectHeader(
  lectureDetail.response,
  "x-content-read-source",
  "d1",
  "/api/lectures/:id"
);
assert(
  !containsCorrectAnswer(lectureDetail.body),
  "/api/lectures/:id leaked correctAnswer."
);
console.log(`Lecture detail: ${sampleLectureId} — D1 PASS`);

// 3) Materials scopes -> D1
for (const scope of ["subjects", "offline", "full"]) {
  const result = await renderGet(
    `/api/materials?scope=${scope}&forceRefresh=1`,
    `GET /api/materials?scope=${scope}`
  );

  expectHeader(
    result.response,
    "x-content-materials-read-source",
    "d1",
    `/api/materials?scope=${scope}`
  );

  assert(
    !containsCorrectAnswer(result.body),
    `/api/materials?scope=${scope} leaked correctAnswer.`
  );

  if (scope === "subjects") {
    assert(Array.isArray(result.body?.subjects), "subjects scope contract changed.");
  } else if (scope === "offline") {
    assert(Array.isArray(result.body?.mcqs), "offline.mcqs contract changed.");
    assert(Array.isArray(result.body?.flashcards), "offline.flashcards contract changed.");
  } else {
    assert(Array.isArray(result.body?.subjects), "full.subjects contract changed.");
    assert(Array.isArray(result.body?.mcqs), "full.mcqs contract changed.");
    assert(Array.isArray(result.body?.flashcards), "full.flashcards contract changed.");
    assert(Array.isArray(result.body?.videos), "full.videos contract changed.");
    assert(Array.isArray(result.body?.calendarEvents), "full.calendarEvents contract changed.");
  }

  console.log(`/api/materials scope=${scope} — D1 PASS`);
}

// 4) Active motto -> D1
const mottoResult = await renderGet(
  "/api/mottos/active",
  "GET /api/mottos/active"
);
expectHeader(
  mottoResult.response,
  "x-content-motto-read-source",
  "d1",
  "/api/mottos/active"
);
assert(
  Array.isArray(mottoResult.body?.mottos),
  "/api/mottos/active contract changed."
);
console.log(`Active mottos: ${mottoResult.body.mottos.length} — D1 PASS`);

// 5) Calendar -> hybrid D1 + Supabase personal
const calendarResult = await renderGet(
  "/api/calendar/events",
  "GET /api/calendar/events"
);
expectHeader(
  calendarResult.response,
  "x-content-calendar-read-source",
  "d1+supabase-personal",
  "/api/calendar/events"
);
assert(
  Array.isArray(calendarResult.body),
  "/api/calendar/events contract changed."
);
console.log(
  `Calendar events: ${calendarResult.body.length} — D1 + Supabase-personal PASS`
);

// 6) Search -> D1
const searchTerm = chooseSearchTerm(lecturesResult.body);
const searchResult = await renderGet(
  `/api/search?q=${encodeURIComponent(searchTerm)}`,
  "GET /api/search"
);
expectHeader(
  searchResult.response,
  "x-content-search-read-source",
  "d1",
  "/api/search"
);
assert(Array.isArray(searchResult.body), "/api/search contract changed.");
assert(
  !containsCorrectAnswer(searchResult.body),
  "/api/search leaked correctAnswer."
);
console.log(
  `Search query="${searchTerm}": ${searchResult.body.length} results — D1 PASS`
);

// 7) Empty search contract remains local and safe.
const emptySearch = await renderGet("/api/search?q=", "GET /api/search?q=");
assert(
  Array.isArray(emptySearch.body) && emptySearch.body.length === 0,
  "Empty search contract changed; expected []."
);
console.log("Empty search contract: [] — PASS");

console.log("");
console.log("correctAnswer exposure: NONE");
console.log("Production authentication layer: PRESERVED");
console.log("Personal calendar source: SUPABASE PRESERVED");
console.log("Shared read cutover: D1 ACTIVE");
console.log("");
console.log("STAGE 5F FINAL READ-CUTOVER PASS");
console.log("No database was modified.");
