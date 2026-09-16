@echo off
setlocal
cd /d "%~dp0cloudflare-content-api"

echo ================================================
echo 99's Guide - Stage 8C Remote D1 Export
echo ================================================
echo This is READ-ONLY against D1.
echo.

if exist "..\stage8c-d1-export.sql" del /q "..\stage8c-d1-export.sql"

call npx wrangler d1 export 99s-guide-content --remote --output=..\stage8c-d1-export.sql --skip-confirmation -c wrangler.jsonc
if errorlevel 1 goto :fail

echo.
echo STAGE 8C REMOTE D1 EXPORT PASS
exit /b 0

:fail
echo.
echo STAGE 8C REMOTE D1 EXPORT FAIL
exit /b 1
