import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Subject } from "../src/core/types";
import {
  CANONICAL_HOME_SUBJECT_ORDER,
  moveSubject,
  orderHomeSubjects,
} from "../src/features/personalization/homeSubjectOrder";
import type { SubjectId } from "../shared/personalization";
import {
  getHomeSubjectVisibilityReason,
  isHomeSubjectEffectivelyVisible,
  resolveHomeSubjectVisibility,
} from "../src/features/personalization/homeSubjectVisibility";

const homeSource = readFileSync(
  new URL("../src/features/home/components/HomeDashboard.tsx", import.meta.url),
  "utf8",
);
const studioSource = readFileSync(
  new URL(
    "../src/features/personalization/components/My99Studio.tsx",
    import.meta.url,
  ),
  "utf8",
);
const editorSource = readFileSync(
  new URL(
    "../src/features/personalization/components/HomeSubjectOrderEditor.tsx",
    import.meta.url,
  ),
  "utf8",
);
const translationsSource = readFileSync(
  new URL("../src/core/i18n/translations.ts", import.meta.url),
  "utf8",
);

function makeSubject(id: Subject["id"], name: string = id): Subject {
  return {
    id,
    name,
    nameAr: "",
    icon: "BookOpen",
    color: "text-blue-500",
    description: "",
    modules: [],
  };
}

const subjects = CANONICAL_HOME_SUBJECT_ORDER.map((id) => makeSubject(id));
const reversed = [...CANONICAL_HOME_SUBJECT_ORDER].reverse();

test("orders the canonical Home subject entities by preference", () => {
  assert.deepEqual(
    orderHomeSubjects(subjects, CANONICAL_HOME_SUBJECT_ORDER).map(
      (subject) => subject.id,
    ),
    [...CANONICAL_HOME_SUBJECT_ORDER],
  );
  assert.deepEqual(
    orderHomeSubjects(subjects, reversed).map((subject) => subject.id),
    reversed,
  );

  const arbitrary = ["CA", "SSC", "ID", "PHC", "NT", "ImD", "RM"] as const;
  const ordered = orderHomeSubjects(subjects, arbitrary);
  assert.deepEqual(
    ordered.map((subject) => subject.id),
    [...arbitrary],
  );
  assert.equal(ordered[0], subjects[3]);
  assert.equal(ordered[1], subjects[6]);
});

test("falls back defensively without dropping a canonical Home subject", () => {
  for (const invalidOrder of [
    ["ID", "ID", "RM", "CA", "PHC", "ImD", "SSC"],
    ["ID", "NT", "RM", "CA", "PHC", "ImD"],
    ["ID", "NT", "RM", "CA", "PHC", "ImD", "NOPE"],
    ["ID", "NT", "RM", "CA", "PHC", "ImD", "SSC", "CA"],
  ] as const) {
    const ordered = orderHomeSubjects(
      subjects,
      invalidOrder as unknown as readonly SubjectId[],
    );
    assert.deepEqual(
      ordered.map((subject) => subject.id),
      [...CANONICAL_HOME_SUBJECT_ORDER],
    );
  }
});

test("ordering is immutable and preserves subject object identity", () => {
  const originalSubjects = [...subjects];
  const originalOrder = [...reversed];
  const ordered = orderHomeSubjects(subjects, reversed);

  assert.deepEqual(subjects, originalSubjects);
  assert.deepEqual(reversed, originalOrder);
  assert.deepEqual(ordered, [...subjects].reverse());
  assert.equal(ordered[0], subjects[6]);
  assert.equal(ordered[6], subjects[0]);
  assert.notEqual(ordered, subjects);
});

test("unexpected source data is preserved rather than silently hidden", () => {
  const extraSubject = makeSubject("ID", "duplicate");
  const unexpectedSource = [...subjects, extraSubject];
  const returned = orderHomeSubjects(unexpectedSource, reversed);

  assert.equal(returned.length, 8);
  assert.equal(returned[7], extraSubject);
});

test("moveSubject is immutable and safely handles boundaries", () => {
  const start = [...CANONICAL_HOME_SUBJECT_ORDER];
  const afterUp = moveSubject(start, "SSC", "up");
  const afterTop = moveSubject(afterUp, "SSC", "up");
  const afterDown = moveSubject(afterTop, "SSC", "down");

  assert.deepEqual(start, [...CANONICAL_HOME_SUBJECT_ORDER]);
  assert.deepEqual(afterUp, ["ID", "NT", "RM", "CA", "PHC", "SSC", "ImD"]);
  assert.deepEqual(afterTop, ["ID", "NT", "RM", "CA", "SSC", "PHC", "ImD"]);
  assert.deepEqual(afterDown, afterUp);
  assert.deepEqual(moveSubject(start, "ID", "up"), start);
  assert.deepEqual(moveSubject(start, "SSC", "down"), start);
});

test("Home visibility combines manual hides and semester controls without changing stored order", () => {
  const resolved = resolveHomeSubjectVisibility(
    subjects,
    reversed,
    ["ID", "SSC"],
    { semester1: false, semester2: true },
  );
  assert.deepEqual(
    resolved.orderedSubjects.map((subject) => subject.id),
    reversed,
  );
  assert.deepEqual(
    resolved.visibleSubjects.map((subject) => subject.id),
    ["ImD", "CA"],
  );
  assert.equal(getHomeSubjectVisibilityReason("NT", [], { semester1: false, semester2: true }), "hidden-by-semester-1");
  assert.equal(getHomeSubjectVisibilityReason("ID", ["ID"], { semester1: true, semester2: true }), "hidden-manually");
  assert.equal(isHomeSubjectEffectivelyVisible("CA", [], { semester1: false, semester2: false }), true);
});

test("Home reads committed order once at the subject-list boundary", () => {
  assert.match(homeSource, /usePersonalization/);
  assert.match(homeSource, /committed\.home\.subjectOrder/);
  assert.match(homeSource, /resolveHomeSubjectVisibility/);
  assert.match(homeSource, /visibleSubjects\.map/);
  assert.match(homeSource, /key=\{subject\.id\}/);
  assert.doesNotMatch(homeSource, /draft\.home\.subjectOrder/);
  assert.doesNotMatch(homeSource, /data-app-subject-order/);
});

test("Studio uses Draft order for the editor and contained preview only", () => {
  assert.match(studioSource, /draft\.home\.subjectOrder/);
  assert.match(studioSource, /<HomeSubjectOrderEditor/);
  assert.match(studioSource, /type: "setSubjectOrder"/);
  assert.doesNotMatch(studioSource, /data-personalization-preview-subject-order/);
   assert.match(editorSource, /hiddenSubjectIds/);
  assert.match(editorSource, /<ol/);
  assert.match(editorSource, /my99MoveUp/);
  assert.match(editorSource, /my99MoveDown/);
  assert.match(editorSource, /disabled=\{isFirst\}/);
  assert.match(editorSource, /disabled=\{isLast\}/);
});

test("Prompt 18 labels are localized in English and Arabic", () => {
  for (const key of [
    "my99HomeSubjectOrderTitle",
    "my99HomeSubjectOrderDescription",
    "my99HomeSubjectOrderPreviewTitle",
    "my99MoveUp",
    "my99MoveDown",
     "my99SemesterVisibilityTitle",
     "my99Semester1",
     "my99Semester2",
     "my99ShownOnHome",
     "my99HiddenManually",
    "my99SubjectIdName",
    "my99SubjectNtName",
    "my99SubjectRmName",
    "my99SubjectCaName",
    "my99SubjectPhcName",
    "my99SubjectImdName",
    "my99SubjectSscName",
  ]) {
    assert.match(translationsSource, new RegExp(`${key}:`));
  }
  assert.match(translationsSource, /my99HomeSubjectOrderTitle: "Home subject order"/);
  assert.match(
    translationsSource,
    /my99HomeSubjectOrderTitle: "ترتيب المواد في الصفحة الرئيسية"/,
  );
});