import fs from "node:fs/promises";
import path from "node:path";

const RENDER_BASE = (
  process.env.RENDER_BASE_URL || "https://nine9s-guide.onrender.com"
).replace(/\/+$/, "");

const WORKER_BASE = (
  process.env.CONTENT_WORKER_BASE_URL ||
  "https://99s-content-api.mustafasamadlol2.workers.dev"
).replace(/\/+$/, "");

const MATERIALS_DB_PATH =
  process.env.MATERIALS_DB_PATH ||
  path.join(process.cwd(), "materials_db.json");

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

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableObject(value[key])])
    );
  }
  return value;
}

function containsCorrectAnswer(value) {
  if (Array.isArray(value)) return value.some(containsCorrectAnswer);
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "correctAnswer")) return true;
    return Object.values(value).some(containsCorrectAnswer);
  }
  return false;
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stripLocalhostOrigin(rawUrl) {
  let cleanUrl = rawUrl || "";
  try {
    const parsed = new URL(cleanUrl);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      cleanUrl = parsed.pathname + parsed.search + parsed.hash;
    }
  } catch {
    // Already relative.
  }
  return cleanUrl;
}

function buildMaterialsPayload(materialsDb, raw, currentUserGroup, scope) {
  const mergedSubjects = clone(materialsDb.subjects || []);

  for (const lecture of raw.lectures || []) {
    let subject = mergedSubjects.find(
      (s) =>
        String(s.id).toLowerCase() === String(lecture.mainSubject).toLowerCase() ||
        String(s.name).toLowerCase() === String(lecture.mainSubject).toLowerCase()
    );

    if (!subject) {
      subject = {
        id: lecture.mainSubject,
        name: lecture.mainSubject,
        nameAr: "",
        icon: "BookOpen",
        color: "",
        description: "",
        modules: [],
      };
      mergedSubjects.push(subject);
    }

    subject.modules = Array.isArray(subject.modules) ? subject.modules : [];
    const moduleName = lecture.subSubject || "General";

    let module = subject.modules.find(
      (m) => String(m.name).toLowerCase() === String(moduleName).toLowerCase()
    );

    if (!module) {
      module = {
        id: `${subject.id}:${moduleName}`,
        subjectId: subject.id,
        name: moduleName,
        orderNumber: subject.modules.length + 1,
        lectures: [],
      };
      subject.modules.push(module);
    }

    module.lectures = Array.isArray(module.lectures) ? module.lectures : [];
    const existingLecture = module.lectures.find((l) => l.id === lecture.id);

    if (!existingLecture) {
      module.lectures.push({
        ...lecture,
        title: lecture.name,
        type: "lecture",
        pdfUrl:
          lecture.materials?.find(
            (m) => String(m.type).toUpperCase() === "PDF"
          )?.fileUrlOrLink || "",
        notesPdfUrl:
          lecture.materials?.find(
            (m) => String(m.type).toUpperCase() === "NOTE"
          )?.fileUrlOrLink || "",
      });
    }
  }

  const mcqMap = new Map(
    (materialsDb.mcqs || []).map((m) => [m.id, m])
  );

  for (const mcq of raw.mcqs || []) {
    const { correctAnswer: _shouldNeverExist, ...safeMcq } = mcq;
    mcqMap.set(mcq.id, {
      ...safeMcq,
      options: [mcq.optionA, mcq.optionB, mcq.optionC, mcq.optionD].filter(Boolean),
    });
  }
  const mergedMcqs = Array.from(mcqMap.values());

  const flashcardMap = new Map(
    (materialsDb.flashcards || []).map((f) => [f.id, f])
  );

  for (const f of raw.flashcards || []) {
    flashcardMap.set(f.id, {
      ...f,
      frontText: f.clinicalConcept,
      backText: f.explanation,
      front: f.clinicalConcept,
      back: f.explanation,
    });
  }
  const mergedFlashcards = Array.from(flashcardMap.values());

  const mergedVideos = [...(materialsDb.videos || [])];

  for (const m of raw.materials || []) {
    const type = String(m.type || "").toLowerCase();

    if (type === "video" && !mergedVideos.some((v) => v.id === m.id)) {
      mergedVideos.push({
        id: m.id,
        title: m.title,
        url: m.fileUrlOrLink,
        lectureId: m.lectureId,
      });
    } else if (type === "pdf" || type === "note") {
      for (const subject of mergedSubjects) {
        for (const mod of subject.modules || []) {
          for (const lec of mod.lectures || []) {
            if (lec.id !== m.lectureId) continue;
            const cleanUrl = stripLocalhostOrigin(m.fileUrlOrLink);
            if (type === "pdf") lec.pdfUrl = cleanUrl;
            if (type === "note") lec.notesPdfUrl = cleanUrl;
          }
        }
      }
    }
  }

  const mergedEvents = [...(materialsDb.calendarEvents || [])];
  for (const e of (raw.events || []).filter((event) =>
    eventVisibleToGroup(event.targetGroups, currentUserGroup)
  )) {
    if (!mergedEvents.some((ev) => ev.id === e.id)) {
      mergedEvents.push({
        ...e,
        targetGroups:
          typeof e.targetGroups === "string"
            ? e.targetGroups.split(",").filter(Boolean)
            : e.targetGroups || [],
      });
    }
  }

  const normalizedFlashcards = mergedFlashcards.map((f) => ({
    ...f,
    frontText: f.frontText || f.front || f.clinicalConcept || "",
    backText: f.backText || f.back || f.explanation || "",
    front: f.front || f.frontText || f.clinicalConcept || "",
    back: f.back || f.backText || f.explanation || "",
    clinicalConcept: f.clinicalConcept || f.front || f.frontText || "",
    explanation: f.explanation || f.back || f.backText || "",
  }));

  const sanitizedMcqs = mergedMcqs.map((m) => {
    const { correctAnswer: _omit, ...rest } = m;
    return rest;
  });

  if (scope === "subjects") {
    return { subjects: mergedSubjects };
  }

  if (scope === "offline") {
    return {
      mcqs: sanitizedMcqs,
      flashcards: normalizedFlashcards,
    };
  }

  return {
    subjects: mergedSubjects,
    mcqs: sanitizedMcqs,
    flashcards: normalizedFlashcards,
    videos: mergedVideos,
    calendarEvents: mergedEvents,
  };
}

// Canonicalization neutralizes database row-order differences where the current
// Prisma query has no orderBy. Presentation hierarchy order remains intact.
function canonicalizePayload(payload) {
  const x = clone(payload);

  if (Array.isArray(x.mcqs)) {
    x.mcqs.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  if (Array.isArray(x.flashcards)) {
    x.flashcards.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  if (Array.isArray(x.videos)) {
    x.videos.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  if (Array.isArray(x.calendarEvents)) {
    x.calendarEvents.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  if (Array.isArray(x.subjects)) {
    for (const subject of x.subjects) {
      if (!Array.isArray(subject.modules)) continue;
      for (const mod of subject.modules) {
        if (!Array.isArray(mod.lectures)) continue;
        for (const lecture of mod.lectures) {
          if (Array.isArray(lecture.materials)) {
            lecture.materials.sort((a, b) =>
              String(a.id).localeCompare(String(b.id))
            );
          }
        }
      }
    }
  }

  return stableObject(x);
}

function firstDifference(a, b, pathName = "$") {
  if (Object.is(a, b)) return null;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return {
        path: pathName,
        render: `array(${a.length})`,
        d1Shadow: `array(${b.length})`,
      };
    }
    for (let i = 0; i < a.length; i++) {
      const diff = firstDifference(a[i], b[i], `${pathName}[${i}]`);
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
        return { path: `${pathName}.${key}`, render: "<missing>", d1Shadow: b[key] };
      }
      if (!(key in b)) {
        return { path: `${pathName}.${key}`, render: a[key], d1Shadow: "<missing>" };
      }
      const diff = firstDifference(a[key], b[key], `${pathName}.${key}`);
      if (diff) return diff;
    }
    return null;
  }

  return { path: pathName, render: a, d1Shadow: b };
}

if (!AUTH_TOKEN) {
  console.error("AUTH_TOKEN is not set in this CMD session.");
  console.error("Use your current logged-in JWT access token locally.");
  console.error("Do NOT send the token to ChatGPT.");
  process.exit(2);
}

if (!CONTENT_SYNC_SECRET) {
  console.error("CONTENT_SYNC_SECRET is not set in this CMD session.");
  console.error("Use your existing Worker/Render content sync secret locally.");
  console.error("Do NOT send the secret to ChatGPT.");
  process.exit(2);
}

let materialsDb;
try {
  materialsDb = JSON.parse(await fs.readFile(MATERIALS_DB_PATH, "utf8"));
} catch (error) {
  fail(
    `Could not read current materials_db.json at ${MATERIALS_DB_PATH}`,
    error instanceof Error ? error.message : String(error)
  );
}

assert(
  materialsDb && typeof materialsDb === "object" && !Array.isArray(materialsDb),
  "materials_db.json must contain a JSON object."
);

console.log("99's Guide — Stage 5D-2 Materials Shadow Parity");
console.log("------------------------------------------------");
console.log("Mode: READ-ONLY");
console.log("Production /api/materials remains unchanged.");
console.log("");

const me = await renderGet("/api/auth/me");
const groupValue = deepFindKey(me, "studentGroup");
const currentUserGroup =
  typeof groupValue === "string" ? groupValue.trim().toUpperCase() : "";

console.log(
  `Authenticated studentGroup: ${currentUserGroup || "(empty / none)"}`
);

for (const scope of ["subjects", "offline", "full"]) {
  const renderPayload = await renderGet(
    `/api/materials?scope=${encodeURIComponent(scope)}&forceRefresh=1`
  );

  const raw = await workerGet(
    `/internal/content-read/materials-data?scope=${encodeURIComponent(scope)}`
  );

  assert(raw && raw.scope === scope, `Worker returned wrong scope for ${scope}.`);
  assert(
    !containsCorrectAnswer(raw),
    `D1 raw materials shadow leaked correctAnswer for scope=${scope}.`
  );

  const d1ShadowPayload = buildMaterialsPayload(
    materialsDb,
    raw,
    currentUserGroup,
    scope
  );

  assert(
    !containsCorrectAnswer(renderPayload),
    `Render /api/materials leaked correctAnswer for scope=${scope}.`
  );
  assert(
    !containsCorrectAnswer(d1ShadowPayload),
    `D1 assembled payload leaked correctAnswer for scope=${scope}.`
  );

  const renderCanonical = canonicalizePayload(renderPayload);
  const d1Canonical = canonicalizePayload(d1ShadowPayload);

  const diff = firstDifference(
    renderCanonical,
    d1Canonical,
    `scope.${scope}`
  );

  if (diff) {
    fail(`Materials semantic parity mismatch for scope=${scope}`, diff);
  }

  const summary =
    scope === "subjects"
      ? `${renderPayload.subjects?.length ?? 0} subjects`
      : scope === "offline"
        ? `${renderPayload.mcqs?.length ?? 0} MCQs, ${renderPayload.flashcards?.length ?? 0} flashcards`
        : `${renderPayload.subjects?.length ?? 0} subjects, ${renderPayload.mcqs?.length ?? 0} MCQs, ${renderPayload.flashcards?.length ?? 0} flashcards, ${renderPayload.videos?.length ?? 0} videos, ${renderPayload.calendarEvents?.length ?? 0} events`;

  console.log(`scope=${scope}: ${summary} — PASS`);
}

console.log("");
console.log("correctAnswer exposure: NONE");
console.log("legacy materials_db.json merge: PRESERVED");
console.log("STAGE 5D-2 MATERIALS SHADOW PARITY PASS");
console.log("No database was modified.");
