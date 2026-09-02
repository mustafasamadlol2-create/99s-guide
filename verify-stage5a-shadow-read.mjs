const BASE =
  (process.env.CONTENT_WORKER_BASE_URL ||
    "https://99s-content-api.mustafasamadlol2.workers.dev").replace(/\/+$/, "");
const SECRET = process.env.CONTENT_SYNC_SECRET || "";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function containsForbiddenCorrectAnswer(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenCorrectAnswer);
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "correctAnswer")) return true;
    return Object.values(value).some(containsForbiddenCorrectAnswer);
  }
  return false;
}

async function getJson(path) {
  const response = await fetch(`${BASE}${path}`, {
    headers: {
      "Accept": "application/json",
      "X-Content-Sync-Secret": SECRET,
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    fail(`${path} returned non-JSON HTTP ${response.status}: ${text.slice(0, 160)}`);
  }
  if (!response.ok) {
    fail(`${path} returned HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

if (!SECRET) {
  console.error("CONTENT_SYNC_SECRET is not set in this CMD session.");
  console.error("Set it locally first. Do not send the value to ChatGPT.");
  process.exit(2);
}

console.log("99's Guide — Stage 5A D1 Shadow Read Verification");
console.log("--------------------------------------------------");
console.log(`Worker: ${BASE}`);
console.log("Mode: READ-ONLY");

const lectures = await getJson("/internal/content-read/lectures");
assert(Array.isArray(lectures), "Lecture list response must be an array.");
assert(lectures.length > 0, "Lecture list unexpectedly returned zero rows.");
assert(!containsForbiddenCorrectAnswer(lectures), "correctAnswer leaked in lecture list.");

const ids = lectures.map((row) => row?.id);
assert(ids.every((id) => typeof id === "string" && id.length > 0), "Lecture list contains invalid ids.");
assert(new Set(ids).size === ids.length, "Lecture list contains duplicate ids.");

const sample = lectures.find((row) => row && typeof row.id === "string");
assert(sample, "No sample lecture available.");

const detail = await getJson(`/internal/content-read/lectures/${encodeURIComponent(sample.id)}`);
assert(detail?.id === sample.id, "Lecture detail id does not match list id.");
assert(Array.isArray(detail.materials), "Lecture detail materials must be an array.");
assert(Array.isArray(detail.mcqs), "Lecture detail mcqs must be an array.");
assert(Array.isArray(detail.flashcards), "Lecture detail flashcards must be an array.");
assert(!containsForbiddenCorrectAnswer(detail), "correctAnswer leaked in lecture detail.");

if (typeof sample.mainSubject === "string" && sample.mainSubject.trim()) {
  const filtered = await getJson(
    `/internal/content-read/lectures?mainSubject=${encodeURIComponent(sample.mainSubject)}`
  );
  assert(Array.isArray(filtered), "Filtered lecture response must be an array.");
  assert(
    filtered.every(
      (row) =>
        String(row.mainSubject || "").toLowerCase() === sample.mainSubject.toLowerCase()
    ),
    "Case-insensitive mainSubject filter returned a mismatched row."
  );
}

console.log(`Lecture list: ${lectures.length} rows`);
console.log(`Sample detail: ${sample.id}`);
console.log(`Materials in sample: ${detail.materials.length}`);
console.log(`MCQs in sample: ${detail.mcqs.length}`);
console.log(`Flashcards in sample: ${detail.flashcards.length}`);
console.log("correctAnswer exposure: NONE");
console.log("");
console.log("STAGE 5A SHADOW READ PASS");
console.log("No database was modified.");
