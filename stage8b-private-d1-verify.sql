-- 99's Guide — Stage 8B D1 schema verification
-- Expected: every target table appears exactly once and rowCount = 0.

SELECT name AS tableName FROM sqlite_master WHERE type='table' AND name IN ('EmailVerificationToken', 'FlashcardProgress', 'LectureProgress', 'ModerationHistory', 'Notification', 'OAuthIdentity', 'PasswordResetToken', 'PointsLog', 'QaAnswer', 'QaQuestion', 'QaVote', 'Report', 'SmartNotification', 'SystemSetting', 'User', 'UserBan', 'UserBlock', 'UserMute', 'UserProgress') ORDER BY name;

SELECT 'EmailVerificationToken' AS tableName, COUNT(*) AS rowCount FROM "EmailVerificationToken"
UNION ALL
SELECT 'FlashcardProgress' AS tableName, COUNT(*) AS rowCount FROM "FlashcardProgress"
UNION ALL
SELECT 'LectureProgress' AS tableName, COUNT(*) AS rowCount FROM "LectureProgress"
UNION ALL
SELECT 'ModerationHistory' AS tableName, COUNT(*) AS rowCount FROM "ModerationHistory"
UNION ALL
SELECT 'Notification' AS tableName, COUNT(*) AS rowCount FROM "Notification"
UNION ALL
SELECT 'OAuthIdentity' AS tableName, COUNT(*) AS rowCount FROM "OAuthIdentity"
UNION ALL
SELECT 'PasswordResetToken' AS tableName, COUNT(*) AS rowCount FROM "PasswordResetToken"
UNION ALL
SELECT 'PointsLog' AS tableName, COUNT(*) AS rowCount FROM "PointsLog"
UNION ALL
SELECT 'QaAnswer' AS tableName, COUNT(*) AS rowCount FROM "QaAnswer"
UNION ALL
SELECT 'QaQuestion' AS tableName, COUNT(*) AS rowCount FROM "QaQuestion"
UNION ALL
SELECT 'QaVote' AS tableName, COUNT(*) AS rowCount FROM "QaVote"
UNION ALL
SELECT 'Report' AS tableName, COUNT(*) AS rowCount FROM "Report"
UNION ALL
SELECT 'SmartNotification' AS tableName, COUNT(*) AS rowCount FROM "SmartNotification"
UNION ALL
SELECT 'SystemSetting' AS tableName, COUNT(*) AS rowCount FROM "SystemSetting"
UNION ALL
SELECT 'User' AS tableName, COUNT(*) AS rowCount FROM "User"
UNION ALL
SELECT 'UserBan' AS tableName, COUNT(*) AS rowCount FROM "UserBan"
UNION ALL
SELECT 'UserBlock' AS tableName, COUNT(*) AS rowCount FROM "UserBlock"
UNION ALL
SELECT 'UserMute' AS tableName, COUNT(*) AS rowCount FROM "UserMute"
UNION ALL
SELECT 'UserProgress' AS tableName, COUNT(*) AS rowCount FROM "UserProgress";

SELECT tbl_name AS tableName, name AS indexName FROM sqlite_master WHERE type='index' AND tbl_name IN ('EmailVerificationToken', 'FlashcardProgress', 'LectureProgress', 'ModerationHistory', 'Notification', 'OAuthIdentity', 'PasswordResetToken', 'PointsLog', 'QaAnswer', 'QaQuestion', 'QaVote', 'Report', 'SmartNotification', 'SystemSetting', 'User', 'UserBan', 'UserBlock', 'UserMute', 'UserProgress') ORDER BY tbl_name, name;