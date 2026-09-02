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

function sortById(rows) {
  return [...rows].sort((a, b) =>
    String(a?.id ?? "").localeCompare(String(b?.id ?? ""))
  );
}

function normalizeLectureListRow(row) {
  return sortObjectKeys({
    id: row?.id ?? null,
    name: row?.name ?? null,
    mainSubject: row?.mainSubject ?? null,
    subSubject: row?.subSubject ?? null,
    trackMode: row?.trackMode ?? null,
    department: row?.department ?? null,
    createdAt: row?.createdAt ?? null,
    materials: sortById(Array.isArray(row?.materials) ? row.materials : []),
    mcqs: sortById(Array.isArray(row?.mcqs) ? row.mcqs : []),
    flashcards: sortById(Array.isArray(row?.flashcards) ? row.flashcards : []),
  });
}

function normalizeLectureDetail(row) {
  return sortObjectKeys({
    id: row?.id ?? null,
    name: row?.name ?? null,
    mainSubject: row?.mainSubject ?? null,
    subSubject: row?.subSubject ?? null,
    trackMode: row?.trackMode ?? null,
    department: row?.department ?? null,
    createdAt: row?.createdAt ?? null,
    materials: sortById(Array.isArray(row?.materials) ? row.materials : []),
    mcqs: sortById(Array.isArray(row?.mcqs) ? row.mcqs : []),
    flashcards: sortById(Array.isArray(row?.flashcards) ? row.flashcards : []),
  });
}

function stable(value) {
  return JSON.stringify(sortObjectKeys(value));
}

function containsCorrectAnswer(value) {
  if (Array.isArray(value)) return value.some(containsCorrectAnswer);
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "correctAnswer")) return true;
    return Object.values(value).some(containsCorrectAnswer);
  }
  return false;
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
      if (!(key in a)) return { path: `${path}.${key}`, render: "<missing>", d1: b[key] };
      if (!(key in b)) return { path: `${path}.${key}`, render: a[key], d1: "<missing>" };
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

async function renderGet(path) {
  return fetchJson(
    `${RENDER_BASE}${path}`,
    {
      Accept: "application/json",
      Authorization: `Bearer ${AUTH_TOKEN}`,
      "X-Requested-With": "XMLHttpRequest",
      "Cache-Control": "no-cache",
    },
    `Render ${path}`
  );
}

async function d1Get(path) {
  return fetchJson(
    `${WORKER_BASE}${path}`,
    {
      Accept: "application/json",
      "X-Content-Sync-Secret": CONTENT_SYNC_SECRET,
    },
    `D1 ${path}`
  );
}

if (!AUTH_TOKEN) {
  console.error("AUTH_TOKEN is not set in this CMD session.");
  console.error("Copy your current web auth_token locally and set it in CMD.");
  console.error("Do NOT send the token to ChatGPT.");
  process.exit(2);
}

if (!CONTENT_SYNC_SECRET) {
  console.error("CONTENT_SYNC_SECRET is not set in this CMD session.");
  console.error("Use the same existing Worker/Render sync secret locally.");
  console.error("Do NOT send the secret to ChatGPT.");
  process.exit(2);
}

console.log("99's Guide — Stage 5B Lecture Read Parity");
console.log("-----------------------------------------");
console.log(`Render: ${RENDER_BASE}`);
console.log(`Worker: ${WORKER_BASE}`);
console.log("Mode: READ-ONLY");
console.log("");

const [renderListRaw, d1ListRaw] = await Promise.all([
  renderGet("/api/lectures"),
  d1Get("/internal/content-read/lectures"),
]);

assert(Array.isArray(renderListRaw), "Render lecture list is not an array.");
assert(Array.isArray(d1ListRaw), "D1 lecture list is not an array.");
assert(!containsCorrectAnswer(renderListRaw), "Render lecture list leaked correctAnswer.");
assert(!containsCorrectAnswer(d1ListRaw), "D1 lecture list leaked correctAnswer.");

const renderList = renderListRaw.map(normalizeLectureListRow);
const d1List = d1ListRaw.map(normalizeLectureListRow);

assert(
  renderList.length === d1List.length,
  "Lecture list count mismatch.",
  { render: renderList.length, d1: d1List.length }
);

const renderIds = renderList.map((row) => row.id);
const d1Ids = d1List.map((row) => row.id);

assert(
  stable(renderIds) === stable(d1Ids),
  "Lecture list order/id mismatch.",
  { render: renderIds, d1: d1Ids }
);

for (let i = 0; i < renderList.length; i++) {
  const diff = firstDifference(renderList[i], d1List[i], `lectures[${i}]`);
  if (diff) {
    fail(`Lecture list contract mismatch for id ${renderList[i]?.id}`, diff);
  }
}

console.log(`Global lecture list: ${renderList.length} rows — PASS`);

const filters = ["mainSubject", "subSubject", "trackMode", "department"];
for (const filter of filters) {
  const sample = renderListRaw.find(
    (row) => typeof row?.[filter] === "string" && row[filter].trim()
  );
  if (!sample) {
    console.log(`Filter ${filter}: no non-empty sample — SKIP`);
    continue;
  }

  const value = sample[filter];
  const qs = `${encodeURIComponent(filter)}=${encodeURIComponent(value)}`;

  const [renderFilteredRaw, d1FilteredRaw] = await Promise.all([
    renderGet(`/api/lectures?${qs}`),
    d1Get(`/internal/content-read/lectures?${qs}`),
  ]);

  const renderFiltered = renderFilteredRaw.map(normalizeLectureListRow);
  const d1Filtered = d1FilteredRaw.map(normalizeLectureListRow);

  const diff = firstDifference(renderFiltered, d1Filtered, `filter.${filter}`);
  if (diff) {
    fail(`Filtered parity mismatch: ${filter}=${value}`, diff);
  }

  console.log(`Filter ${filter}=${value}: ${renderFiltered.length} rows — PASS`);
}

// Representative detail selection:
// first row + rows carrying material/MCQ/flashcard children + last row.
// This keeps production load small while covering every detail collection shape.
const candidateIds = [
  renderListRaw[0]?.id,
  renderListRaw.find((row) => Array.isArray(row?.materials) && row.materials.length > 0)?.id,
  renderListRaw.find((row) => Array.isArray(row?.mcqs) && row.mcqs.length > 0)?.id,
  renderListRaw.find((row) => Array.isArray(row?.flashcards) && row.flashcards.length > 0)?.id,
  renderListRaw.at(-1)?.id,
].filter(Boolean);

const detailIds = [...new Set(candidateIds)].slice(0, 5);

assert(detailIds.length > 0, "No lecture ids available for detail parity.");

for (const id of detailIds) {
  const [renderDetailRaw, d1DetailRaw] = await Promise.all([
    renderGet(`/api/lectures/${encodeURIComponent(id)}`),
    d1Get(`/internal/content-read/lectures/${encodeURIComponent(id)}`),
  ]);

  assert(
    !containsCorrectAnswer(renderDetailRaw),
    `Render lecture detail ${id} leaked correctAnswer.`
  );
  assert(
    !containsCorrectAnswer(d1DetailRaw),
    `D1 lecture detail ${id} leaked correctAnswer.`
  );

  const renderDetail = normalizeLectureDetail(renderDetailRaw);
  const d1Detail = normalizeLectureDetail(d1DetailRaw);

  const diff = firstDifference(renderDetail, d1Detail, `lecture.${id}`);
  if (diff) {
    fail(`Lecture detail parity mismatch for ${id}`, diff);
  }

  console.log(`Detail ${id}: PASS`);
}

console.log("");
console.log("correctAnswer exposure: NONE");
console.log("STAGE 5B-1 LECTURE PARITY PASS");
console.log("No database was modified.");
