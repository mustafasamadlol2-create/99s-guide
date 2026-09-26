import assert from "node:assert/strict";
import test from "node:test";
import {
  isQualifyingFocusStudyEvidence,
  isQualifyingGroupFocusStudyEvidence,
  mergeRecallLectureStudyFacts,
  normalizeStudyEventLectureEvidence,
} from "../server/features/recall/sourceEvidence.js";

const AS_OF = new Date("2026-09-26T12:00:00.000Z");

test("only completed meaningful solo Focus establishes lecture study", () => {
  const base = {
    userId: "user-1",
    lectureId: "lecture-1",
    status: "COMPLETED",
    activeSeconds: 600,
    completedAt: new Date(AS_OF.getTime() - 1_000),
  };
  assert.equal(isQualifyingFocusStudyEvidence(base, "user-1", AS_OF), true);
  assert.equal(
    isQualifyingFocusStudyEvidence(
      { ...base, activeSeconds: 599 },
      "user-1",
      AS_OF,
    ),
    false,
  );
  assert.equal(
    isQualifyingFocusStudyEvidence(
      { ...base, status: "CANCELLED" },
      "user-1",
      AS_OF,
    ),
    false,
  );
  assert.equal(
    isQualifyingFocusStudyEvidence(
      { ...base, userId: "user-2" },
      "user-1",
      AS_OF,
    ),
    false,
  );
  assert.equal(
    isQualifyingFocusStudyEvidence(
      { ...base, completedAt: new Date(AS_OF.getTime() + 1) },
      "user-1",
      AS_OF,
    ),
    false,
  );
});

test("Group Focus requires verified positive time and a canonical lecture", () => {
  const base = {
    userId: "user-1",
    lectureId: "lecture-1",
    verifiedFocusSeconds: 1,
    completedAt: new Date(AS_OF.getTime() - 1_000),
  };
  assert.equal(
    isQualifyingGroupFocusStudyEvidence(base, "user-1", AS_OF),
    true,
  );
  assert.equal(
    isQualifyingGroupFocusStudyEvidence(
      { ...base, verifiedFocusSeconds: 0 },
      "user-1",
      AS_OF,
    ),
    false,
  );
  assert.equal(
    isQualifyingGroupFocusStudyEvidence(
      { ...base, lectureId: "" },
      "user-1",
      AS_OF,
    ),
    false,
  );
});

test("server-validated private study events qualify, while opens and client events do not", () => {
  const base = {
    userId: "user-1",
    lectureId: "lecture-1",
    eventType: "mcq_attempted",
    source: "backend",
    occurredAt: new Date(AS_OF.getTime() - 1_000),
    evidenceClass: "SERVER_VALIDATED",
    privacyClass: "PRIVATE_STUDY",
  };
  assert.equal(
    normalizeStudyEventLectureEvidence(base, "user-1", AS_OF)?.evidenceSource,
    "MCQ",
  );
  assert.equal(
    normalizeStudyEventLectureEvidence(
      { ...base, eventType: "lecture_resource_launched" },
      "user-1",
      AS_OF,
    ),
    null,
  );
  for (const ignoredType of [
    "lecture_progress_recorded",
    "lecture_pdf_opened",
    "video_opened",
    "app_opened",
  ]) {
    assert.equal(
      normalizeStudyEventLectureEvidence(
        { ...base, eventType: ignoredType },
        "user-1",
        AS_OF,
      ),
      null,
    );
  }
  assert.equal(
    normalizeStudyEventLectureEvidence(
      { ...base, evidenceClass: "CLIENT_OBSERVED" },
      "user-1",
      AS_OF,
    ),
    null,
  );
  assert.equal(
    normalizeStudyEventLectureEvidence(
      { ...base, source: "web" },
      "user-1",
      AS_OF,
    ),
    null,
  );
  assert.equal(
    normalizeStudyEventLectureEvidence(
      { ...base, privacyClass: "PUBLIC_PROFILE" },
      "user-1",
      AS_OF,
    ),
    null,
  );
  assert.equal(
    normalizeStudyEventLectureEvidence(
      { ...base, lectureId: null },
      "user-1",
      AS_OF,
    ),
    null,
    "Do not fabricate a lecture mapping.",
  );
});

test("study evidence merges into private lecture-only facts and orders deterministically", () => {
  const merged = mergeRecallLectureStudyFacts([
    {
      lectureId: "lecture-b",
      studiedAt: new Date(AS_OF.getTime() - 2_000),
      evidenceSource: "FOCUS",
    },
    {
      lectureId: "lecture-a",
      studiedAt: new Date(AS_OF.getTime() - 1_000),
      evidenceSource: "FLASHCARD",
    },
    {
      lectureId: "lecture-b",
      studiedAt: new Date(AS_OF.getTime() - 500),
      evidenceSource: "GROUP_FOCUS",
    },
  ]);
  assert.deepEqual(
    merged.map(({ lectureId, evidenceSources }) => ({
      lectureId,
      evidenceSources,
    })),
    [
      { lectureId: "lecture-b", evidenceSources: ["FOCUS", "GROUP_FOCUS"] },
      { lectureId: "lecture-a", evidenceSources: ["FLASHCARD"] },
    ],
  );
  assert.deepEqual(Object.keys(merged[0] ?? {}).sort(), [
    "evidenceSources",
    "firstStudiedAt",
    "lastStudiedAt",
    "lectureId",
  ]);
});