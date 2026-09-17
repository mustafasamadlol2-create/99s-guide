import assert from "node:assert/strict";
import test from "node:test";
import type {
  AIImportRepository,
  ExistingDuplicateRecord,
  FlashcardImportCandidate,
  MCQImportCandidate,
} from "../server/services/ai/import/contracts.js";
import { AIImportService } from "../server/services/ai/import/service.js";
import { parseMCQImportRequest } from "../server/services/ai/import/schemas.js";
import { analyzeDuplicates, duplicateRecord } from "../server/services/ai/import/duplicateDetection.js";
import { normalizeDuplicateText } from "../server/services/ai/import/normalize.js";

const mcq = (clientKey: string, question: string): MCQImportCandidate => ({
  clientKey,
  question,
  optionA: "Option A",
  optionB: "Option B",
  optionC: "Option C",
  optionD: "Option D",
  correctAnswer: "A",
  hint: null,
  explanation: "Explanation",
  difficulty: null,
});

const flashcard = (clientKey: string, clinicalConcept: string): FlashcardImportCandidate => ({
  clientKey,
  clinicalConcept,
  explanation: "Explanation",
});

class FakeImportRepository implements AIImportRepository {
  readonly lecture = { id: "lecture-1", name: "Cardiology" };
  mcqs: ExistingDuplicateRecord[] = [];
  flashcards: ExistingDuplicateRecord[] = [];
  writes = 0;
  failWrites = false;

  async findLecture(id: string) {
    return id === this.lecture.id ? this.lecture : null;
  }

  async findExistingMCQs() {
    return [...this.mcqs];
  }

  async findExistingFlashcards() {
    return [...this.flashcards];
  }

  async importMCQsTransactionally(_lectureId: string, candidates: MCQImportCandidate[]) {
    this.writes += 1;
    if (this.failWrites) throw new Error("simulated database failure");
    const decisions = analyzeDuplicates(
      candidates.map((candidate) => ({ clientKey: candidate.clientKey, key: normalizeDuplicateText(candidate.question), preview: candidate.question })),
      this.mcqs,
    );
    const created = candidates
      .filter((candidate) => decisions.find((decision) => decision.clientKey === candidate.clientKey)?.status === "new")
      .map((candidate) => {
        const id = `mcq-${candidate.clientKey}`;
        this.mcqs.push(duplicateRecord(id, candidate.question));
        return { id, row: { ...candidate, id, lectureId: "lecture-1" } };
      });
    return { decisions, created };
  }

  async importFlashcardsTransactionally(_lectureId: string, candidates: FlashcardImportCandidate[]) {
    this.writes += 1;
    if (this.failWrites) throw new Error("simulated database failure");
    const decisions = analyzeDuplicates(
      candidates.map((candidate) => ({ clientKey: candidate.clientKey, key: normalizeDuplicateText(candidate.clinicalConcept), preview: candidate.clinicalConcept })),
      this.flashcards,
    );
    const created = candidates
      .filter((candidate) => decisions.find((decision) => decision.clientKey === candidate.clientKey)?.status === "new")
      .map((candidate) => {
        const id = `flashcard-${candidate.clientKey}`;
        this.flashcards.push(duplicateRecord(id, candidate.clinicalConcept));
        return { id, row: { ...candidate, id, lectureId: "lecture-1" } };
      });
    return { decisions, created };
  }
}

test("duplicate normalization preserves Arabic and removes harmless spacing differences", () => {
  assert.equal(
    normalizeDuplicateText("  ما هو   ضغط الدم؟ "),
    normalizeDuplicateText("ما هو ضغط الدم؟"),
  );
  assert.match(normalizeDuplicateText("ما هو ضغط الدم؟"), /[\u0600-\u06ff]/u);
});

test("duplicate analysis classifies exact and conservative near duplicates", () => {
  const decisions = analyzeDuplicates(
    [
      { clientKey: "a", key: normalizeDuplicateText("What is the main virulence factor of Staphylococcus aureus in disease?"), preview: "first" },
      { clientKey: "b", key: normalizeDuplicateText("What is the main   virulence factor of Staphylococcus aureus in disease?"), preview: "second" },
      { clientKey: "c", key: normalizeDuplicateText("What is the major virulence factor of Staphylococcus aureus in disease?"), preview: "third" },
      { clientKey: "d", key: normalizeDuplicateText("Which organ stores bile?"), preview: "short" },
    ],
    [],
  );
  assert.equal(decisions[0]?.status, "new");
  assert.equal(decisions[1]?.status, "exact_duplicate");
  assert.equal(decisions[2]?.status, "possible_duplicate");
  assert.equal(decisions[3]?.status, "new");
});

test("check is read-only and reports batch and existing duplicate counts", async () => {
  const repository = new FakeImportRepository();
  repository.mcqs = [duplicateRecord("existing-1", "Existing question about cardiac output")];
  const service = new AIImportService(repository);
  const result = await service.check("mcq", "lecture-1", [
    mcq("one", "Existing question about cardiac output"),
    mcq("two", "New question about renal filtration"),
    mcq("three", "New   question about renal filtration"),
  ], "request-1");
  assert.equal(repository.writes, 0);
  assert.deepEqual(result.summary, {
    submittedCount: 3,
    newCount: 1,
    exactDuplicateCount: 2,
    possibleDuplicateCount: 0,
  });
});

test("commit skips duplicates, imports new items in one repository transaction, and syncs only created rows", async () => {
  const repository = new FakeImportRepository();
  repository.mcqs = [duplicateRecord("existing-1", "Existing MCQ")];
  const synced: string[] = [];
  const service = new AIImportService(repository, async ({ rows }) => {
    synced.push(...rows.map((row) => row.id));
  });
  const result = await service.commit("mcq", "lecture-1", [
    mcq("duplicate", "Existing MCQ"),
    mcq("new", "A completely new question about renal physiology"),
  ], "request-2");
  assert.equal(repository.writes, 1);
  assert.equal(result.summary.importedCount, 1);
  assert.equal(result.summary.exactDuplicateSkipped, 1);
  assert.deepEqual(synced, ["mcq-new"]);
  assert.equal(result.items.find((item) => item.clientKey === "new")?.status, "imported");
  assert.equal(result.items.find((item) => item.clientKey === "duplicate")?.status, "exact_duplicate");
});

test("failed commit leaves the repository unchanged and does not invoke synchronization", async () => {
  const repository = new FakeImportRepository();
  repository.failWrites = true;
  let syncCalls = 0;
  const service = new AIImportService(repository, async () => { syncCalls += 1; });
  await assert.rejects(() => service.commit("flashcard", "lecture-1", [
    flashcard("one", "Renal filtration"),
  ]));
  assert.equal(repository.flashcards.length, 0);
  assert.equal(syncCalls, 0);
});

test("request schema rejects unknown fields, duplicate client keys, and oversized batches", () => {
  assert.throws(() => parseMCQImportRequest({
    lectureId: "lecture-1",
    candidates: [mcq("same", "Question one"), mcq("same", "Question two")],
  }));
  assert.throws(() => parseMCQImportRequest({
    lectureId: "lecture-1",
    candidates: [{ ...mcq("one", "Question one"), confidence: 0.99 }],
  }));
  assert.throws(() => parseMCQImportRequest({
    lectureId: "lecture-1",
    candidates: Array.from({ length: 101 }, (_, index) => mcq(`key-${index}`, `Question ${index}`)),
  }));
});