ALTER TABLE "LectureProgress"
    ADD COLUMN "pdfCompletedAt" TIMESTAMP(3),
    ADD COLUMN "notesCompletedAt" TIMESTAMP(3),
    ADD COLUMN "videoCompletedAt" TIMESTAMP(3),
    ADD COLUMN "flashcardsCompletedAt" TIMESTAMP(3),
    ADD COLUMN "quizCompletedAt" TIMESTAMP(3),
    ADD COLUMN "lectureCompletedAt" TIMESTAMP(3);

ALTER TABLE "StudyPointsLedgerEntry"
    DROP CONSTRAINT "StudyPointsLedgerEntry_sourceType_check";

ALTER TABLE "StudyPointsLedgerEntry"
    ADD CONSTRAINT "StudyPointsLedgerEntry_sourceType_check"
    CHECK ("sourceType" IN (
        'FOCUS_SESSION',
        'GROUP_FOCUS_RUN',
        'MCQ_ATTEMPT',
        'FLASHCARD_REVIEW',
        'RECALL_ATTEMPT',
        'LECTURE_RESOURCE',
        'LECTURE_COMPLETION',
        'DAILY_CONSISTENCY',
        'ADMIN_ADJUSTMENT',
        'LEGACY_POINTS_LOG',
        'REVERSAL'
    ));
