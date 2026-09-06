-- 99's Guide — Stage 4C D1 data verification

SELECT 'Lecture' AS table_name, COUNT(*) AS rows FROM "Lecture"
UNION ALL
SELECT 'Material', COUNT(*) FROM "Material"
UNION ALL
SELECT 'Mcq', COUNT(*) FROM "Mcq"
UNION ALL
SELECT 'Flashcard', COUNT(*) FROM "Flashcard"
UNION ALL
SELECT 'DailyMotto', COUNT(*) FROM "DailyMotto"
UNION ALL
SELECT 'CalendarEvent', COUNT(*) FROM "CalendarEvent";

SELECT
  (
    SELECT COUNT(*)
    FROM "Material" m
    LEFT JOIN "Lecture" l ON l."id" = m."lectureId"
    WHERE l."id" IS NULL
  ) AS orphan_materials,
  (
    SELECT COUNT(*)
    FROM "Mcq" m
    LEFT JOIN "Lecture" l ON l."id" = m."lectureId"
    WHERE l."id" IS NULL
  ) AS orphan_mcqs,
  (
    SELECT COUNT(*)
    FROM "Flashcard" f
    LEFT JOIN "Lecture" l ON l."id" = f."lectureId"
    WHERE l."id" IS NULL
  ) AS orphan_flashcards;

SELECT
  COUNT(*) AS personal_calendar_rows_in_d1
FROM "CalendarEvent"
WHERE "userId" IS NOT NULL;
