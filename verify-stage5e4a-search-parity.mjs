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

function containsCorrectAnswer(value) {
  if (Array.isArray(value)) return value.some(containsCorrectAnswer);
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "correctAnswer")) return true;
    return Object.values(value).some(containsCorrectAnswer);
  }
  return false;
}

function normalizeResult(row) {
  const normalized = {
    id: row?.id,
    title: row?.title,
    subtitle: row?.subtitle,
    type: row?.type,
  };

  if (Object.prototype.hasOwnProperty.call(row || {}, "lectureId")) {
    normalized.lectureId = row.lectureId;
  }

  if (Object.prototype.hasOwnProperty.call(row || {}, "subjectId")) {
    normalized.subjectId = row.subjectId;
  }

  if (Object.prototype.hasOwnProperty.call(row || {}, "raw")) {
    normalized.raw = row.raw;
  }

  return normalized;
}

function canonicalize(rows) {
  return rows
    .map(normalizeResult)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
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

function tokenize(text) {
  return String(text || "")
    .match(/[A-Za-z0-9][A-Za-z0-9-]{4,}/g) || [];
}

function countTokenMatches(token, raw) {
  const needle = token.toLowerCase();

  const lectures = (raw.lectures || []).filter((row) =>
    `${row.name || ""} ${row.mainSubject || ""}`.toLowerCase().includes(needle)
  ).length;

  const materials = (raw.materials || []).filter((row) =>
    String(row.title || "").toLowerCase().includes(needle)
  ).length;

  const mcqs = (raw.mcqs || []).filter((row) =>
    String(row.question || "").toLowerCase().includes(needle)
  ).length;

  const flashcards = (raw.flashcards || []).filter((row) =>
    `${row.clinicalConcept || ""} ${row.explanation || ""}`.toLowerCase().includes(needle)
  ).length;

  return { lectures, materials, mcqs, flashcards };
}

function chooseCandidate(texts, raw, label) {
  const candidates = [
    ...new Set(
      texts
        .flatMap(tokenize)
        .filter((token) => token.length >= 6)
        .sort((a, b) => b.length - a.length)
    ),
  ];

  for (const token of candidates) {
    const counts = countTokenMatches(token, raw);
    const total = counts.lectures + counts.materials + counts.mcqs + counts.flashcards;

    // Keep every underlying category <=10 so LIMIT 10 cannot select a
    // different subset merely because SQL row order is unspecified.
    if (
      total > 0 &&
      counts.lectures <= 10 &&
      counts.materials <= 10 &&
      counts.mcqs <= 10 &&
      counts.flashcards <= 10
    ) {
      return { token, counts, label };
    }
  }

  return null;
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

console.log("99's Guide — Stage 5E-4A Search Shadow Parity");
console.log("---------------------------------------------");
console.log("Mode: READ-ONLY");
console.log("Production /api/search remains unchanged.");
console.log("");

const raw = await workerGet("/internal/content-read/materials-data?scope=full");

assert(raw && typeof raw === "object", "Could not load D1 content sample data.");

const candidates = [
  chooseCandidate((raw.lectures || []).map((x) => `${x.name || ""} ${x.mainSubject || ""}`), raw, "lecture"),
  chooseCandidate((raw.materials || []).map((x) => x.title || ""), raw, "material"),
  chooseCandidate((raw.mcqs || []).map((x) => x.question || ""), raw, "mcq"),
  chooseCandidate((raw.flashcards || []).map((x) => `${x.clinicalConcept || ""} ${x.explanation || ""}`), raw, "flashcard"),
].filter(Boolean);

const uniqueCandidates = [];
const seenTokens = new Set();

for (const candidate of candidates) {
  const key = candidate.token.toLowerCase();
  if (seenTokens.has(key)) continue;
  seenTokens.add(key);
  uniqueCandidates.push(candidate);
}

assert(
  uniqueCandidates.length >= 2,
  "Could not derive enough safe search queries for parity testing.",
  uniqueCandidates
);

for (const candidate of uniqueCandidates) {
  const q = encodeURIComponent(candidate.token);

  const [renderResults, d1Results] = await Promise.all([
    renderGet(`/api/search?q=${q}`),
    workerGet(`/internal/content-read/search?q=${q}`),
  ]);

  assert(Array.isArray(renderResults), `Render search result is not an array for ${candidate.token}`);
  assert(Array.isArray(d1Results), `D1 search result is not an array for ${candidate.token}`);

  assert(
    !containsCorrectAnswer(renderResults),
    `Render search leaked correctAnswer for ${candidate.token}`
  );
  assert(
    !containsCorrectAnswer(d1Results),
    `D1 search leaked correctAnswer for ${candidate.token}`
  );

  const renderCanonical = canonicalize(renderResults);
  const d1Canonical = canonicalize(d1Results);
  const diff = firstDifference(renderCanonical, d1Canonical);

  if (diff) {
    fail(`Search semantic parity mismatch for query "${candidate.token}"`, {
      candidate,
      diff,
      renderIds: renderCanonical.map((x) => x.id),
      d1Ids: d1Canonical.map((x) => x.id),
    });
  }

  console.log(
    `${candidate.label} query="${candidate.token}": ${renderResults.length} results — PASS`
  );
}

const [renderEmpty, d1Empty] = await Promise.all([
  renderGet("/api/search?q="),
  workerGet("/internal/content-read/search?q="),
]);

assert(Array.isArray(renderEmpty) && renderEmpty.length === 0, "Render empty search contract changed.");
assert(Array.isArray(d1Empty) && d1Empty.length === 0, "D1 empty search contract is not [].");

console.log("Empty query contract: [] — PASS");
console.log("correctAnswer exposure: NONE");
console.log("");
console.log("STAGE 5E-4A SEARCH SHADOW PARITY PASS");
console.log("No database was modified.");
