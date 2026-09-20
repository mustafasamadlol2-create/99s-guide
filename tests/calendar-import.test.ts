import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PrismaClient } from "@prisma/client";
import type {
  AIProvider,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from "../server/services/ai/contracts.js";
import type { AIContentPart } from "../server/services/ai/input/contracts.js";
import {
  calendarCandidateSchema,
  commitRequestSchema,
  extractionCandidateSchema,
  type ExtractionCandidate,
} from "../server/services/calendarImport/schemas.js";
import {
  applyVerification,
  candidateDateTime,
  normalizeCandidate,
} from "../server/services/calendarImport/normalize.js";
import {
  compareCandidateToEvents,
  computeFingerprint,
  intervalsOverlap,
  markWithinImportConflicts,
  markWithinImportDuplicates,
} from "../server/services/calendarImport/duplicateDetection.js";
import { extractSchedule } from "../server/services/calendarImport/extraction.js";
import { CalendarImportService } from "../server/services/calendarImport/service.js";

function rawCandidate(overrides: Partial<ExtractionCandidate> = {}): ExtractionCandidate {
  return extractionCandidateSchema.parse({
    title: "Nutrition lecture",
    eventType: "LECTURE",
    date: "2026-09-20",
    startTime: "08:00",
    endTime: "10:00",
    allDay: false,
    rawDate: "20 September 2026",
    rawStartTime: "8:00 AM",
    rawEndTime: "10:00 AM",
    subjectId: "NT",
    subjectLabelRaw: "Nutrition",
    room: "Hall 1",
    doctor: "Dr. Test",
    description: "Source-backed schedule row",
    targetGroups: ["A"],
    sourcePage: 1,
    sourceImageIndex: null,
    sourceEvidence: "Nutrition lecture, 20 September 2026",
    warnings: [],
    ...overrides,
  });
}

function normalize(raw: ExtractionCandidate, candidateId = "candidate-1") {
  return normalizeCandidate(raw, candidateId, {
    defaultTargetGroups: ["ALL"],
    sourcePageCount: 4,
    sourceImageCount: 0,
  });
}

function makeJob(sourcePath: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    userId: "admin-1",
    status: "UPLOADED",
    stage: "Uploading",
    sourceFileName: "scanned-schedule.pdf",
    sourceMime: "application/pdf",
    sourceSha256: "source-sha",
    sourcePageCount: null,
    sourcePath: JSON.stringify([sourcePath]),
    timezone: "Asia/Baghdad",
    defaultTargetGroups: "A",
    progressCurrent: 0,
    progressTotal: 0,
    previewData: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date("2026-09-20T00:00:00.000Z"),
    updatedAt: new Date("2026-09-20T00:00:00.000Z"),
    completedAt: null,
    ...overrides,
  };
}

function makePrisma(job: Record<string, unknown>, options: { failOnCreate?: number } = {}) {
  const events: Array<Record<string, unknown>> = [];
  let eventCreates = 0;
  const matchesStatus = (expected: unknown) => {
    if (!expected) return true;
    if (typeof expected === "string") return job.status === expected;
    if (typeof expected === "object" && expected !== null && "in" in expected) {
      return (expected.in as string[]).includes(String(job.status));
    }
    return false;
  };
  const prisma = {
    calendarImportJob: {
      async findUnique() { return job; },
      async findFirst() { return job; },
      async updateMany(args: { where: { status?: unknown }; data: Record<string, unknown> }) {
        if (!matchesStatus(args.where.status)) return { count: 0 };
        Object.assign(job, args.data);
        job.updatedAt = new Date();
        return { count: 1 };
      },
      async update(args: { data: Record<string, unknown> }) {
        Object.assign(job, args.data);
        job.updatedAt = new Date();
        return job;
      },
    },
    calendarEvent: {
      async findMany() { return events; },
      async create(args: { data: Record<string, unknown> }) {
        eventCreates += 1;
        if (options.failOnCreate === eventCreates) {
          throw new Error("simulated invariant failure");
        }
        const event = {
          id: `event-${eventCreates}`,
          ...args.data,
        };
        events.push(event);
        return event;
      },
    },
    async $transaction<T>(callback: (transaction: unknown) => Promise<T>) {
      const snapshot = [...events];
      try {
        return await callback(prisma);
      } catch (error) {
        events.splice(0, events.length, ...snapshot);
        throw error;
      }
    },
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    events,
    get eventCreates() { return eventCreates; },
  };
}

function mockedScheduleProvider(): AIProvider {
  return {
    async generateStructured<T>(
      request: StructuredGenerationRequest<T>,
    ): Promise<StructuredGenerationResult<T>> {
      if (request.trustedSystemInstruction?.startsWith("Verify")) {
        const context = JSON.parse(request.additionalUntrustedContext ?? "{}") as {
          candidates?: Array<{ candidateId: string }>;
        };
        return {
          data: {
            items: (context.candidates ?? []).map((candidate) => ({
              candidateId: candidate.candidateId,
              status: "SOURCE_MATCH",
              issues: [],
            })),
            warnings: [],
          } as T,
          meta: { provider: "test", model: "calendar-import-test" },
        };
      }
      return {
        data: {
          items: [rawCandidate({ sourcePage: 1 })],
          warnings: [],
        } as T,
        meta: { provider: "test", model: "calendar-import-test" },
      };
    },
  };
}

test("normalizes timed events in the Baghdad timezone", () => {
  const normalized = normalize(rawCandidate());
  assert.equal(normalized.candidate.status, "VERIFIED");
  assert.equal(normalized.startDateTime?.toISOString(), "2026-09-20T05:00:00.000Z");
  assert.equal(normalized.endDateTime?.toISOString(), "2026-09-20T07:00:00.000Z");
  assert.equal(normalized.candidate.subjectId, "NT");
});

test("stores an explicit all-day event as a Baghdad half-open interval", () => {
  const normalized = normalize(rawCandidate({
    title: "College holiday",
    eventType: "HOLIDAY",
    allDay: true,
    startTime: null,
    endTime: null,
    rawStartTime: null,
    rawEndTime: null,
  }));
  assert.equal(normalized.candidate.status, "VERIFIED");
  assert.equal(normalized.startDateTime?.toISOString(), "2026-09-19T21:00:00.000Z");
  assert.equal(normalized.endDateTime?.toISOString(), "2026-09-20T21:00:00.000Z");
  assert.deepEqual(candidateDateTime(normalized.candidate), {
    startDateTime: normalized.startDateTime,
    endDateTime: normalized.endDateTime,
  });
});

test("does not infer a missing time or ambiguous numeric date", () => {
  const normalized = normalize(rawCandidate({
    date: null,
    rawDate: "09/10/26",
    startTime: null,
    endTime: null,
  }));
  assert.equal(normalized.candidate.status, "NEEDS_REVIEW");
  assert.equal(normalized.startDateTime, null);
  assert.ok(normalized.candidate.warnings.some((warning) => warning.includes("ambiguous")));
  assert.ok(normalized.candidate.warnings.some((warning) => warning.includes("missing")));
});

test("missing time stays reviewable and is not converted to all-day", () => {
  const normalized = normalize(rawCandidate({
    startTime: null,
    endTime: null,
    rawStartTime: null,
    rawEndTime: null,
  }));
  assert.equal(normalized.candidate.status, "NEEDS_REVIEW");
  assert.equal(normalized.candidate.allDay, false);
  assert.equal(normalized.startDateTime, null);
  assert.equal(normalized.endDateTime, null);
});

test("unknown subjects and event types remain unresolved", () => {
  const normalized = normalize(rawCandidate({
    eventType: "SEMINAR",
    subjectId: "unknown-subject",
    subjectLabelRaw: "Unlisted subject",
  }));
  assert.equal(normalized.candidate.status, "NEEDS_REVIEW");
  assert.equal(normalized.candidate.eventType, null);
  assert.equal(normalized.candidate.subjectId, null);
  assert.ok(normalized.candidate.warnings.some((warning) => warning.includes("Unknown event type")));
  assert.ok(normalized.candidate.warnings.some((warning) => warning.includes("Subject could not be resolved")));
});

test("verification disagreement removes automatic selection", () => {
  const normalized = normalize(rawCandidate());
  const reviewed = applyVerification(normalized, {
    status: "MISMATCH",
    issues: ["The source shows a different room."],
  });
  assert.equal(reviewed.candidate.status, "NEEDS_REVIEW");
  assert.equal(reviewed.candidate.selected, false);
  assert.equal(reviewed.candidate.verification.status, "MISMATCH");
});

test("duplicate and conflict checks follow half-open group semantics", () => {
  const normalized = normalize(rawCandidate());
  const candidate = normalized.candidate;
  const existing = {
    id: "existing",
    title: "Existing event",
    eventType: "LECTURE",
    startDateTime: new Date("2026-09-20T06:00:00.000Z"),
    endDateTime: new Date("2026-09-20T08:00:00.000Z"),
    targetGroups: "A",
    subjectId: null,
    importFingerprint: null,
  };
  const comparison = compareCandidateToEvents(candidate, [existing]);
  assert.equal(comparison.duplicate, null);
  assert.equal(comparison.conflict?.id, "existing");
  assert.equal(
    intervalsOverlap(
      new Date("2026-09-20T08:00:00.000Z"),
      new Date("2026-09-20T09:00:00.000Z"),
      existing.startDateTime,
      existing.endDateTime,
    ),
    false,
  );
  const holiday = normalize(rawCandidate({
    title: "Holiday",
    eventType: "HOLIDAY",
    allDay: true,
    startTime: null,
    endTime: null,
    rawStartTime: null,
    rawEndTime: null,
  })).candidate;
  assert.equal(compareCandidateToEvents(holiday, [existing]).conflict, null);
});

test("fingerprints are stable and change when source provenance changes", () => {
  const candidate = normalize(rawCandidate()).candidate;
  const first = computeFingerprint("source-a", candidate);
  const second = computeFingerprint("source-a", candidate);
  const changedSource = computeFingerprint("source-b", candidate);
  assert.equal(first, second);
  assert.notEqual(first, changedSource);
  assert.equal(markWithinImportDuplicates([candidate, { ...candidate, candidateId: "candidate-2" }])[1]?.status, "DUPLICATE");
});

test("different overlapping rows in one import are marked as conflicts", () => {
  const first = normalize(rawCandidate({ title: "First row" }), "candidate-1").candidate;
  const second = normalize(rawCandidate({ title: "Second row" }), "candidate-2").candidate;
  const marked = markWithinImportConflicts([first, second]);
  assert.equal(marked[0]?.status, "VERIFIED");
  assert.equal(marked[1]?.status, "CONFLICT");
  assert.equal(marked[1]?.selected, false);
});

test("extraction is page-grounded and uses bounded three-page batches", async () => {
  const calls: Array<{ context: string; contents: number }> = [];
  const provider: AIProvider = {
    async generateStructured<T>(
      request: StructuredGenerationRequest<T>,
    ): Promise<StructuredGenerationResult<T>> {
      calls.push({
        context: request.additionalUntrustedContext ?? "",
        contents: request.contents.length,
      });
      const page = calls.length === 1 ? 1 : 4;
      return {
        data: {
          items: [rawCandidate({ sourcePage: page })],
          warnings: [],
        } as T,
        meta: { provider: "test", model: "schedule-test" },
      };
    },
  };

  const result = await extractSchedule({
    provider,
    contents: [{} as AIContentPart],
    sourcePageCount: 4,
    inputKind: "pdf",
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0]!.context, /1-3/);
  assert.match(calls[1]!.context, /4-4/);
  assert.equal(calls[0]!.contents, 1);
  assert.deepEqual(result.candidates.map((candidate) => candidate.sourcePage), [1, 4]);
});

test("strict schemas reject forged pages, times, and unknown candidate fields", () => {
  assert.doesNotThrow(() => calendarCandidateSchema.parse({
    candidateId: "candidate-1",
    title: "Valid event",
    eventType: "LECTURE",
    date: "2026-09-20",
    startTime: "08:00",
    endTime: "10:00",
    allDay: false,
    rawDate: "20 September 2026",
    rawStartTime: "08:00",
    rawEndTime: "10:00",
    subjectId: "NT",
    subjectLabelRaw: "Nutrition",
    room: null,
    doctor: null,
    description: null,
    targetGroups: ["A"],
    sourcePage: 1,
    sourceImageIndex: null,
    sourceEvidence: "source",
    warnings: [],
    verification: { status: "SOURCE_MATCH", issues: [] },
    status: "VERIFIED",
    selected: true,
  }));
  assert.throws(() => extractionCandidateSchema.parse({ ...rawCandidate(), startTime: "8:00" }));
  assert.throws(() => extractionCandidateSchema.parse({ ...rawCandidate(), sourcePage: 0 }));
  assert.throws(() => calendarCandidateSchema.parse({ ...normalize(rawCandidate()).candidate, arbitrary: true }));
  assert.throws(() => commitRequestSchema.parse({ candidateIds: ["candidate-1"], importFingerprint: "forged" }));
});

test("scanned PDF preview reaches review without OCR or Calendar persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "calendar-import-test-"));
  const sourcePath = join(root, "scanned-schedule.pdf");
  await writeFile(sourcePath, Buffer.from("%PDF-1.4\n/Type /Page\n/Type /Page\n%%EOF\n"));
  const job = makeJob(sourcePath);
  const fake = makePrisma(job);
  const service = new CalendarImportService({
    prisma: fake.prisma,
    sourceRoot: root,
    providerFactory: mockedScheduleProvider,
  });
  try {
    await service.process("job-1");
    assert.equal(job.status, "READY_FOR_REVIEW");
    assert.equal(fake.eventCreates, 0);
    const preview = job.previewData as { candidates: Array<{ sourcePage: number | null; status: string }> };
    assert.equal(preview.candidates[0]?.sourcePage, 1);
    assert.equal(preview.candidates[0]?.status, "VERIFIED");
    await assert.rejects(readFile(sourcePath));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("commit is fingerprint-idempotent and cancellation removes its source", async () => {
  const root = await mkdtemp(join(tmpdir(), "calendar-import-test-"));
  const sourcePath = join(root, "schedule.pdf");
  await writeFile(sourcePath, Buffer.from("%PDF-1.4\n/Type /Page\n%%EOF\n"));
  const job = makeJob(sourcePath);
  const fake = makePrisma(job);
  const service = new CalendarImportService({
    prisma: fake.prisma,
    sourceRoot: root,
    providerFactory: mockedScheduleProvider,
  });
  try {
    await service.process("job-1");
    const preview = job.previewData as { candidates: Array<{ candidateId: string }> };
    const request = { candidateIds: [preview.candidates[0]!.candidateId] };
    await assert.rejects(service.commit("admin-1", "job-1", { candidateIds: ["forged-candidate"] }));
    const first = await service.commit("admin-1", "job-1", request);
    assert.equal(first.inserted, 1);
    assert.equal(fake.eventCreates, 1);
    job.status = "IMPORTING";
    const retry = await service.commit("admin-1", "job-1", request);
    assert.equal(retry.inserted, 0);
    assert.equal(retry.alreadyImported, 1);
    assert.equal(fake.eventCreates, 1);

    const cancelSource = join(root, "cancel.pdf");
    await writeFile(cancelSource, Buffer.from("%PDF-1.4\n/Type /Page\n%%EOF\n"));
    const cancelJob = makeJob(cancelSource, { id: "job-2", status: "PROCESSING" });
    const cancelFake = makePrisma(cancelJob);
    const cancelService = new CalendarImportService({ prisma: cancelFake.prisma, sourceRoot: root });
    assert.equal(await cancelService.cancel("admin-1", "job-2"), true);
    assert.equal(cancelJob.status, "CANCELLED");
    assert.equal(cancelFake.eventCreates, 0);
    await assert.rejects(readFile(cancelSource));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("commit transaction rolls back all writes on a later hard failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "calendar-import-test-"));
  const sourcePath = join(root, "schedule.pdf");
  await writeFile(sourcePath, Buffer.from("%PDF-1.4\n/Type /Page\n%%EOF\n"));
  const job = makeJob(sourcePath);
  const fake = makePrisma(job, { failOnCreate: 2 });
  const service = new CalendarImportService({
    prisma: fake.prisma,
    sourceRoot: root,
    providerFactory: mockedScheduleProvider,
  });
  try {
    await service.process("job-1");
    const preview = job.previewData as {
      candidates: Array<Record<string, unknown>>;
      warnings: string[];
      provider: Record<string, unknown>;
    };
    const second = {
      ...preview.candidates[0],
      candidateId: "job-1-2",
      title: "Second event",
      startTime: "11:00",
      endTime: "12:00",
      rawStartTime: "11:00",
      rawEndTime: "12:00",
    };
    job.previewData = { ...preview, candidates: [preview.candidates[0], second] };
    await assert.rejects(service.commit("admin-1", "job-1", {
      candidateIds: ["job-1-1", "job-1-2"],
    }), /simulated invariant failure/);
    assert.equal(fake.events.length, 0);
    assert.equal(job.status, "IMPORTING");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});