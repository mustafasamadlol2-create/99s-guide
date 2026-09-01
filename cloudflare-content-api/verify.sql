-- 99's Guide — Stage 4B D1 schema verification

SELECT name, type
FROM sqlite_master
WHERE type IN ('table', 'index', 'trigger')
  AND (
    name IN ('Lecture','Material','Mcq','Flashcard','DailyMotto','CalendarEvent')
    OR name LIKE 'Lecture_%'
    OR name LIKE 'Material_%'
    OR name LIKE 'Mcq_%'
    OR name LIKE 'Flashcard_%'
    OR name LIKE 'DailyMotto_%'
    OR name LIKE 'CalendarEvent_%'
  )
ORDER BY type, name;
