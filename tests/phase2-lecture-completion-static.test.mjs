import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('Phase 2 adds canonical completion source types and fixed rewards', () => {
  const constants = read('server/features/study-points/constants.ts');
  const rules = read('server/features/study-points/awardRules.ts');
  assert.match(constants, /"LECTURE_RESOURCE"/u);
  assert.match(constants, /"LECTURE_COMPLETION"/u);
  assert.match(rules, /LECTURE_PDF_COMPLETION_AMOUNT = 5/u);
  assert.match(rules, /LECTURE_NOTES_COMPLETION_AMOUNT = 3/u);
  assert.match(rules, /LECTURE_COMPLETION_AMOUNT = 8/u);
  assert.match(rules, /reasonCode: "lecture\.pdf_completed"/u);
  assert.match(rules, /reasonCode: "lecture\.notes_completed"/u);
  assert.match(rules, /reasonCode: "lecture\.completed"/u);
});

test('migration adds completion timestamps without retroactive backfill', () => {
  const migration = read('prisma/migrations/20261018180000_phase2_lecture_completion_points/migration.sql');
  for (const col of ['pdfCompletedAt','notesCompletedAt','videoCompletedAt','flashcardsCompletedAt','quizCompletedAt','lectureCompletedAt']) {
    assert.match(migration, new RegExp(`ADD COLUMN "${col}" TIMESTAMP\\(3\\)`));
  }
  assert.match(migration, /'LECTURE_RESOURCE'/u);
  assert.match(migration, /'LECTURE_COMPLETION'/u);
  assert.doesNotMatch(migration, /UPDATE\s+"LectureProgress"/iu);
});

test('normal Lecture view uses one server-authoritative completion API', () => {
  const ui = read('src/features/lectures/components/LectureDetailView.tsx');
  assert.match(ui, /\/api\/progress\/lecture\/\$\{encodeURIComponent\(lecture\.id\)\}\/complete/u);
  assert.match(ui, /resourceType: "PDF"/u);
  assert.match(ui, /resourceType: "NOTES"/u);
  assert.match(ui, /resourceType: "LECTURE"/u);
  assert.doesNotMatch(ui, /apiClient\("\/api\/progress\/complete"/u);
});

test('completion service rejects retroactive boolean-only progress and requires timestamps', () => {
  const service = read('server/features/lecture-progress/completion.ts');
  assert.match(service, /alreadyBooleanComplete && !existingCompletedAt/u);
  assert.match(service, /requirements\.pdf && !progress\?\.pdfCompletedAt/u);
  assert.match(service, /requirements\.notes && !progress\?\.notesCompletedAt/u);
  assert.match(service, /requirements\.video && !progress\?\.videoCompletedAt/u);
  assert.match(service, /requirements\.quiz && !progress\?\.quizCompletedAt/u);
  assert.match(service, /requirements\.flashcards && !progress\?\.flashcardsCompletedAt/u);
});

test('MCQ and flashcard completion remain automatic', () => {
  const server = read('server.ts');
  assert.match(server, /quizCompletedAt: existingProgress\?\.quizCompletedAt \?\? occurredAt/u);
  assert.match(server, /flashcardsCompletedAt: existingProgress\?\.flashcardsCompletedAt \?\? occurredAt/u);
  assert.match(server, /app\.post\("\/api\/progress\/lecture\/:lectureId\/complete"/u);
});

test('legacy client sync cannot clear a canonical completion', () => {
  const server = read('server.ts');
  assert.match(server, /pdfCompleted: !!currentProgress\?\.pdfCompleted \|\| !!p\.pdfCompleted/u);
  assert.match(server, /notesCompleted: !!currentProgress\?\.notesCompleted \|\| !!p\.notesCompleted/u);
  assert.match(server, /pdfCompleted: !!existingProg\?\.pdfCompleted \|\| !!payload\.pdfCompleted/u);
});
