@echo off
setlocal
cd /d "%~dp0cloudflare-private-data-api"

echo ================================================
echo 99's Guide - Stage 8D-2B Remote D1 Export
echo ================================================
echo READ-ONLY against D1.
echo.

if exist "..\stage8d2b-d1-export.sql" del /q "..\stage8d2b-d1-export.sql"

call npx wrangler d1 export 99s-guide-content --remote --output=..\stage8d2b-d1-export.sql --skip-confirmation -c wrangler.jsonc
if errorlevel 1 goto :fail

echo.
echo STAGE 8D-2B REMOTE D1 EXPORT PASS
exit /b 0

:fail
echo.
echo STAGE 8D-2B REMOTE D1 EXPORT FAIL
exit /b 1
