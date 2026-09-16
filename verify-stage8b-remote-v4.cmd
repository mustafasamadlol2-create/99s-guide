@echo off
setlocal
cd /d "%~dp0cloudflare-content-api"

echo ================================================
echo 99's Guide - Stage 8B Remote Verification V4
echo ================================================
echo READ-ONLY. No D1 or Supabase rows will be modified.
echo.

echo [A] New table existence count - expected 19
call npx wrangler d1 execute 99s-guide-content --remote --command "SELECT COUNT(*) AS presentTables FROM sqlite_master WHERE type='table' AND name IN ('EmailVerificationToken','FlashcardProgress','LectureProgress','ModerationHistory','Notification','OAuthIdentity','PasswordResetToken','PointsLog','QaAnswer','QaQuestion','QaVote','Report','SmartNotification','SystemSetting','User','UserBan','UserBlock','UserMute','UserProgress');" -c wrangler.jsonc
if errorlevel 1 goto :fail

echo.
echo [B] New table row counts - every value expected 0
call npx wrangler d1 execute 99s-guide-content --remote --command "SELECT (SELECT COUNT(*) FROM [EmailVerificationToken]) AS [EmailVerificationToken], (SELECT COUNT(*) FROM [FlashcardProgress]) AS [FlashcardProgress], (SELECT COUNT(*) FROM [LectureProgress]) AS [LectureProgress], (SELECT COUNT(*) FROM [ModerationHistory]) AS [ModerationHistory], (SELECT COUNT(*) FROM [Notification]) AS [Notification], (SELECT COUNT(*) FROM [OAuthIdentity]) AS [OAuthIdentity], (SELECT COUNT(*) FROM [PasswordResetToken]) AS [PasswordResetToken], (SELECT COUNT(*) FROM [PointsLog]) AS [PointsLog], (SELECT COUNT(*) FROM [QaAnswer]) AS [QaAnswer], (SELECT COUNT(*) FROM [QaQuestion]) AS [QaQuestion], (SELECT COUNT(*) FROM [QaVote]) AS [QaVote], (SELECT COUNT(*) FROM [Report]) AS [Report], (SELECT COUNT(*) FROM [SmartNotification]) AS [SmartNotification], (SELECT COUNT(*) FROM [SystemSetting]) AS [SystemSetting], (SELECT COUNT(*) FROM [User]) AS [User], (SELECT COUNT(*) FROM [UserBan]) AS [UserBan], (SELECT COUNT(*) FROM [UserBlock]) AS [UserBlock], (SELECT COUNT(*) FROM [UserMute]) AS [UserMute], (SELECT COUNT(*) FROM [UserProgress]) AS [UserProgress];" -c wrangler.jsonc
if errorlevel 1 goto :fail

echo.
echo [C] Existing shared D1 counts - expected Lecture=53 Material=115 Mcq=100 Flashcard=100 DailyMotto=14 CalendarEvent=0
call npx wrangler d1 execute 99s-guide-content --remote --command "SELECT (SELECT COUNT(*) FROM [Lecture]) AS [Lecture], (SELECT COUNT(*) FROM [Material]) AS [Material], (SELECT COUNT(*) FROM [Mcq]) AS [Mcq], (SELECT COUNT(*) FROM [Flashcard]) AS [Flashcard], (SELECT COUNT(*) FROM [DailyMotto]) AS [DailyMotto], (SELECT COUNT(*) FROM [CalendarEvent]) AS [CalendarEvent];" -c wrangler.jsonc
if errorlevel 1 goto :fail

echo.
echo [D] Index counts for new tables
call npx wrangler d1 execute 99s-guide-content --remote --command "SELECT tbl_name AS tableName, COUNT(*) AS indexCount FROM sqlite_master WHERE type='index' AND tbl_name IN ('EmailVerificationToken','FlashcardProgress','LectureProgress','ModerationHistory','Notification','OAuthIdentity','PasswordResetToken','PointsLog','QaAnswer','QaQuestion','QaVote','Report','SmartNotification','SystemSetting','User','UserBan','UserBlock','UserMute','UserProgress') GROUP BY tbl_name ORDER BY tbl_name;" -c wrangler.jsonc
if errorlevel 1 goto :fail

echo.
echo ================================================
echo STAGE 8B V4 COMMANDS COMPLETED
echo ================================================
echo Check the values above and send the full output to ChatGPT.
goto :eof

:fail
echo.
echo STAGE 8B V4 VERIFY COMMAND FAILED
exit /b 1
