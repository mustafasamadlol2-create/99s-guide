-- 99's Guide — Stage 8B Verification V2
-- Avoids UNION/compound SELECT limits by using separate statements.
-- READ-ONLY verification only.

-- A) Confirm all newly created private mirror tables exist.
SELECT 'EmailVerificationToken' AS expectedTable, CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='EmailVerificationToken') THEN 'PASS' ELSE 'MISSING' END AS status;
SELECT 'FlashcardProgress' AS expectedTable, CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='FlashcardProgress') THEN 'PASS' ELSE 'MISSING' END AS status;
SELECT 'LectureProgress' AS expectedTable, CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='LectureProgress') THEN 'PASS' ELSE 'MISSING' END AS status;
SELECT 'ModerationHistory' AS expectedTable, CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='ModerationHistory') THEN 'PASS' ELSE 'MISSING' END AS status;
SELECT 'Notification' AS expectedTable, CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='Notification') THEN 'PASS' ELSE 'MISSING' END AS status;
SELECT 'OAuthIdentity' AS expectedTable, CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='OAuthIdentity') THEN 'PASS' ELSE 'MISSING' END AS status;
SELECT 'PasswordResetToken' AS expectedTable, CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='PasswordResetToken') THEN 'PASS' ELSE 'MISSING' END AS status;
SELECT 'PointsLog' AS expectedTable, CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='PointsLog') THEN 'PASS' ELSE 'MISSING' END AS status;
SELECT 'QaAnswer' AS expectedTable, CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='QaAnswer') THEN 'PASS' ELSE 'MISSING' END AS status;
SELECT 'QaQuestion' AS expectedTable, CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='QaQuestion') THEN 'PASS' ELSE 'MISSING' END AS status;
SELECT 'QaVote' AS expectedTable, CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='QaVote') THEN 'PASS' ELSE 'MISSING' END AS status;
SELECT 'Report' AS expectedTable, CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='Report') THEN 'PASS' ELSE 'MISSING' END AS status;
SELECT 'SmartNotification' AS expectedTable, CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='SmartNotification') THEN 'PASS' ELSE 'MISSING' END AS status;
SELECT 'SystemSetting' AS expectedTable, CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='SystemSetting') THEN 'PASS' ELSE 'MISSING' END AS status;
SELECT 'User' AS expectedTable, CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='User') THEN 'PASS' ELSE 'MISSING' END AS status;
SELECT 'UserBan' AS expectedTable, CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='UserBan') THEN 'PASS' ELSE 'MISSING' END AS status;
SELECT 'UserBlock' AS expectedTable, CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='UserBlock') THEN 'PASS' ELSE 'MISSING' END AS status;
SELECT 'UserMute' AS expectedTable, CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='UserMute') THEN 'PASS' ELSE 'MISSING' END AS status;
SELECT 'UserProgress' AS expectedTable, CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='UserProgress') THEN 'PASS' ELSE 'MISSING' END AS status;

-- B) Every new mirror table must still be empty at Stage 8B.
SELECT 'EmailVerificationToken' AS tableName, COUNT(*) AS rowCount FROM "EmailVerificationToken";
SELECT 'FlashcardProgress' AS tableName, COUNT(*) AS rowCount FROM "FlashcardProgress";
SELECT 'LectureProgress' AS tableName, COUNT(*) AS rowCount FROM "LectureProgress";
SELECT 'ModerationHistory' AS tableName, COUNT(*) AS rowCount FROM "ModerationHistory";
SELECT 'Notification' AS tableName, COUNT(*) AS rowCount FROM "Notification";
SELECT 'OAuthIdentity' AS tableName, COUNT(*) AS rowCount FROM "OAuthIdentity";
SELECT 'PasswordResetToken' AS tableName, COUNT(*) AS rowCount FROM "PasswordResetToken";
SELECT 'PointsLog' AS tableName, COUNT(*) AS rowCount FROM "PointsLog";
SELECT 'QaAnswer' AS tableName, COUNT(*) AS rowCount FROM "QaAnswer";
SELECT 'QaQuestion' AS tableName, COUNT(*) AS rowCount FROM "QaQuestion";
SELECT 'QaVote' AS tableName, COUNT(*) AS rowCount FROM "QaVote";
SELECT 'Report' AS tableName, COUNT(*) AS rowCount FROM "Report";
SELECT 'SmartNotification' AS tableName, COUNT(*) AS rowCount FROM "SmartNotification";
SELECT 'SystemSetting' AS tableName, COUNT(*) AS rowCount FROM "SystemSetting";
SELECT 'User' AS tableName, COUNT(*) AS rowCount FROM "User";
SELECT 'UserBan' AS tableName, COUNT(*) AS rowCount FROM "UserBan";
SELECT 'UserBlock' AS tableName, COUNT(*) AS rowCount FROM "UserBlock";
SELECT 'UserMute' AS tableName, COUNT(*) AS rowCount FROM "UserMute";
SELECT 'UserProgress' AS tableName, COUNT(*) AS rowCount FROM "UserProgress";

-- C) Existing shared D1 content must remain untouched.
SELECT 'Lecture' AS tableName, COUNT(*) AS rowCount, CASE WHEN COUNT(*)=53 THEN 'PASS' ELSE 'CHECK' END AS expectedCountStatus FROM "Lecture";
SELECT 'Material' AS tableName, COUNT(*) AS rowCount, CASE WHEN COUNT(*)=115 THEN 'PASS' ELSE 'CHECK' END AS expectedCountStatus FROM "Material";
SELECT 'Mcq' AS tableName, COUNT(*) AS rowCount, CASE WHEN COUNT(*)=100 THEN 'PASS' ELSE 'CHECK' END AS expectedCountStatus FROM "Mcq";
SELECT 'Flashcard' AS tableName, COUNT(*) AS rowCount, CASE WHEN COUNT(*)=100 THEN 'PASS' ELSE 'CHECK' END AS expectedCountStatus FROM "Flashcard";
SELECT 'DailyMotto' AS tableName, COUNT(*) AS rowCount, CASE WHEN COUNT(*)=14 THEN 'PASS' ELSE 'CHECK' END AS expectedCountStatus FROM "DailyMotto";
SELECT 'CalendarEvent' AS tableName, COUNT(*) AS rowCount, CASE WHEN COUNT(*)=0 THEN 'PASS' ELSE 'CHECK' END AS expectedCountStatus FROM "CalendarEvent";

-- D) Confirm indexes/automatic indexes exist on the new tables.
SELECT 'EmailVerificationToken' AS tableName, COUNT(*) AS indexCount FROM sqlite_master WHERE type='index' AND tbl_name='EmailVerificationToken';
SELECT 'FlashcardProgress' AS tableName, COUNT(*) AS indexCount FROM sqlite_master WHERE type='index' AND tbl_name='FlashcardProgress';
SELECT 'LectureProgress' AS tableName, COUNT(*) AS indexCount FROM sqlite_master WHERE type='index' AND tbl_name='LectureProgress';
SELECT 'ModerationHistory' AS tableName, COUNT(*) AS indexCount FROM sqlite_master WHERE type='index' AND tbl_name='ModerationHistory';
SELECT 'Notification' AS tableName, COUNT(*) AS indexCount FROM sqlite_master WHERE type='index' AND tbl_name='Notification';
SELECT 'OAuthIdentity' AS tableName, COUNT(*) AS indexCount FROM sqlite_master WHERE type='index' AND tbl_name='OAuthIdentity';
SELECT 'PasswordResetToken' AS tableName, COUNT(*) AS indexCount FROM sqlite_master WHERE type='index' AND tbl_name='PasswordResetToken';
SELECT 'PointsLog' AS tableName, COUNT(*) AS indexCount FROM sqlite_master WHERE type='index' AND tbl_name='PointsLog';
SELECT 'QaAnswer' AS tableName, COUNT(*) AS indexCount FROM sqlite_master WHERE type='index' AND tbl_name='QaAnswer';
SELECT 'QaQuestion' AS tableName, COUNT(*) AS indexCount FROM sqlite_master WHERE type='index' AND tbl_name='QaQuestion';
SELECT 'QaVote' AS tableName, COUNT(*) AS indexCount FROM sqlite_master WHERE type='index' AND tbl_name='QaVote';
SELECT 'Report' AS tableName, COUNT(*) AS indexCount FROM sqlite_master WHERE type='index' AND tbl_name='Report';
SELECT 'SmartNotification' AS tableName, COUNT(*) AS indexCount FROM sqlite_master WHERE type='index' AND tbl_name='SmartNotification';
SELECT 'SystemSetting' AS tableName, COUNT(*) AS indexCount FROM sqlite_master WHERE type='index' AND tbl_name='SystemSetting';
SELECT 'User' AS tableName, COUNT(*) AS indexCount FROM sqlite_master WHERE type='index' AND tbl_name='User';
SELECT 'UserBan' AS tableName, COUNT(*) AS indexCount FROM sqlite_master WHERE type='index' AND tbl_name='UserBan';
SELECT 'UserBlock' AS tableName, COUNT(*) AS indexCount FROM sqlite_master WHERE type='index' AND tbl_name='UserBlock';
SELECT 'UserMute' AS tableName, COUNT(*) AS indexCount FROM sqlite_master WHERE type='index' AND tbl_name='UserMute';
SELECT 'UserProgress' AS tableName, COUNT(*) AS indexCount FROM sqlite_master WHERE type='index' AND tbl_name='UserProgress';